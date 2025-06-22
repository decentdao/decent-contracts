// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IFreezeGuardAzoriusV1} from "../../interfaces/decent/deployables/IFreezeGuardAzoriusV1.sol";
import {IFreezeVotingBaseV1} from "../../interfaces/decent/deployables/IFreezeVotingBaseV1.sol";
import {IFreezeGuardBaseV1} from "../../interfaces/decent/deployables/IFreezeGuardBaseV1.sol";
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
 * @title FreezeGuardAzoriusV1
 * @author Decent Labs
 * @notice Implementation of freeze guard for Azorius-based child DAOs
 * @dev This contract implements IFreezeGuardAzoriusV1, providing transaction blocking
 * functionality when a child DAO is frozen by its parent DAO.
 *
 * Implementation details:
 * - Uses EIP-7201 namespaced storage pattern for upgradeability safety
 * - Implements UUPS upgradeable pattern with owner-restricted upgrades
 * - Attached as a guard to Azorius module (not directly to Safe)
 * - Checks freeze status before every transaction execution
 * - Owner can update freeze voting contract reference
 * - No post-execution checks needed (empty checkAfterExecution)
 *
 * Security model:
 * - Only reads freeze status, doesn't control freeze voting
 * - Blocks ALL transactions when frozen (no exceptions)
 * - Owner is typically the child DAO itself for self-governance
 *
 * @custom:security-contact security@decentlabs.io
 */
contract FreezeGuardAzoriusV1 is
    IFreezeGuardAzoriusV1,
    IVersion,
    UUPSUpgradeableExtended,
    DeploymentBlockV1,
    Ownable2StepUpgradeable,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /**
     * @notice Main storage struct for FreezeGuardAzoriusV1 following EIP-7201
     * @dev Contains reference to the freeze voting contract
     * @custom:storage-location erc7201:Decent.FreezeGuardAzorius.main
     */
    struct FreezeGuardAzoriusStorage {
        /** @notice The FreezeVoting contract that determines if DAO is frozen */
        IFreezeVotingBaseV1 freezeVoting;
    }

    /**
     * @dev Storage slot for FreezeGuardAzoriusStorage calculated using EIP-7201 formula:
     * keccak256(abi.encode(uint256(keccak256("Decent.FreezeGuardAzorius.main")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 internal constant FREEZE_GUARD_AZORIUS_STORAGE_LOCATION =
        0x42f8f7e17893446d49739bff9f1513ff5cdb28566127f8e28b562c45b4b30f00;

    /**
     * @dev Returns the storage struct for FreezeGuardAzoriusV1
     * Following the EIP-7201 namespaced storage pattern to avoid storage collisions
     */
    function _getFreezeGuardAzoriusStorage()
        internal
        pure
        returns (FreezeGuardAzoriusStorage storage $)
    {
        assembly {
            $.slot := FREEZE_GUARD_AZORIUS_STORAGE_LOCATION
        }
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    /**
     * @inheritdoc IFreezeGuardAzoriusV1
     * @dev Initializes all inherited contracts and sets the freeze voting reference.
     * The owner is typically the child DAO's Safe for self-governance.
     */
    function initialize(
        address owner_,
        address freezeVoting_
    ) public virtual override initializer {
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();
        __DeploymentBlockV1_init();

        FreezeGuardAzoriusStorage storage $ = _getFreezeGuardAzoriusStorage();
        $.freezeVoting = IFreezeVotingBaseV1(freezeVoting_);
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
    // IFreezeGuardBaseV1
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc IFreezeGuardBaseV1
     */
    function freezeVoting() public view virtual override returns (address) {
        FreezeGuardAzoriusStorage storage $ = _getFreezeGuardAzoriusStorage();
        return address($.freezeVoting);
    }

    // ======================================================================
    // IGuard
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc IGuard
     * @dev Called before transaction execution. Reverts if the DAO is frozen.
     * All parameters are ignored - the only check is freeze status.
     * This ensures no transactions can be executed while the DAO is frozen.
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
        bytes memory,
        address
    ) public view virtual override {
        FreezeGuardAzoriusStorage storage $ = _getFreezeGuardAzoriusStorage();

        // Simple check: if frozen, block ALL transactions
        if ($.freezeVoting.isFrozen()) revert DAOFrozen();
    }

    /**
     * @inheritdoc IGuard
     * @dev No post-execution checks needed. This guard only prevents execution when frozen.
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
     * @dev Supports IFreezeGuardAzoriusV1, IFreezeGuardBaseV1, IGuard, IVersion, IDeploymentBlockV1, IUUPSUpgradeableExtended, and IERC165
     */
    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IFreezeGuardAzoriusV1).interfaceId ||
            interfaceId_ == type(IFreezeGuardBaseV1).interfaceId ||
            interfaceId_ == type(IGuard).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            interfaceId_ == type(IUUPSUpgradeableExtended).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
