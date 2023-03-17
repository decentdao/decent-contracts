// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity =0.8.19;

import "@gnosis.pm/zodiac/contracts/core/Module.sol";
import "./interfaces/IBaseStrategy.sol";
import "./interfaces/IAzorius.sol";

contract Azorius is Module, IAzorius {
    bytes32 public constant DOMAIN_SEPARATOR_TYPEHASH =
        0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218;
    bytes32 public constant TRANSACTION_TYPEHASH =
        0x72e9670a7ee00f5fbf1049b8c38e3f22fab7e9b85029e85cf9412f17fdd5c2ad;
    uint256 public totalProposalCount; // Total number of submitted proposals
    uint256 public timelockPeriod; // Delay in blocks between a proposal is passed and can be executed
    uint256 public executionPeriod; // Delay in blocks between when timelock ends and proposal expires
    address internal constant SENTINEL_STRATEGY = address(0x1);
    mapping(uint256 => Proposal) internal proposals; // Proposals by proposalId
    mapping(address => address) internal strategies;

    event ProposalCreated(
        address strategy,
        uint256 proposalId,
        address proposer,
        Transaction[] transactions,
        string metadata
    );

    // todo: combine TransactionExecuted and TransactionExecutedBatch into single event
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

    error InvalidStrategy();
    error StrategyEnabled();
    error StrategyDisabled();
    error InvalidProposal();
    error InvalidProposer();
    error ProposalNotExecutable();
    error InvalidTxHash();
    error TxFailed();
    error InvalidTxs();
    error InvalidArrayLengths();
    error AlreadySetupStrategies();

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
        _setupStrategies(_strategies);
        transferOwnership(_owner);
        _updateTimelockPeriod(_timelockPeriod);
        _updateExecutionPeriod(_executionPeriod);

        emit AzoriusSetup(msg.sender, _owner, _avatar, _target);
    }

    /// @inheritdoc IAzorius
    function enableStrategy(address _strategy) public override onlyOwner {
        if (_strategy == address(0) || _strategy == SENTINEL_STRATEGY)
            revert InvalidStrategy();
        if (strategies[_strategy] != address(0)) revert StrategyEnabled();

        strategies[_strategy] = strategies[SENTINEL_STRATEGY];
        strategies[SENTINEL_STRATEGY] = _strategy;

        emit EnabledStrategy(_strategy);
    }

    /// @inheritdoc IAzorius
    function disableStrategy(
        address _prevStrategy,
        address _strategy
    ) public onlyOwner {
        if (_strategy == address(0) || _strategy == SENTINEL_STRATEGY)
            revert InvalidStrategy();
        if (strategies[_prevStrategy] != _strategy) revert StrategyDisabled();

        strategies[_prevStrategy] = strategies[_strategy];
        strategies[_strategy] = address(0);

        emit DisabledStrategy(_strategy);
    }

    /// @inheritdoc IAzorius
    function updateTimelockPeriod(uint256 _timelockPeriod) external onlyOwner {
        _updateTimelockPeriod(_timelockPeriod);
    }

    /**
     * Updates the execution period for future Proposals.
     *
     * @param _executionPeriod new execution period (in blocks)
     */
    function updateExecutionPeriod(
        uint256 _executionPeriod
    ) external onlyOwner {
        _updateExecutionPeriod(_executionPeriod);
    }

    /// @inheritdoc IAzorius
    function submitProposal(
        address _strategy,
        bytes memory _data,
        Transaction[] calldata _transactions,
        string calldata _metadata
    ) external {
        if (!isStrategyEnabled(_strategy)) revert StrategyDisabled();
        if (_transactions.length == 0) revert InvalidProposal();
        if (!IBaseStrategy(_strategy).isProposer(msg.sender))
            revert InvalidProposer();

        bytes32[] memory txHashes = new bytes32[](_transactions.length);
        uint256 transactionsLength = _transactions.length;
        for (uint256 i; i < transactionsLength; ) {
            txHashes[i] = getTxHash(
                _transactions[i].to,
                _transactions[i].value,
                _transactions[i].data,
                _transactions[i].operation
            );
            unchecked {
                ++i;
            }
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

    /// @inheritdoc IAzorius
    function executeProposal(
        uint256 _proposalId,
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _data,
        Enum.Operation[] memory _operations
    ) external {
        if (_targets.length == 0) revert InvalidTxs();
        if (
            _targets.length != _values.length ||
            _targets.length != _data.length ||
            _targets.length != _operations.length
        ) revert InvalidArrayLengths();
        if (
            proposals[_proposalId].executionCounter + _targets.length >
            proposals[_proposalId].txHashes.length
        ) revert InvalidTxs();
        uint256 targetsLength = _targets.length;
        for (uint256 i; i < targetsLength; ) {
            _executeProposalTx(
                _proposalId,
                _targets[i],
                _values[i],
                _data[i],
                _operations[i]
            );
            unchecked {
              ++i;
            }
        }
        emit TransactionExecutedBatch(
            proposals[_proposalId].executionCounter,
            proposals[_proposalId].executionCounter + _targets.length
        );
    }

    /**
     * Executes the specified transaction in a Proposal, by index.
     * Transactions in a proposal must be called in order.
     *
     * @param _proposalId identifier of the proposal
     * @param _target contract to be called by the avatar
     * @param _value ETH value to pass with the call
     * @param _data data to be executed from the call
     * @param _operation Call or Delegatecall
     */
    function _executeProposalTx(
        uint256 _proposalId,
        address _target,
        uint256 _value,
        bytes memory _data,
        Enum.Operation _operation
    ) internal {
        if (proposalState(_proposalId) != ProposalState.EXECUTABLE)
            revert ProposalNotExecutable();
        bytes32 txHash = getTxHash(_target, _value, _data, _operation);
        if (
            proposals[_proposalId].txHashes[
                proposals[_proposalId].executionCounter
            ] != txHash
        ) revert InvalidTxHash();
        proposals[_proposalId].executionCounter++;
        if (!exec(_target, _value, _data, _operation)) revert TxFailed();

        emit TransactionExecuted(_proposalId, txHash);
    }

    /**
     * Enables the specified array of BaseStrategy contract addresses.
     *
     * @param _strategies array of BaseStrategy contract addresses to enable
     */
    function _setupStrategies(address[] memory _strategies) internal {
        if (strategies[SENTINEL_STRATEGY] != address(0))
            revert AlreadySetupStrategies();
        strategies[SENTINEL_STRATEGY] = SENTINEL_STRATEGY;
        uint256 strategiesLength = _strategies.length;
        for (uint256 i; i < strategiesLength; ) {
            enableStrategy(_strategies[i]);
            unchecked {
              ++i;
            }
        }
    }

    /**
     * Updates the timelock period for future Proposals.
     *
     * @param _timelockPeriod new timelock period (in blocks)
     */
    function _updateTimelockPeriod(uint256 _timelockPeriod) internal {
        timelockPeriod = _timelockPeriod;
        emit TimelockPeriodUpdated(_timelockPeriod);
    }

    /**
     * Updates the execution period for future Proposals.
     *
     * @param _executionPeriod new execution period (in blocks)
     */
    function _updateExecutionPeriod(uint256 _executionPeriod) internal {
        executionPeriod = _executionPeriod;
        emit ExecutionPeriodUpdated(_executionPeriod);
    }

    /// @inheritdoc IAzorius
    function isStrategyEnabled(address _strategy) public view returns (bool) {
        return
            SENTINEL_STRATEGY != _strategy &&
            strategies[_strategy] != address(0);
    }

    /// @inheritdoc IAzorius
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

    /// @inheritdoc IAzorius
    function isTxExecuted(
        uint256 _proposalId,
        uint256 _index
    ) external view returns (bool) {
        return proposals[_proposalId].executionCounter > _index;
    }

    /// @inheritdoc IAzorius
    function proposalState(
        uint256 _proposalId
    ) public view returns (ProposalState) {
        Proposal memory _proposal = proposals[_proposalId];

        if (_proposal.strategy == address(0)) revert InvalidProposal();

        IBaseStrategy _strategy = IBaseStrategy(_proposal.strategy);

        uint256 votingEndBlock = _strategy.votingEndBlock(_proposalId);

        if (block.number <= votingEndBlock) {
            return ProposalState.ACTIVE;
        } else if (!_strategy.isPassed(_proposalId)) {
            return ProposalState.FAILED;
        } else if (block.number <= votingEndBlock + _proposal.timelockPeriod) {
            return ProposalState.TIMELOCKED;
        } else if (_proposal.executionCounter == _proposal.txHashes.length) {
            return ProposalState.EXECUTED;
        } else if (
            block.number <=
            votingEndBlock +
                _proposal.timelockPeriod +
                _proposal.executionPeriod
        ) {
            return ProposalState.EXECUTABLE;
        } else {
            return ProposalState.EXPIRED;
        }
    }

    /// @inheritdoc IAzorius
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

    /// @inheritdoc IAzorius
    function getProposalTxHash(
        uint256 _proposalId,
        uint256 _txIndex
    ) external view returns (bytes32) {
        return proposals[_proposalId].txHashes[_txIndex];
    }

    /// @inheritdoc IAzorius
    function getTxHash(
        address _to,
        uint256 _value,
        bytes memory _data,
        Enum.Operation _operation
    ) public view returns (bytes32) {
        return keccak256(generateTxHashData(_to, _value, _data, _operation, 0));
    }

    /// @inheritdoc IAzorius
    function getProposalTxHashes(
        uint256 _proposalId
    ) external view returns (bytes32[] memory) {
        return proposals[_proposalId].txHashes;
    }

    /// @inheritdoc IAzorius
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
