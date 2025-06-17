// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IDecentAutonomousAdminV1} from "../../interfaces/decent/deployables/IDecentAutonomousAdminV1.sol";
import {IHatsElectionsEligibility} from "../../interfaces/hats/modules/IHatsElectionsEligibility.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract DecentAutonomousAdminV1 is
    IDecentAutonomousAdminV1,
    IVersion,
    Initializable,
    ERC165
{
    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function initialize() public virtual override initializer {}

    // ======================================================================
    // IDecentAutonomousAdminV1
    // ======================================================================

    // --- State-Changing Functions ---

    function triggerStartNextTerm(
        TriggerStartArgs calldata args_
    ) public virtual override {
        IHatsElectionsEligibility hatsElectionModule = IHatsElectionsEligibility(
                args_.hatsProtocol.getHatEligibilityModule(args_.hatId)
            );

        hatsElectionModule.startNextTerm();

        // This will burn the hat if wearer is no longer eligible
        args_.hatsProtocol.checkHatWearerStatus(
            args_.hatId,
            args_.currentWearer
        );

        // This will mint the hat to the nominated wearer, if necessary
        if (args_.nominatedWearer != args_.currentWearer) {
            args_.hatsProtocol.mintHat(args_.hatId, args_.nominatedWearer);
        }
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
            interfaceId_ == type(IDecentAutonomousAdminV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
