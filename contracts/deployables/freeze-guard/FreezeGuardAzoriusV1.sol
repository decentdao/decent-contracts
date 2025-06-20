// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IFreezeGuardAzoriusV1} from "../../interfaces/decent/deployables/IFreezeGuardAzoriusV1.sol";
import {IFreezeVotingBaseV1} from "../../interfaces/decent/deployables/IFreezeVotingBaseV1.sol";
import {IFreezeGuardBaseV1} from "../../interfaces/decent/deployables/IFreezeGuardBaseV1.sol";
import {IDeploymentBlockV1} from "../../interfaces/decent/IDeploymentBlockV1.sol";
import {DeploymentBlockV1} from "../../DeploymentBlockV1.sol";
import {Enum} from "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import {IGuard} from "@gnosis-guild/zodiac/contracts/interfaces/IGuard.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

contract FreezeGuardAzoriusV1 is
    IFreezeGuardAzoriusV1,
    IVersion,
    Ownable2StepUpgradeable,
    UUPSUpgradeable,
    DeploymentBlockV1,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /// @custom:storage-location erc7201:Decent.FreezeGuardAzorius.main
    struct FreezeGuardAzoriusStorage {
        IFreezeVotingBaseV1 freezeVoting;
    }

    // EIP-7201: keccak256(abi.encode(uint256(keccak256("Decent.FreezeGuardAzorius.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant FREEZE_GUARD_AZORIUS_STORAGE_LOCATION =
        0x42f8f7e17893446d49739bff9f1513ff5cdb28566127f8e28b562c45b4b30f00;

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
    // UUPS UPGRADEABLE
    // ======================================================================

    // --- Internal Functions ---

    function _authorizeUpgrade(
        address newImplementation_
    ) internal virtual override onlyOwner {}

    // ======================================================================
    // IFreezeGuardBaseV1
    // ======================================================================

    // --- View Functions ---

    function freezeVoting() public view virtual override returns (address) {
        FreezeGuardAzoriusStorage storage $ = _getFreezeGuardAzoriusStorage();
        return address($.freezeVoting);
    }

    // ======================================================================
    // IGuard
    // ======================================================================

    // --- View Functions ---

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
        if ($.freezeVoting.isFrozen()) revert DAOFrozen();
    }

    function checkAfterExecution(bytes32, bool) public view virtual override {}

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
            interfaceId_ == type(IFreezeGuardAzoriusV1).interfaceId ||
            interfaceId_ == type(IFreezeGuardBaseV1).interfaceId ||
            interfaceId_ == type(IGuard).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
