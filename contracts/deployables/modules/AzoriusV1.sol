// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {Version} from "../Version.sol";
import {IBaseStrategyV1} from "../../interfaces/decent/deployables/IBaseStrategyV1.sol";
import {IAzoriusV1, Enum} from "../../interfaces/decent/deployables/IAzoriusV1.sol";
import {GuardableModule} from "@gnosis-guild/zodiac/contracts/core/GuardableModule.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * A Safe module which allows for composable governance.
 * Azorius conforms to the [Zodiac pattern](https://github.com/gnosis/zodiac) for Safe modules.
 *
 * The Azorius contract acts as a central manager of DAO Proposals, maintaining the specifications
 * of the transactions that comprise a Proposal, but notably not the state of voting.
 *
 * All voting details are delegated to [BaseStrategy](./BaseStrategy.md) implementations, of which an Azorius DAO can
 * have any number.
 */
contract AzoriusV1 is IAzoriusV1, GuardableModule, Version, UUPSUpgradeable {
    uint16 private constant VERSION = 1;
    /**
     * ```
     * keccak256(
     *      "EIP712Domain(uint256 chainId,address verifyingContract)"
     * );
     * ```
     *
     * A unique hash intended to prevent signature collisions.
     *
     * See https://eips.ethereum.org/EIPS/eip-712.
     */
    bytes32 public constant DOMAIN_SEPARATOR_TYPEHASH =
        0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218;

    /**
     * ```
     * keccak256(
     *      "Transaction(address to,uint256 value,bytes data,uint8 operation,uint256 nonce)"
     * );
     * ```
     *
     * See https://eips.ethereum.org/EIPS/eip-712.
     */
    bytes32 public constant TRANSACTION_TYPEHASH =
        0x72e9670a7ee00f5fbf1049b8c38e3f22fab7e9b85029e85cf9412f17fdd5c2ad;

    /** Total number of submitted Proposals. */
    uint32 public totalProposalCount;

    /** Delay between when a Proposal is passed and when it can be executed. */
    uint32 public timelockPeriod;

    /** Time between when timelock ends and the Proposal expires. */
    uint32 public executionPeriod;

    /** Proposals by `proposalId`. */
    mapping(uint256 => Proposal) internal proposals;

    IBaseStrategyV1 public strategy;

    event AzoriusSetUp(
        address indexed creator,
        address indexed owner,
        address indexed avatar,
        address target
    );
    event ProposalCreated(
        uint256 proposalId,
        address proposer,
        Transaction[] transactions,
        string metadata
    );
    event ProposalExecuted(uint32 proposalId, bytes32[] txHashes);
    event TimelockPeriodUpdated(uint32 timelockPeriod);
    event ExecutionPeriodUpdated(uint32 executionPeriod);

    error InvalidProposal();
    error InvalidProposer();
    error ProposalNotExecutable();
    error InvalidTxHash();
    error TxFailed();
    error InvalidTxs();
    error InvalidArrayLengths();

    constructor() {
        _disableInitializers();
    }

    /**
     * Initial setup of the Azorius instance.
     *
     * @param _owner Address that will own the contract
     * @param _avatar Address of the avatar (e.g., the Safe)
     * @param _target Address that avatar calls are directed to
     * @param _strategy Address of the strategy
     * @param _timelockPeriod Initial timelock period
     * @param _executionPeriod Initial execution period
     */
    function initialize(
        address _owner,
        address _avatar,
        address _target,
        address _strategy,
        uint32 _timelockPeriod,
        uint32 _executionPeriod
    ) public initializer {
        // Initializer owner with the msg.sender first,
        // needed for setting the avatar and target, which are ownable functions
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        // Setup module parameters
        strategy = IBaseStrategyV1(_strategy);
        setAvatar(_avatar);
        setTarget(_target);
        _updateTimelockPeriod(_timelockPeriod);
        _updateExecutionPeriod(_executionPeriod);

        // Transfer ownership to the provided owner
        transferOwnership(_owner);

        emit AzoriusSetUp(msg.sender, _owner, _avatar, _target);
    }

    /**
     * @dev Function to maintain backwards compatibility with the ModuleProxyFactory.
     * Instead of using this function, use initialize directly.
     */
    function setUp(bytes memory initializeParams) public override initializer {
        (
            address _owner,
            address _avatar,
            address _target,
            address _strategy,
            uint32 _timelockPeriod,
            uint32 _executionPeriod
        ) = abi.decode(
                initializeParams,
                (address, address, address, address, uint32, uint32)
            );
        initialize(
            _owner,
            _avatar,
            _target,
            _strategy,
            _timelockPeriod,
            _executionPeriod
        );
    }

    /**
     * @dev Function that authorizes an upgrade to a new implementation.
     * @param newImplementation The address of the new implementation
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal virtual override onlyOwner {}

    /** @inheritdoc IAzoriusV1*/
    function updateTimelockPeriod(uint32 _timelockPeriod) external onlyOwner {
        _updateTimelockPeriod(_timelockPeriod);
    }

    /** @inheritdoc IAzoriusV1*/
    function updateExecutionPeriod(uint32 _executionPeriod) external onlyOwner {
        _updateExecutionPeriod(_executionPeriod);
    }

    /** @inheritdoc IAzoriusV1*/
    function submitProposal(
        bytes memory _data,
        Transaction[] calldata _transactions,
        string calldata _metadata
    ) external {
        if (!strategy.isProposer(msg.sender)) revert InvalidProposer();

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

        proposals[totalProposalCount].txHashes = txHashes;
        proposals[totalProposalCount].timelockPeriod = timelockPeriod;
        proposals[totalProposalCount].executionPeriod = executionPeriod;

        // not all strategy contracts will necessarily use the txHashes and _data values
        // they are encoded to support any strategy contracts that may need them
        strategy.initializeProposal(
            abi.encode(totalProposalCount, txHashes, _data)
        );

        emit ProposalCreated(
            totalProposalCount,
            msg.sender,
            _transactions,
            _metadata
        );

        totalProposalCount++;
    }

    /** @inheritdoc IAzoriusV1*/
    function executeProposal(
        uint32 _proposalId,
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
        bytes32[] memory txHashes = new bytes32[](targetsLength);
        for (uint256 i; i < targetsLength; ) {
            txHashes[i] = _executeProposalTx(
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
        emit ProposalExecuted(_proposalId, txHashes);
    }

    /** @inheritdoc IAzoriusV1*/
    function getProposalTxHash(
        uint32 _proposalId,
        uint32 _txIndex
    ) external view returns (bytes32) {
        return proposals[_proposalId].txHashes[_txIndex];
    }

    /** @inheritdoc IAzoriusV1*/
    function getProposalTxHashes(
        uint32 _proposalId
    ) external view returns (bytes32[] memory) {
        return proposals[_proposalId].txHashes;
    }

    /** @inheritdoc IAzoriusV1*/
    function getProposal(
        uint32 _proposalId
    )
        external
        view
        returns (
            bytes32[] memory _txHashes,
            uint32 _timelockPeriod,
            uint32 _executionPeriod,
            uint32 _executionCounter
        )
    {
        _txHashes = proposals[_proposalId].txHashes;
        _timelockPeriod = proposals[_proposalId].timelockPeriod;
        _executionPeriod = proposals[_proposalId].executionPeriod;
        _executionCounter = proposals[_proposalId].executionCounter;
    }

    /** @inheritdoc IAzoriusV1*/
    function proposalState(
        uint32 _proposalId
    ) public view returns (ProposalState) {
        if (_proposalId >= totalProposalCount) revert InvalidProposal();
        Proposal memory _proposal = proposals[_proposalId];

        (, uint48 votingEndTimestamp) = strategy.getVotingTimestamps(
            _proposalId
        );

        if (block.timestamp <= votingEndTimestamp) {
            return ProposalState.ACTIVE;
        } else if (!strategy.isPassed(_proposalId)) {
            return ProposalState.FAILED;
        } else if (_proposal.executionCounter == _proposal.txHashes.length) {
            // a Proposal with 0 transactions goes straight to EXECUTED
            // this allows for the potential for on-chain voting for
            // "off-chain" executed decisions
            return ProposalState.EXECUTED;
        } else if (
            block.timestamp <= votingEndTimestamp + _proposal.timelockPeriod
        ) {
            return ProposalState.TIMELOCKED;
        } else if (
            block.timestamp <=
            votingEndTimestamp +
                _proposal.timelockPeriod +
                _proposal.executionPeriod
        ) {
            return ProposalState.EXECUTABLE;
        } else {
            return ProposalState.EXPIRED;
        }
    }

    /** @inheritdoc IAzoriusV1*/
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

    /** @inheritdoc IAzoriusV1*/
    function getTxHash(
        address _to,
        uint256 _value,
        bytes memory _data,
        Enum.Operation _operation
    ) public view returns (bytes32) {
        return keccak256(generateTxHashData(_to, _value, _data, _operation, 0));
    }

    /**
     * Executes the specified transaction in a Proposal, by index.
     * Transactions in a Proposal must be called in order.
     *
     * @param _proposalId identifier of the proposal
     * @param _target contract to be called by the avatar
     * @param _value ETH value to pass with the call
     * @param _data data to be executed from the call
     * @param _operation Call or Delegatecall
     */
    function _executeProposalTx(
        uint32 _proposalId,
        address _target,
        uint256 _value,
        bytes memory _data,
        Enum.Operation _operation
    ) internal returns (bytes32 txHash) {
        if (proposalState(_proposalId) != ProposalState.EXECUTABLE)
            revert ProposalNotExecutable();
        txHash = getTxHash(_target, _value, _data, _operation);
        if (
            proposals[_proposalId].txHashes[
                proposals[_proposalId].executionCounter
            ] != txHash
        ) revert InvalidTxHash();

        proposals[_proposalId].executionCounter++;

        if (!exec(_target, _value, _data, _operation)) revert TxFailed();
    }

    /**
     * Updates the `timelockPeriod` for future Proposals.
     *
     * @param _timelockPeriod new timelock period
     */
    function _updateTimelockPeriod(uint32 _timelockPeriod) internal {
        timelockPeriod = _timelockPeriod;
        emit TimelockPeriodUpdated(_timelockPeriod);
    }

    /**
     * Updates the `executionPeriod` for future Proposals.
     *
     * @param _executionPeriod new execution period
     */
    function _updateExecutionPeriod(uint32 _executionPeriod) internal {
        executionPeriod = _executionPeriod;
        emit ExecutionPeriodUpdated(_executionPeriod);
    }

    /// Implementation for the version
    function getVersion() public view virtual override returns (uint16) {
        return VERSION;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override returns (bool) {
        return
            interfaceId == type(IAzoriusV1).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
