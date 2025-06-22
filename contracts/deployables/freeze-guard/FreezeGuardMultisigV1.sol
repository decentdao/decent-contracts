// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IFreezeGuardMultisigV1} from "../../interfaces/decent/deployables/IFreezeGuardMultisigV1.sol";
import {IFreezeGuardBaseV1} from "../../interfaces/decent/deployables/IFreezeGuardBaseV1.sol";
import {IFreezeVotingBaseV1} from "../../interfaces/decent/deployables/IFreezeVotingBaseV1.sol";
import {ISafe} from "../../interfaces/safe/ISafe.sol";
import {IDeploymentBlockV1} from "../../interfaces/decent/IDeploymentBlockV1.sol";
import {IUUPSUpgradeableExtended} from "../../interfaces/decent/IUUPSUpgradeableExtended.sol";
import {DeploymentBlockV1} from "../../DeploymentBlockV1.sol";
import {UUPSUpgradeableExtended} from "../../UUPSUpgradeableExtended.sol";
import {Enum} from "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import {IGuard} from "@gnosis-guild/zodiac/contracts/interfaces/IGuard.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

/**
 * @title FreezeGuardMultisigV1
 * @author Decent Labs
 * @notice Implementation of freeze guard for multisig Safe child DAOs with timelock
 * @dev This contract implements IFreezeGuardMultisigV1, providing both transaction
 * blocking when frozen AND timelock functionality for multisig Safes.
 *
 * Implementation details:
 * - Uses EIP-7201 namespaced storage pattern for upgradeability safety
 * - Implements UUPS upgradeable pattern with owner-restricted upgrades
 * - Attached directly to Safe as a transaction guard
 * - Enforces timelock before execution + execution window
 * - Tracks timelocked transactions by signature hash
 * - Validates signatures through Safe's checkSignatures
 *
 * Security model:
 * - Transactions must be timelocked before execution
 * - Parent has timelock period to review and potentially freeze
 * - Execution window prevents indefinite pending transactions
 * - Blocks ALL transactions when frozen (no exceptions)
 *
 * @custom:security-contact security@decentlabs.io
 */
contract FreezeGuardMultisigV1 is
    IFreezeGuardMultisigV1,
    IVersion,
    UUPSUpgradeableExtended,
    Ownable2StepUpgradeable,
    DeploymentBlockV1,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /**
     * @notice Main storage struct for FreezeGuardMultisigV1 following EIP-7201
     * @dev Contains freeze voting reference, timelock parameters, and transaction tracking
     * @custom:storage-location erc7201:Decent.FreezeGuardMultisig.main
     */
    struct FreezeGuardMultisigStorage {
        /** @notice The FreezeVoting contract that determines if DAO is frozen */
        IFreezeVotingBaseV1 freezeVoting;
        /** @notice Duration transactions must wait after timelocking before execution */
        uint32 timelockPeriod;
        /** @notice Window after timelock expires during which execution is allowed */
        uint32 executionPeriod;
        /** @notice The child Safe this guard is protecting */
        ISafe childGnosisSafe;
        /** @notice Maps signature hash to when transaction was timelocked */
        mapping(bytes32 signaturesHash => uint48 timelockedTimestamp) transactionTimelocked;
    }

    /**
     * @dev Storage slot for FreezeGuardMultisigStorage calculated using EIP-7201 formula:
     * keccak256(abi.encode(uint256(keccak256("Decent.FreezeGuardMultisig.main")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 internal constant FREEZE_GUARD_MULTISIG_STORAGE_LOCATION =
        0xb27bf83f95540c9e5ad158f8f59db4886f77b3163b8b8808bcf0da8eb5fd2200;

    /**
     * @dev Returns the storage struct for FreezeGuardMultisigV1
     * Following the EIP-7201 namespaced storage pattern to avoid storage collisions
     */
    function _getFreezeGuardMultisigStorage()
        internal
        pure
        returns (FreezeGuardMultisigStorage storage $)
    {
        assembly {
            $.slot := FREEZE_GUARD_MULTISIG_STORAGE_LOCATION
        }
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    /**
     * @inheritdoc IFreezeGuardMultisigV1
     * @dev Initializes all inherited contracts and sets up timelock parameters.
     * Uses internal update functions to emit events for initial values.
     */
    function initialize(
        uint32 timelockPeriod_,
        uint32 executionPeriod_,
        address owner_,
        address freezeVoting_,
        address childGnosisSafe_
    ) public virtual override initializer {
        // Initialize inherited contracts
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();
        __DeploymentBlockV1_init();

        // Set timelock parameters (also emits events)
        _updateTimelockPeriod(timelockPeriod_);
        _updateExecutionPeriod(executionPeriod_);

        // Set contract references
        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();
        $.freezeVoting = IFreezeVotingBaseV1(freezeVoting_);
        $.childGnosisSafe = ISafe(childGnosisSafe_);
    }

    // ======================================================================
    // UUPSUpgradeable
    // ======================================================================

    // --- Internal Functions ---

    /**
     * @inheritdoc UUPSUpgradeable
     * @dev Restricts upgrades to the owner (typically the parent DAO)
     */
    function _authorizeUpgrade(
        address newImplementation_
    ) internal virtual override onlyOwner {}

    // ======================================================================
    // IFreezeGuardMultisigV1
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc IFreezeGuardMultisigV1
     */
    function timelockPeriod() public view virtual override returns (uint32) {
        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();
        return $.timelockPeriod;
    }

    /**
     * @inheritdoc IFreezeGuardMultisigV1
     */
    function executionPeriod() public view virtual override returns (uint32) {
        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();
        return $.executionPeriod;
    }

    /**
     * @inheritdoc IFreezeGuardMultisigV1
     */
    function childGnosisSafe() public view virtual override returns (address) {
        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();
        return address($.childGnosisSafe);
    }

    /**
     * @inheritdoc IFreezeGuardMultisigV1
     */
    function getTransactionTimelocked(
        bytes32 signaturesHash_
    ) public view virtual override returns (uint48) {
        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();
        return $.transactionTimelocked[signaturesHash_];
    }

    // --- State-Changing Functions ---

    /**
     * @inheritdoc IFreezeGuardMultisigV1
     * @dev Validates signatures through the Safe before recording timelock.
     * Uses signature hash as unique identifier to prevent duplicate timelocks.
     */
    function timelockTransaction(
        address to_,
        uint256 value_,
        bytes memory data_,
        Enum.Operation operation,
        uint256 safeTxGas_,
        uint256 baseGas_,
        uint256 gasPrice_,
        address gasToken_,
        address payable refundReceiver_,
        bytes calldata signatures_,
        uint256 nonce_
    ) public virtual override {
        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();

        // Check 1: Ensure this exact set of signatures hasn't been timelocked already
        // Using signature hash as unique identifier prevents replay attacks
        if ($.transactionTimelocked[keccak256(signatures_)] != 0)
            revert AlreadyTimelocked();

        // Step 1: Encode the transaction data in Safe's expected format
        // This ensures the transaction hash matches what Safe will calculate
        bytes memory transactionHashData = $
            .childGnosisSafe
            .encodeTransactionData(
                to_,
                value_,
                data_,
                operation,
                safeTxGas_,
                baseGas_,
                gasPrice_,
                gasToken_,
                refundReceiver_,
                nonce_
            );

        // Step 2: Calculate the transaction hash
        bytes32 transactionHash = keccak256(transactionHashData);

        // Step 3: Validate signatures through the Safe
        // This ensures only valid Safe signers can timelock transactions
        $.childGnosisSafe.checkSignatures(
            transactionHash,
            transactionHashData,
            signatures_
        );

        // Step 4: Record the timelock timestamp
        // Using current block timestamp as the start of timelock period
        $.transactionTimelocked[keccak256(signatures_)] = uint48(
            block.timestamp
        );

        // Step 5: Emit event for transparency
        emit TransactionTimelocked(msg.sender, transactionHash, signatures_);
    }

    /**
     * @inheritdoc IFreezeGuardMultisigV1
     */
    function updateTimelockPeriod(
        uint32 timelockPeriod_
    ) public virtual override onlyOwner {
        _updateTimelockPeriod(timelockPeriod_);
    }

    /**
     * @inheritdoc IFreezeGuardMultisigV1
     */
    function updateExecutionPeriod(
        uint32 executionPeriod_
    ) public virtual override onlyOwner {
        _updateExecutionPeriod(executionPeriod_);
    }

    // ======================================================================
    // IFreezeGuardBaseV1
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc IFreezeGuardBaseV1
     */
    function freezeVoting() public view virtual override returns (address) {
        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();
        return address($.freezeVoting);
    }

    // ======================================================================
    // IGuard
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc IGuard
     * @dev Called before transaction execution. Performs multiple validation checks:
     * 1. Transaction must be timelocked
     * 2. Timelock period must have passed
     * 3. Must be within execution window
     * 4. DAO must not be frozen
     * Only the signatures parameter is used; others are ignored.
     */
    function checkTransaction(
        address,
        uint256,
        bytes memory,
        Enum.Operation,
        uint256,
        uint256,
        uint256,
        address,
        address payable,
        bytes memory signatures_,
        address
    ) public view virtual override {
        // Use signature hash as the unique identifier for the transaction
        bytes32 signaturesHash = keccak256(signatures_);

        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();

        // Check 1: Transaction must have been timelocked first
        if ($.transactionTimelocked[signaturesHash] == 0)
            revert NotTimelocked();

        // Check 2: Timelock period must have passed
        // This gives parent DAO time to review and potentially freeze
        if (
            block.timestamp <
            $.transactionTimelocked[signaturesHash] + $.timelockPeriod
        ) revert Timelocked();

        // Check 3: Must be within execution window
        // Prevents indefinitely pending transactions
        if (
            block.timestamp >
            $.transactionTimelocked[signaturesHash] +
                $.timelockPeriod +
                $.executionPeriod
        ) revert Expired();

        // Check 4: DAO must not be frozen
        // Final check allows parent to block execution even after timelock
        if ($.freezeVoting.isFrozen()) revert DAOFrozen();
    }

    /**
     * @inheritdoc IGuard
     * @dev No post-execution checks needed. This guard only validates before execution.
     */
    function checkAfterExecution(bytes32, bool) public view virtual override {}

    // ======================================================================
    // IVersion
    // ======================================================================

    // --- Pure Functions ---

    /**
     * @inheritdoc IVersion
     */
    function version() public pure virtual override returns (uint16) {
        return 1;
    }

    // ======================================================================
    // ERC165
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc ERC165
     * @dev Supports IFreezeGuardMultisigV1, IFreezeGuardBaseV1, IGuard, IVersion, IDeploymentBlockV1, IUUPSUpgradeableExtended, and IERC165
     */
    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IFreezeGuardMultisigV1).interfaceId ||
            interfaceId_ == type(IFreezeGuardBaseV1).interfaceId ||
            interfaceId_ == type(IGuard).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            interfaceId_ == type(IUUPSUpgradeableExtended).interfaceId ||
            super.supportsInterface(interfaceId_);
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    /**
     * @notice Updates the timelock period and emits event
     * @dev Internal helper to ensure event is always emitted when period changes
     * @param timelockPeriod_ The new timelock period in seconds
     */
    function _updateTimelockPeriod(uint32 timelockPeriod_) internal virtual {
        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();
        $.timelockPeriod = timelockPeriod_;
        emit TimelockPeriodUpdated(timelockPeriod_);
    }

    /**
     * @notice Updates the execution period and emits event
     * @dev Internal helper to ensure event is always emitted when period changes
     * @param executionPeriod_ The new execution period in seconds
     */
    function _updateExecutionPeriod(uint32 executionPeriod_) internal virtual {
        FreezeGuardMultisigStorage storage $ = _getFreezeGuardMultisigStorage();
        $.executionPeriod = executionPeriod_;
        emit ExecutionPeriodUpdated(executionPeriod_);
    }
}
