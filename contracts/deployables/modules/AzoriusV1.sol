// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {Version} from "../Version.sol";
import {IStrategyBaseV1} from "../../interfaces/decent/deployables/IStrategyBaseV1.sol";
import {IAzoriusV1, Enum} from "../../interfaces/decent/deployables/IAzoriusV1.sol";
import {GuardableModule} from "@gnosis-guild/zodiac/contracts/core/GuardableModule.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

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

    uint32 public totalProposalCount;

    uint32 public timelockPeriod;

    uint32 public executionPeriod;

    mapping(uint256 => Proposal) internal proposals;

    IStrategyBaseV1 public strategy;

    event AzoriusSetUp(
        address indexed creator,
        address indexed owner,
        address indexed avatar,
        address target
    );
    event ProposalCreated(
        address strategy,
        uint256 proposalId,
        address proposer,
        Transaction[] transactions,
        string metadata
    );
    event ProposalExecuted(uint32 proposalId, bytes32[] txHashes);
    event TimelockPeriodUpdated(uint32 timelockPeriod);
    event ExecutionPeriodUpdated(uint32 executionPeriod);
    event StrategyUpdated(address strategy);

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

    function initialize(
        address _owner,
        address _avatar,
        address _target,
        address _strategy,
        uint32 _timelockPeriod,
        uint32 _executionPeriod
    ) public virtual initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        setAvatar(_avatar);
        setTarget(_target);

        _updateStrategy(_strategy);
        _updateTimelockPeriod(_timelockPeriod);
        _updateExecutionPeriod(_executionPeriod);

        transferOwnership(_owner);

        emit AzoriusSetUp(msg.sender, _owner, _avatar, _target);
    }

    function setUp(
        bytes memory initializeParams
    ) public virtual override initializer {
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

    function _authorizeUpgrade(
        address newImplementation
    ) internal virtual override onlyOwner {}

    function updateTimelockPeriod(
        uint32 _timelockPeriod
    ) external virtual override onlyOwner {
        _updateTimelockPeriod(_timelockPeriod);
    }

    function updateExecutionPeriod(
        uint32 _executionPeriod
    ) external virtual override onlyOwner {
        _updateExecutionPeriod(_executionPeriod);
    }

    function updateStrategy(
        address _strategy
    ) external virtual override onlyOwner {
        _updateStrategy(_strategy);
    }

    function submitProposal(
        Transaction[] calldata _transactions,
        string calldata _metadata,
        bytes memory _data
    ) external virtual override {
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

        proposals[totalProposalCount].strategy = address(strategy);
        proposals[totalProposalCount].txHashes = txHashes;
        proposals[totalProposalCount].timelockPeriod = timelockPeriod;
        proposals[totalProposalCount].executionPeriod = executionPeriod;

        strategy.initializeProposal(totalProposalCount, txHashes, _data);

        emit ProposalCreated(
            address(strategy),
            totalProposalCount,
            msg.sender,
            _transactions,
            _metadata
        );

        totalProposalCount++;
    }

    function executeProposal(
        uint32 _proposalId,
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _data,
        Enum.Operation[] memory _operations
    ) external virtual override {
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

    function getProposalTxHash(
        uint32 _proposalId,
        uint32 _txIndex
    ) external view virtual override returns (bytes32) {
        return proposals[_proposalId].txHashes[_txIndex];
    }

    function getProposalTxHashes(
        uint32 _proposalId
    ) external view virtual override returns (bytes32[] memory) {
        return proposals[_proposalId].txHashes;
    }

    function getProposal(
        uint32 _proposalId
    )
        external
        view
        virtual
        override
        returns (
            address _strategy,
            bytes32[] memory _txHashes,
            uint32 _timelockPeriod,
            uint32 _executionPeriod,
            uint32 _executionCounter
        )
    {
        Proposal memory _proposal = proposals[_proposalId];
        _strategy = _proposal.strategy;
        _txHashes = _proposal.txHashes;
        _timelockPeriod = _proposal.timelockPeriod;
        _executionPeriod = _proposal.executionPeriod;
        _executionCounter = _proposal.executionCounter;
    }

    function proposalState(
        uint32 _proposalId
    ) public view virtual override returns (ProposalState) {
        if (_proposalId >= totalProposalCount) revert InvalidProposal();
        Proposal memory _proposal = proposals[_proposalId];
        IStrategyBaseV1 _strategy = IStrategyBaseV1(_proposal.strategy);

        (, uint48 votingEndTimestamp) = _strategy.getVotingTimestamps(
            _proposalId
        );

        if (block.timestamp <= votingEndTimestamp) {
            return ProposalState.ACTIVE;
        } else if (!_strategy.isPassed(_proposalId)) {
            return ProposalState.FAILED;
        } else if (_proposal.executionCounter == _proposal.txHashes.length) {
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

    function generateTxHashData(
        address _to,
        uint256 _value,
        bytes memory _data,
        Enum.Operation _operation,
        uint256 _nonce
    ) public view virtual override returns (bytes memory) {
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

    function getTxHash(
        address _to,
        uint256 _value,
        bytes memory _data,
        Enum.Operation _operation
    ) public view virtual override returns (bytes32) {
        return keccak256(generateTxHashData(_to, _value, _data, _operation, 0));
    }

    function _executeProposalTx(
        uint32 _proposalId,
        address _target,
        uint256 _value,
        bytes memory _data,
        Enum.Operation _operation
    ) internal virtual returns (bytes32 txHash) {
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

    function _updateTimelockPeriod(uint32 _timelockPeriod) internal virtual {
        timelockPeriod = _timelockPeriod;
        emit TimelockPeriodUpdated(_timelockPeriod);
    }

    function _updateExecutionPeriod(uint32 _executionPeriod) internal virtual {
        executionPeriod = _executionPeriod;
        emit ExecutionPeriodUpdated(_executionPeriod);
    }

    function _updateStrategy(address _strategy) internal virtual {
        strategy = IStrategyBaseV1(_strategy);
        emit StrategyUpdated(_strategy);
    }

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
