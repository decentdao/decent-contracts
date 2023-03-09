// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

import "@gnosis.pm/zodiac/contracts/core/Module.sol";
import "./interfaces/IBaseStrategy.sol";
import "./interfaces/IAzorius.sol";

/// @title Azorius - A Zodiac module that enables a voting agnostic proposal mechanism
contract Azorius is Module, IAzorius {
    bytes32 public constant DOMAIN_SEPARATOR_TYPEHASH =
        0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218;
    bytes32 public constant TRANSACTION_TYPEHASH =
        0x72e9670a7ee00f5fbf1049b8c38e3f22fab7e9b85029e85cf9412f17fdd5c2ad;
    uint256 public totalProposalCount; // Total number of submitted proposals
    uint256 public timelockPeriod; // Delay between a proposal is passed and can be executed
    uint256 public executionPeriod; // Delay between when timelock ends and proposal expires
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
    event AzoriusSetup(
        address indexed creator,
        address indexed owner,
        address indexed avatar,
        address target
    );
    event EnabledStrategy(address strategy);
    event DisabledStrategy(address strategy);
    event TimelockPeriodUpdated(uint256 timelockPeriod);
    event ExecutionPeriodUpdated(uint256 executionPeriod);

    function setUp(bytes memory initParams) public override initializer {
        (
            address _owner,
            address _avatar,
            address _target,
            address[] memory _strategies,
            uint256 _timelockPeriod,
            uint256 _executionPeriod
        ) = abi.decode(
                initParams,
                (address, address, address, address[], uint256, uint256)
            );
        __Ownable_init();
        avatar = _avatar;
        target = _target;
        setupStrategies(_strategies);
        transferOwnership(_owner);
        _updateTimelockPeriod(_timelockPeriod);
        _updateExecutionPeriod(_executionPeriod);

        emit AzoriusSetup(msg.sender, _owner, _avatar, _target);
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

    function updateTimelockPeriod(uint256 _newTimelockPeriod) external onlyOwner {
        _updateTimelockPeriod(_newTimelockPeriod);
    }

    /// @notice Updates the execution period
    /// @param _newExecutionPeriod The new execution period in seconds
    function updateExecutionPeriod(uint256 _newExecutionPeriod) external onlyOwner {
        _updateExecutionPeriod(_newExecutionPeriod);
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

        proposals[totalProposalCount].strategy = _strategy;
        proposals[totalProposalCount].txHashes = txHashes;
        proposals[totalProposalCount].timelockPeriod = timelockPeriod;
        proposals[totalProposalCount].executionPeriod = executionPeriod;

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

    /// @notice Updates the timelock period
    /// @param _newTimelockPeriod The new timelock period in seconds
    function _updateTimelockPeriod(uint256 _newTimelockPeriod) internal {
        timelockPeriod = _newTimelockPeriod;

        emit TimelockPeriodUpdated(_newTimelockPeriod);
    }

    /// @notice Updates the execution period
    /// @param _newExecutionPeriod The new execution period in seconds
    function _updateExecutionPeriod(uint256 _newExecutionPeriod) internal {
        executionPeriod = _newExecutionPeriod;

        emit ExecutionPeriodUpdated(_newExecutionPeriod);
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

        uint256 votingDeadline = _strategy.votingDeadline(_proposalId);

        if (block.timestamp <= votingDeadline) {
            return ProposalState.ACTIVE;
        } else if (!_strategy.isPassed(_proposalId)) {
            return ProposalState.FAILED;
        } else if (
            block.timestamp <= votingDeadline + _proposal.timelockPeriod
        ) {
            return ProposalState.TIMELOCKED;
        } else if (_proposal.executionCounter == _proposal.txHashes.length) {
            return ProposalState.EXECUTED;
        } else if (
            block.timestamp <=
            votingDeadline +
                _proposal.timelockPeriod +
                _proposal.executionPeriod
        ) {
            return ProposalState.EXECUTABLE;
        } else {
            return ProposalState.EXPIRED;
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
    /// @return _strategy The address of the strategy contract the proposal is on
    /// @return _txHashes The hashes of the transactions the proposal contains
    /// @return _timelockPeriod The time in seconds the proposal is timelocked for
    /// @return _executionPeriod The time in seconds the proposal has to be executed after timelock ends
    /// @return _executionCounter Counter of how many of the proposal transactions have been executed
    function getProposal(
        uint256 _proposalId
    )
        external
        view
        returns (
            address _strategy,
            bytes32[] memory _txHashes,
            uint256 _timelockPeriod,
            uint256 _executionPeriod,
            uint256 _executionCounter
        )
    {
        _strategy = proposals[_proposalId].strategy;
        _txHashes = proposals[_proposalId].txHashes;
        _timelockPeriod = proposals[_proposalId].timelockPeriod;
        _executionPeriod = proposals[_proposalId].executionPeriod;
        _executionCounter = proposals[_proposalId].executionCounter;
    }
}
