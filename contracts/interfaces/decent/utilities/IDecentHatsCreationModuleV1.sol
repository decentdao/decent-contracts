// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IDecentHatsModuleUtils} from "./IDecentHatsModuleUtils.sol";

/**
 * @title IDecentHatsCreationModuleV1
 * @notice Utility module for creating complete Hats Protocol trees with roles and payment streams
 * @dev This module extends DecentHatsModuleUtils to provide a complete solution for creating
 * organizational structures from scratch. It handles the creation of top hats, admin hats,
 * and role hats with associated payment streams in a single transaction.
 *
 * Key features:
 * - Creates new Hats trees for Safes that don't have one
 * - Sets up hierarchical structure with top hat and admin hat
 * - Creates multiple role hats with payment streams
 * - Integrates with DecentAutonomousAdmin for automated administration
 * - Associates the tree with the Safe using KeyValuePairs
 *
 * Workflow:
 * 1. Safe enables this module temporarily
 * 2. Module creates top hat and transfers it to the Safe
 * 3. Module creates admin hat with autonomous admin if specified
 * 4. Module creates all role hats with their configurations
 * 5. Module sets up payment streams for each role
 * 6. Safe disables the module
 *
 * Use cases:
 * - Initial DAO setup with complete role structure
 * - Creating new departments or teams within a DAO
 * - Setting up compensation structures for contributors
 * - Establishing governance hierarchies
 */
interface IDecentHatsCreationModuleV1 {
    // --- Structs ---

    /**
     * @notice Parameters for creating the top hat
     * @param details IPFS hash or description of the top hat
     * @param imageURI IPFS hash or URL for the top hat's image
     */
    struct TopHatParams {
        string details;
        string imageURI;
    }

    /**
     * @notice Parameters for creating the admin hat
     * @param details IPFS hash or description of the admin hat
     * @param imageURI IPFS hash or URL for the admin hat's image
     * @param isMutable Whether the admin hat's properties can be changed
     */
    struct AdminHatParams {
        string details;
        string imageURI;
        bool isMutable;
    }

    /**
     * @notice Parameters for creating a complete Hats tree
     * @param hatsProtocol The Hats Protocol contract address
     * @param erc6551Registry Registry for creating token-bound accounts
     * @param hatsModuleFactory Factory for creating Hats modules
     * @param systemDeployer System deployer for creating proxies
     * @param keyValuePairs Contract for emitting metadata
     * @param decentAutonomousAdminImplementation Implementation for autonomous admin
     * @param hatsAccountImplementation Implementation for Hat accounts
     * @param hatsElectionsEligibilityImplementation Election module implementation
     * @param topHat Configuration for the top hat
     * @param adminHat Configuration for the admin hat
     * @param hats Array of role hats to create under the admin
     */
    struct CreateTreeParams {
        address hatsProtocol;
        address erc6551Registry;
        address hatsModuleFactory;
        address systemDeployer;
        address keyValuePairs;
        address decentAutonomousAdminImplementation;
        address hatsAccountImplementation;
        address hatsElectionsEligibilityImplementation;
        TopHatParams topHat;
        AdminHatParams adminHat;
        IDecentHatsModuleUtils.HatParams[] hats;
    }

    // --- State-Changing Functions ---

    /**
     * @notice Creates a complete Hats tree and declares it for the calling Safe
     * @dev This function should be called by a Safe that has temporarily enabled this module.
     * It creates the entire organizational structure in one transaction:
     * 1. Creates and mints a top hat to the Safe
     * 2. Creates an admin hat
     * 3. Creates all specified role hats with their parameters
     * 4. Sets up payment streams for each role
     * 5. Emits metadata to associate the tree with the Safe
     *
     * For termed hats, streams target the wearer directly.
     * For untermed hats, streams target the hat's smart account.
     *
     * @param treeParams_ Complete configuration for the Hats tree
     * @custom:security Module should be disabled after execution
     */
    function createAndDeclareTree(
        CreateTreeParams calldata treeParams_
    ) external;
}
