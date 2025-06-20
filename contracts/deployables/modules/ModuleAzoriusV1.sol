// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IModuleAzoriusV1} from "../../interfaces/decent/deployables/IModuleAzoriusV1.sol";
import {IStrategyV1} from "../../interfaces/decent/deployables/IStrategyV1.sol";
import {Transaction} from "../../interfaces/decent/Module.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlockV1} from "../../interfaces/decent/IDeploymentBlockV1.sol";
import {DeploymentBlockV1} from "../../DeploymentBlockV1.sol";
import {GuardableModule} from "@gnosis-guild/zodiac/contracts/core/GuardableModule.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract ModuleAzoriusV1 is
    IModuleAzoriusV1,
    IVersion,
    GuardableModule,
    DeploymentBlockV1,
    Ownable2StepUpgradeable,
    UUPSUpgradeable,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /// @custom:storage-location erc7201:Decent.ModuleAzorius.main
    struct ModuleAzoriusStorage {
        uint32 totalProposalCount;
        uint32 timelockPeriod;
        uint32 executionPeriod;
        mapping(uint32 proposalId => Proposal proposal) proposals;
        IStrategyV1 strategy;
    }

    // EIP-7201: keccak256(abi.encode(uint256(keccak256("Decent.ModuleAzorius.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant MODULE_AZORIUS_STORAGE_LOCATION =
        0xedd394c11bb1dac1602ad0766d0e03cc697fdaf9a9996bf169d40a2c3b6fa100;

    function _getModuleAzoriusStorage()
        internal
        pure
        returns (ModuleAzoriusStorage storage $)
    {
        assembly {
            $.slot := MODULE_AZORIUS_STORAGE_LOCATION
        }
    }

    bytes32 public constant DOMAIN_SEPARATOR_TYPEHASH =
        keccak256("EIP712Domain(uint256 chainId,address verifyingContract)");

    bytes32 public constant TRANSACTION_TYPEHASH =
        keccak256(
            "Transaction(address to,uint256 value,bytes data,uint8 operation,uint256 nonce)"
        );

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        address avatar_,
        address target_,
        address strategy_,
        uint32 timelockPeriod_,
        uint32 executionPeriod_
    ) public virtual override initializer {
        __UUPSUpgradeable_init();
        __Ownable_init(owner_);
        __DeploymentBlockV1_init();

        // avoids onlyOwner requirement on setAvatar and setTarget
        avatar = avatar_;
        target = target_;
        emit AvatarSet(address(0), avatar_);
        emit TargetSet(address(0), target_);

        _updateStrategy(strategy_);
        _updateTimelockPeriod(timelockPeriod_);
        _updateExecutionPeriod(executionPeriod_);
    }

    function setUp(
        bytes memory initializeParams_
    ) public virtual override initializer {
        (
            address owner_,
            address avatar_,
            address target_,
            address strategy_,
            uint32 timelockPeriod_,
            uint32 executionPeriod_
        ) = abi.decode(
                initializeParams_,
                (address, address, address, address, uint32, uint32)
            );
        initialize(
            owner_,
            avatar_,
            target_,
            strategy_,
            timelockPeriod_,
            executionPeriod_
        );
    }

    // ======================================================================
    // UUPS UPGRADEABLE
    // ======================================================================

    // --- Internal Functions ---

    function _authorizeUpgrade(
        address newImplementation_
    ) internal virtual override onlyOwner {}

    // ======================================================================
    // IModuleAzoriusV1
    // ======================================================================

    // --- View Functions ---

    function totalProposalCount()
        public
        view
        virtual
        override
        returns (uint32)
    {
        ModuleAzoriusStorage storage $ = _getModuleAzoriusStorage();
        return $.totalProposalCount;
    }

    function timelockPeriod() public view virtual override returns (uint32) {
        ModuleAzoriusStorage storage $ = _getModuleAzoriusStorage();
        return $.timelockPeriod;
    }

    function executionPeriod() public view virtual override returns (uint32) {
        ModuleAzoriusStorage storage $ = _getModuleAzoriusStorage();
        return $.executionPeriod;
    }

    function proposals(
        uint32 proposalId_
    ) public view virtual override returns (Proposal memory) {
        ModuleAzoriusStorage storage $ = _getModuleAzoriusStorage();
        return $.proposals[proposalId_];
    }

    function strategy() public view virtual override returns (address) {
        ModuleAzoriusStorage storage $ = _getModuleAzoriusStorage();
        return address($.strategy);
    }

    function proposalState(
        uint32 proposalId_
    ) public view virtual override returns (ProposalState) {
        ModuleAzoriusStorage storage $ = _getModuleAzoriusStorage();
        if (proposalId_ >= $.totalProposalCount) revert InvalidProposal();
        Proposal memory _proposal = $.proposals[proposalId_];
        IStrategyV1 strategy_ = IStrategyV1(_proposal.strategy);

        (, uint48 votingEndTimestamp) = strategy_.getVotingTimestamps(
            proposalId_
        );

        if (block.timestamp <= votingEndTimestamp) {
            return ProposalState.ACTIVE;
        } else if (!strategy_.isPassed(proposalId_)) {
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
        Transaction calldata transaction_,
        uint256 nonce_
    ) public view virtual override returns (bytes memory) {
        uint256 chainId = block.chainid;
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_SEPARATOR_TYPEHASH, chainId, this)
        );
        bytes32 transactionHash = keccak256(
            abi.encode(
                TRANSACTION_TYPEHASH,
                transaction_.to,
                transaction_.value,
                keccak256(transaction_.data),
                transaction_.operation,
                nonce_
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
        Transaction calldata transaction_
    ) public view virtual override returns (bytes32) {
        return keccak256(generateTxHashData(transaction_, 0));
    }

    function getProposalTxHash(
        uint32 proposalId_,
        uint32 txIndex_
    ) public view virtual override returns (bytes32) {
        ModuleAzoriusStorage storage $ = _getModuleAzoriusStorage();
        return $.proposals[proposalId_].txHashes[txIndex_];
    }

    function getProposalTxHashes(
        uint32 proposalId_
    ) public view virtual override returns (bytes32[] memory) {
        ModuleAzoriusStorage storage $ = _getModuleAzoriusStorage();
        return $.proposals[proposalId_].txHashes;
    }

    function getProposal(
        uint32 proposalId_
    )
        public
        view
        virtual
        override
        returns (address, bytes32[] memory, uint32, uint32, uint32)
    {
        ModuleAzoriusStorage storage $ = _getModuleAzoriusStorage();
        Proposal memory _proposal = $.proposals[proposalId_];
        return (
            _proposal.strategy,
            _proposal.txHashes,
            _proposal.timelockPeriod,
            _proposal.executionPeriod,
            _proposal.executionCounter
        );
    }

    // --- State-Changing Functions ---

    function updateTimelockPeriod(
        uint32 timelockPeriod_
    ) public virtual override onlyOwner {
        _updateTimelockPeriod(timelockPeriod_);
    }

    function updateExecutionPeriod(
        uint32 executionPeriod_
    ) public virtual override onlyOwner {
        _updateExecutionPeriod(executionPeriod_);
    }

    function updateStrategy(
        address strategy_
    ) public virtual override onlyOwner {
        _updateStrategy(strategy_);
    }

    function submitProposal(
        Transaction[] calldata transactions_,
        string calldata metadata_,
        address proposerAdapter_,
        bytes calldata proposerAdapterData_
    ) public virtual override {
        ModuleAzoriusStorage storage $ = _getModuleAzoriusStorage();
        if (
            !$.strategy.isProposer(
                msg.sender,
                proposerAdapter_,
                proposerAdapterData_
            )
        ) revert InvalidProposer();

        bytes32[] memory txHashes = new bytes32[](transactions_.length);
        uint256 transactionsLength = transactions_.length;
        for (uint256 i; i < transactionsLength; ) {
            txHashes[i] = getTxHash(transactions_[i]);
            unchecked {
                ++i;
            }
        }

        Proposal storage proposal = $.proposals[$.totalProposalCount];
        proposal.strategy = address($.strategy);
        proposal.txHashes = txHashes;
        proposal.timelockPeriod = $.timelockPeriod;
        proposal.executionPeriod = $.executionPeriod;

        $.strategy.initializeProposal($.totalProposalCount);

        emit ProposalCreated(
            address($.strategy),
            $.totalProposalCount,
            msg.sender,
            transactions_,
            metadata_
        );

        $.totalProposalCount++;
    }

    function executeProposal(
        uint32 proposalId_,
        Transaction[] calldata transactions_
    ) public virtual override {
        if (transactions_.length == 0) revert InvalidTxs();

        ModuleAzoriusStorage storage $ = _getModuleAzoriusStorage();
        Proposal memory proposal = $.proposals[proposalId_];

        if (
            proposal.executionCounter + transactions_.length >
            proposal.txHashes.length
        ) revert InvalidTxs();

        uint256 transactionsLength = transactions_.length;
        bytes32[] memory txHashes = new bytes32[](transactionsLength);
        for (uint256 i; i < transactionsLength; ) {
            txHashes[i] = _executeProposalTx(proposalId_, transactions_[i]);
            unchecked {
                ++i;
            }
        }
        emit ProposalExecuted(proposalId_, txHashes);
    }

    // ======================================================================
    // IVersion
    // ======================================================================

    // --- Pure Functions ---

    function version() public pure virtual override returns (uint16) {
        return 1;
    }

    // ======================================================================
    // Ownable2StepUpgradeable
    // ======================================================================

    // --- State-Changing Functions ---

    function transferOwnership(
        address newOwner_
    )
        public
        virtual
        override(Ownable2StepUpgradeable, OwnableUpgradeable)
        onlyOwner
    {
        Ownable2StepUpgradeable.transferOwnership(newOwner_);
    }

    // --- Internal Functions ---

    function _transferOwnership(
        address newOwner_
    ) internal virtual override(Ownable2StepUpgradeable, OwnableUpgradeable) {
        Ownable2StepUpgradeable._transferOwnership(newOwner_);
    }

    // ======================================================================
    // ERC165
    // ======================================================================

    // --- View Functions ---

    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IModuleAzoriusV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            super.supportsInterface(interfaceId_);
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    function _executeProposalTx(
        uint32 proposalId_,
        Transaction calldata transaction_
    ) internal virtual returns (bytes32) {
        if (proposalState(proposalId_) != ProposalState.EXECUTABLE)
            revert ProposalNotExecutable();
        bytes32 txHash = getTxHash(transaction_);

        ModuleAzoriusStorage storage $ = _getModuleAzoriusStorage();

        Proposal storage proposal = $.proposals[proposalId_];

        if (proposal.txHashes[proposal.executionCounter] != txHash)
            revert InvalidTxHash();

        proposal.executionCounter++;

        if (
            !exec(
                transaction_.to,
                transaction_.value,
                transaction_.data,
                transaction_.operation
            )
        ) revert TxFailed();

        return txHash;
    }

    function _updateTimelockPeriod(uint32 timelockPeriod_) internal virtual {
        ModuleAzoriusStorage storage $ = _getModuleAzoriusStorage();
        $.timelockPeriod = timelockPeriod_;
        emit TimelockPeriodUpdated(timelockPeriod_);
    }

    function _updateExecutionPeriod(uint32 executionPeriod_) internal virtual {
        ModuleAzoriusStorage storage $ = _getModuleAzoriusStorage();
        $.executionPeriod = executionPeriod_;
        emit ExecutionPeriodUpdated(executionPeriod_);
    }

    function _updateStrategy(address strategy_) internal virtual {
        if (strategy_ == address(0)) revert InvalidStrategy();

        ModuleAzoriusStorage storage $ = _getModuleAzoriusStorage();
        $.strategy = IStrategyV1(strategy_);
        emit StrategyUpdated(strategy_);
    }
}
