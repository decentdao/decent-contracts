// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {DecentHatsModuleUtils} from "../../../utilities/DecentHatsModuleUtils.sol";

/**
 * @title IDecentHatsModificationModuleV1
 * @notice Utility module for adding new roles to an existing Hats Protocol tree
 * @dev This module provides functionality to create additional role hats within an
 * existing organizational structure. Unlike the creation module, this assumes a
 * hat tree already exists and focuses on adding new roles with payment streams.
 *
 * Key features:
 * - Adds new roles to existing Hats trees
 * - Creates payment streams for new roles
 * - Supports both termed and untermed positions
 * - Handles eligibility modules for elections
 * - Avoids race conditions in concurrent proposals
 *
 * Workflow:
 * 1. Safe with existing hat tree enables this module
 * 2. Module creates new role hats under existing admin
 * 3. Module sets up payment streams for each role
 * 4. Module creates eligibility modules if needed
 * 5. Safe disables the module
 *
 * Use cases:
 * - Adding new contributors to a DAO
 * - Creating new positions as organization grows
 * - Setting up seasonal or temporary roles
 * - Expanding team structures
 *
 * Security:
 * - Module should only be temporarily enabled
 * - Prevents concurrent role creation proposals
 * - Ensures proper stream recipient setup
 */
interface IDecentHatsModificationModuleV1 {
    // --- State-Changing Functions ---

    /**
     * @notice Creates new role hats with payment streams in an existing tree
     * @dev This function should be called by a Safe that has an existing hat tree
     * and has temporarily enabled this module. It handles the complete setup:
     * 1. Creates eligibility modules for termed positions
     * 2. Creates and mints the role hats
     * 3. Sets up token-bound accounts for stream recipients
     * 4. Creates Sablier payment streams
     *
     * Stream recipient logic:
     * - Termed roles: streams target the wearer directly
     * - Untermed roles: streams target the hat's smart account
     *
     * This design avoids race conditions where multiple proposals to create
     * roles could conflict with each other.
     *
     * @param roleHatsParams_ Configuration for the new role hats to create
     * @custom:security Module should be disabled after execution
     */
    function createRoleHats(
        DecentHatsModuleUtils.CreateRoleHatsParams calldata roleHatsParams_
    ) external;
}
