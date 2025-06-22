// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IDecentAutonomousAdminV1} from "../../interfaces/decent/deployables/IDecentAutonomousAdminV1.sol";
import {IHatsElectionsEligibility} from "../../interfaces/hats/modules/IHatsElectionsEligibility.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlock} from "../../interfaces/decent/IDeploymentBlock.sol";
import {DeploymentBlock} from "../../DeploymentBlock.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/**
 * @title DecentAutonomousAdminV1
 * @author Decent Labs
 * @notice Implementation of autonomous administration for Hats Protocol roles
 * @dev This contract implements IDecentAutonomousAdminV1, providing automated
 * term transitions for Hats that use the HatsElectionsEligibility module.
 *
 * Implementation details:
 * - Deployed once per admin hat as a UUPS proxy
 * - Stateless and permissionless operation
 * - Anyone can trigger term transitions
 * - Integrates with HatsElectionsEligibility module
 * - Handles automatic hat burning and minting
 *
 * Workflow:
 * 1. DecentHatsCreationModule deploys and mints admin hat to this contract
 * 2. This contract becomes the admin for child role hats
 * 3. When terms expire, anyone can call triggerStartNextTerm
 * 4. Transitions happen automatically without manual intervention
 *
 * Security considerations:
 * - No access control - relies on elections module validation
 * - Cannot be used to arbitrarily mint/burn hats
 * - Only works with HatsElectionsEligibility module
 * - Ensures proper term transitions without centralized control
 *
 * @custom:security-contact security@decentlabs.io
 */
contract DecentAutonomousAdminV1 is
    IDecentAutonomousAdminV1,
    IVersion,
    DeploymentBlock,
    ERC165
{
    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    /**
     * @inheritdoc IDecentAutonomousAdminV1
     */
    function initialize() public virtual override initializer {
        __DeploymentBlock_init();
    }

    // ======================================================================
    // IDecentAutonomousAdminV1
    // ======================================================================

    // --- State-Changing Functions ---

    /**
     * @inheritdoc IDecentAutonomousAdminV1
     * @dev Executes the term transition in three steps:
     * 1. Calls startNextTerm on the elections module to advance the term
     * 2. Checks current wearer's eligibility (burns hat if ineligible)
     * 3. Mints hat to new nominee if different from current wearer
     *
     * This function is permissionless by design to ensure timely transitions.
     */
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
     * @dev Supports IDecentAutonomousAdminV1, IVersion, IDeploymentBlock, and IERC165
     */
    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IDecentAutonomousAdminV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlock).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
