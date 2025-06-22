// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IDecentHatsModificationModuleV1} from "../interfaces/decent/utilities/IDecentHatsModificationModuleV1.sol";
import {DecentHatsModuleUtils} from "./DecentHatsModuleUtils.sol";

/**
 * @title DecentHatsModificationModuleV1
 * @author Decent Labs
 * @notice Implementation for adding roles to existing Hats Protocol trees
 * @dev This contract implements IDecentHatsModificationModuleV1, providing
 * functionality to expand existing organizational structures.
 *
 * Implementation details:
 * - Temporarily attached as Safe module during execution
 * - Adds new roles to existing hat trees
 * - Inherits all functionality from DecentHatsModuleUtils
 * - Prevents race conditions in concurrent proposals
 * - Non-upgradeable utility contract
 *
 * Key differences from CreationModule:
 * - Assumes hat tree already exists
 * - Does not create top hat or admin hat
 * - Focuses only on adding new role hats
 * - Simpler execution flow
 *
 * Security considerations:
 * - Must be enabled as module before execution
 * - Should be disabled immediately after use
 * - All external calls go through Safe's execTransactionFromModule
 *
 * @custom:security-contact security@decentlabs.io
 */
contract DecentHatsModificationModuleV1 is
    IDecentHatsModificationModuleV1,
    DecentHatsModuleUtils
{
    // ======================================================================
    // IDecentHatsModificationModuleV1
    // ======================================================================

    // --- State-Changing Functions ---

    /**
     * @inheritdoc IDecentHatsModificationModuleV1
     * @dev Simply delegates to the inherited _processRoleHats function from
     * DecentHatsModuleUtils, which handles all the complex logic for creating
     * roles with payment streams.
     */
    function createRoleHats(
        CreateRoleHatsParams calldata roleHatsParams_
    ) public virtual override {
        _processRoleHats(roleHatsParams_);
    }
}
