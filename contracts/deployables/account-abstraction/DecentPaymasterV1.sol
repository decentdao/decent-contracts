// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IDecentPaymasterV1} from "../../interfaces/decent/deployables/IDecentPaymasterV1.sol";
import {IFunctionValidator} from "../../interfaces/decent/services/IFunctionValidator.sol";
import {ILightAccountValidatorV1} from "../../interfaces/decent/deployables/ILightAccountValidatorV1.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlockV1} from "../../interfaces/decent/IDeploymentBlockV1.sol";
import {BasePaymasterV1} from "./BasePaymasterV1.sol";
import {LightAccountValidatorV1} from "./LightAccountValidatorV1.sol";
import {DeploymentBlockV1} from "../../DeploymentBlockV1.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation, IPaymaster} from "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract DecentPaymasterV1 is
    IDecentPaymasterV1,
    IVersion,
    BasePaymasterV1,
    LightAccountValidatorV1,
    DeploymentBlockV1,
    Ownable2StepUpgradeable,
    UUPSUpgradeable,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /// @custom:storage-location erc7201:Decent.DecentPaymaster.main
    struct DecentPaymasterStorage {
        mapping(address target => mapping(bytes4 selector => address validator)) functionValidators;
    }

    // EIP-7201: keccak256(abi.encode(uint256(keccak256("Decent.DecentPaymaster.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant DECENT_PAYMASTER_STORAGE_LOCATION =
        0x9864cc6d2ebb52de6c6d593dbda2be2b4542b9f136a6d2b6285312464a440f00;

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
    // UUPS UPGRADEABLE
    // ======================================================================

    // --- Internal Functions ---

    function _authorizeUpgrade(
        address newImplementation_
    ) internal virtual override onlyOwner {}

    // ======================================================================
    // IDecentPaymasterV1
    // ======================================================================

    // --- View Functions ---

    function getFunctionValidator(
        address target_,
        bytes4 selector_
    ) public view virtual override returns (address) {
        DecentPaymasterStorage storage $ = _getDecentPaymasterStorage();
        return $.functionValidators[target_][selector_];
    }

    // --- State-Changing Functions ---

    function setFunctionValidator(
        address target_,
        bytes4 selector_,
        address validator_
    ) public virtual override onlyOwner {
        if (validator_ == address(0)) revert InvalidValidator();

        if (
            !IERC165(validator_).supportsInterface(
                type(IFunctionValidator).interfaceId
            )
        ) {
            revert InvalidValidator();
        }

        DecentPaymasterStorage storage $ = _getDecentPaymasterStorage();
        $.functionValidators[target_][selector_] = validator_;

        emit FunctionValidatorSet(target_, selector_, validator_);
    }

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

    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp_,
        bytes32,
        uint256
    ) internal view virtual override returns (bytes memory, uint256) {
        (
            address lightAccountOwner,
            address target,
            bytes memory innerCallData
        ) = _validateUserOp(userOp_);

        bytes4 selector = bytes4(innerCallData);

        DecentPaymasterStorage storage $ = _getDecentPaymasterStorage();

        // Check if function has a validator
        address validator = $.functionValidators[target][selector];
        if (validator == address(0)) {
            revert NoValidatorSet(target, selector);
        }

        // Validate the operation will succeed
        bool isValid = IFunctionValidator(validator).validateOperation(
            userOp_.sender,
            lightAccountOwner,
            target,
            innerCallData
        );

        if (!isValid) {
            revert ValidationFailed(target, selector);
        }

        return (abi.encode(), 0);
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
    // IVersion
    // ======================================================================

    // --- Pure Functions ---

    function version() public pure virtual override returns (uint16) {
        return 1;
    }

    // ======================================================================
    // ERC165
    // ======================================================================

    // --- View Functions ---

    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IDecentPaymasterV1).interfaceId ||
            interfaceId_ == type(ILightAccountValidatorV1).interfaceId ||
            interfaceId_ == type(IPaymaster).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
