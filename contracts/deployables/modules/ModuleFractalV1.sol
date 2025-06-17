// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IModuleFractalV1} from "../../interfaces/decent/deployables/IModuleFractalV1.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlockV1} from "../../interfaces/decent/IDeploymentBlockV1.sol";
import {Transaction} from "../../interfaces/decent/Module.sol";
import {DeploymentBlockV1} from "../../DeploymentBlockV1.sol";
import {GuardableModule, Enum} from "@gnosis-guild/zodiac/contracts/core/GuardableModule.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract ModuleFractalV1 is
    IModuleFractalV1,
    IVersion,
    GuardableModule,
    DeploymentBlockV1,
    Ownable2StepUpgradeable,
    UUPSUpgradeable,
    ERC165
{
    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        address avatar_,
        address target_
    ) public virtual override initializer {
        __UUPSUpgradeable_init();
        __Ownable_init(owner_);
        __DeploymentBlockV1_init();

        avatar = avatar_;
        target = target_;
        emit AvatarSet(address(0), avatar_);
        emit TargetSet(address(0), target_);
    }

    function setUp(
        bytes memory initializeParams_
    ) public virtual override initializer {
        (address owner_, address avatar_, address target_) = abi.decode(
            initializeParams_,
            (address, address, address)
        );
        initialize(owner_, avatar_, target_);
    }

    // ======================================================================
    // UUPS UPGRADEABLE
    // ======================================================================

    // --- Internal Functions ---

    function _authorizeUpgrade(
        address newImplementation_
    ) internal virtual override onlyOwner {}

    // ======================================================================
    // IModuleFractalV1
    // ======================================================================

    // --- State-Changing Functions ---

    function execTx(
        Transaction calldata transaction_
    ) public virtual override onlyOwner {
        if (
            !exec(
                transaction_.to,
                transaction_.value,
                transaction_.data,
                transaction_.operation
            )
        ) revert TxFailed();
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
            interfaceId_ == type(IModuleFractalV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
