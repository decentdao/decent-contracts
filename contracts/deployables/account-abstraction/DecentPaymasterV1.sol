// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IDecentPaymasterV1} from "../../interfaces/decent/deployables/IDecentPaymasterV1.sol";
import {IFunctionValidator} from "../../interfaces/decent/services/IFunctionValidator.sol";
import {ILightAccountValidatorV1} from "../../interfaces/decent/deployables/ILightAccountValidatorV1.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlockV1} from "../../interfaces/decent/IDeploymentBlockV1.sol";
import {IUUPSUpgradeableExtended} from "../../interfaces/decent/IUUPSUpgradeableExtended.sol";
import {BasePaymasterV1} from "./BasePaymasterV1.sol";
import {LightAccountValidatorV1} from "./LightAccountValidatorV1.sol";
import {DeploymentBlockV1} from "../../DeploymentBlockV1.sol";
import {UUPSUpgradeableExtended} from "../../UUPSUpgradeableExtended.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation, IPaymaster} from "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @title DecentPaymasterV1
 * @author Decent Labs
 * @notice Implementation of ERC-4337 paymaster for gasless transactions
 * @dev This contract implements IDecentPaymasterV1, providing gas sponsorship
 * for Light Account operations in the Decent Protocol.
 *
 * Implementation details:
 * - Uses EIP-7201 namespaced storage pattern for upgradeability safety
 * - Implements UUPS upgradeable pattern with owner-restricted upgrades
 * - Inherits BasePaymasterV1 for core paymaster functionality
 * - Inherits LightAccountValidatorV1 for Light Account validation
 * - Uses function validators for operation authorization
 *
 * Key responsibilities:
 * - Sponsor gas fees for whitelisted operations
 * - Validate operations through external validator contracts
 * - Manage per-function validation configuration
 * - Support Light Account operations for gasless UX
 *
 * Security model:
 * - Owner controls validator configuration
 * - Each function selector can have its own validator
 * - Validators determine which operations to sponsor
 * - Only valid operations receive gas sponsorship
 *
 * @custom:security-contact security@decentlabs.io
 */
contract DecentPaymasterV1 is
    IDecentPaymasterV1,
    IVersion,
    BasePaymasterV1,
    LightAccountValidatorV1,
    DeploymentBlockV1,
    UUPSUpgradeableExtended,
    Ownable2StepUpgradeable,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /**
     * @notice Main storage struct for DecentPaymasterV1 following EIP-7201
     * @dev Contains validator configuration for function-level access control
     * @custom:storage-location erc7201:Decent.DecentPaymaster.main
     */
    struct DecentPaymasterStorage {
        /** @notice Maps target contract and function selector to validator address */
        mapping(address target => mapping(bytes4 selector => address validator)) functionValidators;
    }

    /**
     * @dev Storage slot for DecentPaymasterStorage calculated using EIP-7201 formula:
     * keccak256(abi.encode(uint256(keccak256("Decent.DecentPaymaster.main")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 internal constant DECENT_PAYMASTER_STORAGE_LOCATION =
        0x9864cc6d2ebb52de6c6d593dbda2be2b4542b9f136a6d2b6285312464a440f00;

    /**
     * @dev Returns the storage struct for DecentPaymasterV1
     * Following the EIP-7201 namespaced storage pattern to avoid storage collisions
     */
    function _getDecentPaymasterStorage()
        internal
        pure
        returns (DecentPaymasterStorage storage $)
    {
        assembly {
            $.slot := DECENT_PAYMASTER_STORAGE_LOCATION
        }
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    /**
     * @inheritdoc IDecentPaymasterV1
     * @dev Initializes all inherited contracts and sets up the paymaster
     * for ERC-4337 operations with Light Account support.
     */
    function initialize(
        address owner_,
        address entryPoint_,
        address lightAccountFactory_
    ) public virtual override initializer {
        __BasePaymasterV1_init(owner_, IEntryPoint(entryPoint_));
        __LightAccountValidatorV1_init(lightAccountFactory_);
        __DeploymentBlockV1_init();
    }

    // ======================================================================
    // UUPSUpgradeable
    // ======================================================================

    // --- Internal Functions ---

    /**
     * @inheritdoc UUPSUpgradeable
     * @dev Restricts upgrades to the owner
     */
    function _authorizeUpgrade(
        address newImplementation_
    ) internal virtual override onlyOwner {}

    // ======================================================================
    // IDecentPaymasterV1
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc IDecentPaymasterV1
     */
    function getFunctionValidator(
        address target_,
        bytes4 selector_
    ) public view virtual override returns (address) {
        DecentPaymasterStorage storage $ = _getDecentPaymasterStorage();
        return $.functionValidators[target_][selector_];
    }

    // --- State-Changing Functions ---

    /**
     * @inheritdoc IDecentPaymasterV1
     * @dev Validates that the validator implements IFunctionValidator interface
     * before setting. This ensures only compatible validators can be configured.
     */
    function setFunctionValidator(
        address target_,
        bytes4 selector_,
        address validator_
    ) public virtual override onlyOwner {
        // Check 1: Validator cannot be zero address
        if (validator_ == address(0)) revert InvalidValidator();

        // Check 2: Validator must implement IFunctionValidator interface
        if (
            !IERC165(validator_).supportsInterface(
                type(IFunctionValidator).interfaceId
            )
        ) {
            revert InvalidValidator();
        }

        // Set the validator for the target function
        DecentPaymasterStorage storage $ = _getDecentPaymasterStorage();
        $.functionValidators[target_][selector_] = validator_;

        // Emit event for transparency
        emit FunctionValidatorSet(target_, selector_, validator_);
    }

    /**
     * @inheritdoc IDecentPaymasterV1
     */
    function removeFunctionValidator(
        address target_,
        bytes4 selector_
    ) public virtual override onlyOwner {
        DecentPaymasterStorage storage $ = _getDecentPaymasterStorage();
        $.functionValidators[target_][selector_] = address(0);

        emit FunctionValidatorRemoved(target_, selector_);
    }

    // ======================================================================
    // BasePaymasterV1
    // ======================================================================

    // --- Internal Functions ---

    /**
     * @inheritdoc BasePaymasterV1
     * @dev Validates user operations by checking with the configured function validator.
     * Extracts the target contract and function selector from the user operation,
     * then delegates validation to the appropriate validator contract.
     */
    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp_,
        bytes32,
        uint256
    ) internal view virtual override returns (bytes memory, uint256) {
        // Step 1: Extract operation details from the user operation
        (
            address lightAccountOwner,
            address target,
            bytes memory innerCallData
        ) = _validateUserOp(userOp_);

        // Step 2: Extract function selector from calldata
        bytes4 selector = bytes4(innerCallData);

        DecentPaymasterStorage storage $ = _getDecentPaymasterStorage();

        // Step 3: Check if function has a validator configured
        address validator = $.functionValidators[target][selector];
        if (validator == address(0)) {
            revert NoValidatorSet(target, selector);
        }

        // Step 4: Delegate validation to the configured validator
        bool isValid = IFunctionValidator(validator).validateOperation(
            userOp_.sender,
            lightAccountOwner,
            target,
            innerCallData
        );

        // Step 5: Revert if validation fails
        if (!isValid) {
            revert ValidationFailed(target, selector);
        }

        // Return empty context and validation success (0)
        return (bytes(""), 0);
    }

    // ======================================================================
    // Ownable2StepUpgradeable
    // ======================================================================

    // --- State-Changing Functions ---

    /**
     * @inheritdoc Ownable2StepUpgradeable
     * @dev Overrides both Ownable2StepUpgradeable and OwnableUpgradeable to use
     * the two-step ownership transfer process
     */
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

    /**
     * @inheritdoc Ownable2StepUpgradeable
     * @dev Overrides both Ownable2StepUpgradeable and OwnableUpgradeable to use
     * the two-step ownership transfer process
     */
    function _transferOwnership(
        address newOwner_
    ) internal virtual override(Ownable2StepUpgradeable, OwnableUpgradeable) {
        Ownable2StepUpgradeable._transferOwnership(newOwner_);
    }

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
     * @dev Supports IDecentPaymasterV1, ILightAccountValidatorV1, IPaymaster, IVersion, IDeploymentBlockV1, IUUPSUpgradeableExtended, and IERC165
     */
    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IDecentPaymasterV1).interfaceId ||
            interfaceId_ == type(ILightAccountValidatorV1).interfaceId ||
            interfaceId_ == type(IPaymaster).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            interfaceId_ == type(IUUPSUpgradeableExtended).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
