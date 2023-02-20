// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

import "@gnosis.pm/zodiac/contracts/core/Module.sol";
import "./usul/IBaseStrategy.sol";
import "./interfaces/IFractalUsul.sol";

/// @title FractalUsul - A Zodiac module that enables a voting agnostic proposal mechanism
contract FractalUsul is Module, IFractalUsul {
    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        Enum.Operation operation;
    }

    struct Proposal {
        uint256 timelockPeriod; // Time before a passed proposal can be executed
        bytes32[] txHashes; // The hashes of the transactions contained within the proposal
        uint256 executionCounter; // The count of transactions that have been executed within the proposal
        address strategy; // The voting strategy contract this proposal was created on
    }

    bytes32 public constant DOMAIN_SEPARATOR_TYPEHASH =
        0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218;
    bytes32 public constant TRANSACTION_TYPEHASH =
        0x72e9670a7ee00f5fbf1049b8c38e3f22fab7e9b85029e85cf9412f17fdd5c2ad;
    uint256 public totalProposalCount; // total number of submitted proposals
    address internal constant SENTINEL_STRATEGY = address(0x1);
    mapping(uint256 => Proposal) internal proposals; // Proposals by proposal ID
    mapping(address => address) internal strategies;

    event ProposalCreated(
        address strategy,
        uint256 proposalId,
        address proposer,
        Transaction[] transactions,
        string metadata
    );
    event TransactionExecuted(uint256 proposalId, bytes32 txHash);
    event TransactionExecutedBatch(uint256 startIndex, uint256 endIndex);
    event ProposalTimelocked(uint256 proposalId, uint256 endDate);
    event ProposalExecuted(uint256 id);
    event UsulSetup(
        address indexed initiator,
        address indexed owner,
        address indexed avatar,
        address target
    );
    event EnabledStrategy(address strategy);
    event DisabledStrategy(address strategy);

    constructor(
        address _owner,
        address _avatar,
        address _target,
        address[] memory _strategies
    ) {
        bytes memory initParams = abi.encode(
            _owner,
            _avatar,
            _target,
            _strategies
        );
        setUp(initParams);
    }

    function setUp(bytes memory initParams) public override initializer {
        (
            address _owner,
            address _avatar,
            address _target,
            address[] memory _strategies
        ) = abi.decode(initParams, (address, address, address, address[]));
        __Ownable_init();
        avatar = _avatar;
        target = _target;
        setupStrategies(_strategies);
        transferOwnership(_owner);
        emit UsulSetup(msg.sender, _owner, _avatar, _target);
    }

    /// @notice Enables a voting strategy that can vote on proposals, only callable by the owner
    /// @param _strategy Address of the strategy to be enabled
    function enableStrategy(address _strategy) public onlyOwner {
        require(
            _strategy != address(0) && _strategy != SENTINEL_STRATEGY,
            "Invalid strategy"
        );
        require(
            strategies[_strategy] == address(0),
            "Strategy already enabled"
        );

        strategies[_strategy] = strategies[SENTINEL_STRATEGY];
        strategies[SENTINEL_STRATEGY] = _strategy;

        emit EnabledStrategy(_strategy);
    }

    /// @notice Disables a voting strategy on the module, only callable by the owner
    /// @param _prevStrategy Strategy that pointed to the strategy to be removed in the linked list
    /// @param _strategy Strategy to be removed
    function disableStrategy(
        address _prevStrategy,
        address _strategy
    ) public onlyOwner {
        require(
            _strategy != address(0) && _strategy != SENTINEL_STRATEGY,
            "Invalid strategy"
        );
        require(
            strategies[_prevStrategy] == _strategy,
            "Strategy already disabled"
        );

        strategies[_prevStrategy] = strategies[_strategy];
        strategies[_strategy] = address(0);

        emit DisabledStrategy(_strategy);
    }

    /// @notice This method submits a proposal which includes metadata strings to describe the proposal
    /// @param _strategy Address of the voting strategy which the proposal will be submitted to
    /// @param _data Additional data which will be passed to the strategy contract
    /// @param _transactions Array of transactions to execute
    /// @param _metadata Any additional metadata such as a title or description to submit with the proposal
    function submitProposal(
        address _strategy,
        bytes memory _data,
        Transaction[] calldata _transactions,
        string calldata _metadata
    ) external {
        require(isStrategyEnabled(_strategy), "Voting strategy is not enabled");
        require(
            _transactions.length > 0,
            "Proposal must contain at least one transaction"
        );
        require(
            IBaseStrategy(_strategy).isProposer(msg.sender),
            "Caller cannot submit proposals"
        );

        bytes32[] memory txHashes = new bytes32[](_transactions.length);
        for (uint256 i = 0; i < _transactions.length; i++) {
            txHashes[i] = getTxHash(
                _transactions[i].to,
                _transactions[i].value,
                _transactions[i].data,
                _transactions[i].operation
            );
        }

        proposals[totalProposalCount].txHashes = txHashes;
        proposals[totalProposalCount].strategy = _strategy;
        IBaseStrategy(_strategy).initializeProposal(
            abi.encode(totalProposalCount, txHashes, _data)
        );
        emit ProposalCreated(
            _strategy,
            totalProposalCount,
            msg.sender,
            _transactions,
            _metadata
        );

        totalProposalCount++;
    }

    /// @notice Called by the strategy contract when the proposal vote has succeeded
    /// @param _proposalId The ID of the proposal
    /// @param _timelockPeriod The delay time until a proposal can be executed
    function timelockProposal(
        uint256 _proposalId,
        uint256 _timelockPeriod
    ) external {
        require(
            strategies[msg.sender] != address(0),
            "Strategy not authorized"
        );
        require(
            proposalState(_proposalId) == ProposalState.ACTIVE,
            "Proposal must be in the active state"
        );
        require(
            msg.sender == proposals[_proposalId].strategy,
            "Incorrect strategy for proposal"
        );

        proposals[_proposalId].timelockPeriod =
            block.timestamp +
            _timelockPeriod;

        emit ProposalTimelocked(
            _proposalId,
            proposals[_proposalId].timelockPeriod
        );
    }

    /// @notice Executes the specified transaction within a proposal
    /// @notice Transactions must be called in order
    /// @param _proposalId the identifier of the proposal
    /// @param _target the contract to be called by the avatar
    /// @param _value ether value to pass with the call
    /// @param _data the data to be executed from the call
    /// @param _operation Call or Delegatecall
    function executeProposalByIndex(
        uint256 _proposalId,
        address _target,
        uint256 _value,
        bytes memory _data,
        Enum.Operation _operation
    ) public {
        require(
            proposalState(_proposalId) == ProposalState.EXECUTABLE,
            "Proposal must be in the executable state"
        );
        bytes32 txHash = getTxHash(_target, _value, _data, _operation);
        require(
            proposals[_proposalId].txHashes[
                proposals[_proposalId].executionCounter
            ] == txHash,
            "Transaction hash does not match the indexed hash"
        );
        proposals[_proposalId].executionCounter++;
        require(
            exec(_target, _value, _data, _operation),
            "Module transaction failed"
        );
        emit TransactionExecuted(_proposalId, txHash);
    }

    /// @notice Executes all the transactions within a proposal
    /// @param _proposalId the identifier of the proposal
    /// @param _targets the contracts to be called by the avatar
    /// @param _values ether values to pass with the calls
    /// @param _data the data to be executed from the calls
    /// @param _operations Calls or Delegatecalls
    function executeProposalBatch(
        uint256 _proposalId,
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _data,
        Enum.Operation[] memory _operations
    ) external {
        require(_targets.length != 0, "No transactions to execute provided");
        require(
            _targets.length == _values.length &&
                _targets.length == _data.length &&
                _targets.length == _operations.length,
            "Array length mismatch"
        );
        require(
            proposals[_proposalId].executionCounter + _targets.length <=
                proposals[_proposalId].txHashes.length,
            "Too many transactions to execute provided"
        );
        for (uint256 i = 0; i < _targets.length; i++) {
            executeProposalByIndex(
                _proposalId,
                _targets[i],
                _values[i],
                _data[i],
                _operations[i]
            );
        }
        emit TransactionExecutedBatch(
            proposals[_proposalId].executionCounter,
            proposals[_proposalId].executionCounter + _targets.length
        );
    }

    /// @notice Enables the specified array of strategy contract addresses
    /// @param _strategies The array of strategy contract addresses
    function setupStrategies(address[] memory _strategies) internal {
        require(
            strategies[SENTINEL_STRATEGY] == address(0),
            "setupStrategies has already been called"
        );
        strategies[SENTINEL_STRATEGY] = SENTINEL_STRATEGY;
        for (uint256 i = 0; i < _strategies.length; i++) {
            enableStrategy(_strategies[i]);
        }
    }

    /// @notice Returns if a strategy is enabled
    /// @param _strategy The address of the strategy to check
    /// @return True if the strategy is enabled
    function isStrategyEnabled(address _strategy) public view returns (bool) {
        return
            SENTINEL_STRATEGY != _strategy &&
            strategies[_strategy] != address(0);
    }

    /// @notice Returns array of strategy contract addresses
    /// @param _startAddress Address in the strategy linked list to start with
    /// @param _count Maximum number of strategies that should be returned
    /// @return _strategies Array of strategy
    /// @return _next Next address in the linked list
    function getStrategies(
        address _startAddress,
        uint256 _count
    ) external view returns (address[] memory _strategies, address _next) {
        // Init array with max page size
        _strategies = new address[](_count);

        // Populate return array
        uint256 strategyCount = 0;
        address currentStrategy = strategies[_startAddress];
        while (
            currentStrategy != address(0x0) &&
            currentStrategy != SENTINEL_STRATEGY &&
            strategyCount < _count
        ) {
            _strategies[strategyCount] = currentStrategy;
            currentStrategy = strategies[currentStrategy];
            strategyCount++;
        }
        _next = currentStrategy;
        // Set correct size of returned array
        assembly {
            mstore(_strategies, strategyCount)
        }
    }

    /// @notice Returns true if a proposal transaction by index is executed
    /// @param _proposalId The ID of the proposal
    /// @param _index The index of the transaction within the proposal
    /// @return bool True if the transaction has been executed
    function isTxExecuted(
        uint256 _proposalId,
        uint256 _index
    ) external view returns (bool) {
        return proposals[_proposalId].executionCounter > _index;
    }

    /// @notice Gets the state of a proposal
    /// @param _proposalId The ID of the proposal
    /// @return ProposalState the enum of the state of the proposal
    function proposalState(
        uint256 _proposalId
    ) public view returns (ProposalState) {
        Proposal memory _proposal = proposals[_proposalId];

        require(_proposal.strategy != address(0), "Invalid proposal ID");

        IBaseStrategy _strategy = IBaseStrategy(_proposal.strategy);

        if (!_strategy.isPassed(_proposalId) && !_strategy.isVotingActive(_proposalId)) {
            return ProposalState.FAILED;
        } else if (_proposal.timelockPeriod == 0) {
            return ProposalState.ACTIVE;
        } else if (_proposal.executionCounter == _proposal.txHashes.length) {
            return ProposalState.EXECUTED;
        } else if (block.timestamp < _proposal.timelockPeriod) {
            return ProposalState.TIMELOCKED;
        } else {
            return ProposalState.EXECUTABLE;
        }
    }

    /// @notice Generates the data for the module transaction hash (required for signing)
    /// @param _to The target address of the transaction
    /// @param _value The Ether value to send with the transaction
    /// @param _data The encoded function call data of the transaction
    /// @param _operation The operation to use for the transaction
    /// @param _nonce The Safe nonce of the transaction
    /// @return bytes The hash transaction data
    function generateTxHashData(
        address _to,
        uint256 _value,
        bytes memory _data,
        Enum.Operation _operation,
        uint256 _nonce
    ) public view returns (bytes memory) {
        uint256 chainId = block.chainid;
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_SEPARATOR_TYPEHASH, chainId, this)
        );
        bytes32 transactionHash = keccak256(
            abi.encode(
                TRANSACTION_TYPEHASH,
                _to,
                _value,
                keccak256(_data),
                _operation,
                _nonce
            )
        );
        return
            abi.encodePacked(
                bytes1(0x19),
                bytes1(0x01),
                domainSeparator,
                transactionHash
            );
    }

    /// @notice Returns the hash of a transaction in a proposal
    /// @param _proposalId The ID of the proposal
    /// @param _txIndex The index of the transaction within the proposal
    /// @return bytes32 The hash of the specified transaction
    function getProposalTxHash(
        uint256 _proposalId,
        uint256 _txIndex
    ) external view returns (bytes32) {
        return proposals[_proposalId].txHashes[_txIndex];
    }

    /// @notice Returns the keccak256 hash of the specified transaction
    /// @param _to The target address of the transaction
    /// @param _value The Ether value to send with the transaction
    /// @param _data The encoded function call data of the transaction
    /// @param _operation The operation to use for the transaction
    /// @return bytes32 The transaction hash
    function getTxHash(
        address _to,
        uint256 _value,
        bytes memory _data,
        Enum.Operation _operation
    ) public view returns (bytes32) {
        return keccak256(generateTxHashData(_to, _value, _data, _operation, 0));
    }

    /// @notice Gets the transaction hashes associated with a given proposald
    /// @param _proposalId The ID of the proposal to get the tx hashes for
    /// @return bytes32[] The array of tx hashes
    function getProposalTxHashes(
        uint256 _proposalId
    ) external view returns (bytes32[] memory) {
        return proposals[_proposalId].txHashes;
    }

    /// @notice Gets details about the specified proposal
    /// @param _proposalId The ID of the proposal
    /// @return _timelockPeriod The delay time until a proposal can be executed
    /// @return _txHashes The hashes of the transactions the proposal contains
    /// @return _executionCounter Counter of how many of the proposal transactions have been executed
    /// @return _strategy The address of the strategy contract the proposal is on
    function getProposal(
        uint256 _proposalId
    )
        external
        view
        returns (
            uint256 _timelockPeriod,
            bytes32[] memory _txHashes,
            uint256 _executionCounter,
            address _strategy
        )
    {
        _timelockPeriod = proposals[_proposalId].timelockPeriod;
        _txHashes = proposals[_proposalId].txHashes;
        _executionCounter = proposals[_proposalId].executionCounter;
        _strategy = proposals[_proposalId].strategy;
    }
}
