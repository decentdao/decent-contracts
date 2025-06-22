// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IDecentHatsCreationModuleV1} from "../interfaces/decent/utilities/IDecentHatsCreationModuleV1.sol";
import {IDecentAutonomousAdminV1} from "../interfaces/decent/deployables/IDecentAutonomousAdminV1.sol";
import {ISystemDeployerV1} from "../interfaces/decent/singletons/ISystemDeployerV1.sol";
import {IKeyValuePairsV1} from "../interfaces/decent/singletons/IKeyValuePairsV1.sol";
import {IERC6551Registry} from "../interfaces/erc6551/IERC6551Registry.sol";
import {IHats} from "../interfaces/hats/IHats.sol";
import {DecentHatsModuleUtils} from "./DecentHatsModuleUtils.sol";
import {Enum} from "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import {IAvatar} from "@gnosis-guild/zodiac/contracts/interfaces/IAvatar.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @notice Extended Hats interface to access lastTopHatId
 * @dev This interface adds the lastTopHatId getter which is present in the
 * Hats contract but not exposed in the standard IHats interface.
 */
interface IHatsExtended is IHats {
    /** @notice Returns the ID of the most recently created top hat */
    function lastTopHatId() external view returns (uint32 lastTopHatId);
}

/**
 * @title DecentHatsCreationModuleV1
 * @author Decent Labs
 * @notice Implementation of Hats tree creation for DAOs with payment streams
 * @dev This contract implements IDecentHatsCreationModuleV1, providing a complete
 * solution for creating organizational structures from scratch.
 *
 * Implementation details:
 * - Temporarily attached as Safe module during execution
 * - Creates complete Hats trees in a single transaction
 * - Deploys autonomous admin for automated role management
 * - Sets up payment streams for all roles
 * - Associates tree with Safe via KeyValuePairs
 * - Non-upgradeable utility contract
 *
 * Execution flow:
 * 1. Creates and mints top hat to the Safe
 * 2. Creates top hat's ERC6551 account
 * 3. Creates admin hat with autonomous admin wearer
 * 4. Creates all role hats with configurations
 * 5. Sets up payment streams per role
 * 6. Emits metadata for tree association
 *
 * Security considerations:
 * - Must be enabled as module before execution
 * - Should be disabled immediately after use
 * - All external calls go through Safe's execTransactionFromModule
 *
 * @custom:security-contact security@decentlabs.io
 */
contract DecentHatsCreationModuleV1 is
    IDecentHatsCreationModuleV1,
    DecentHatsModuleUtils
{
    // ======================================================================
    // IDecentHatsCreationModuleV1
    // ======================================================================

    // --- State-Changing Functions ---

    /**
     * @inheritdoc IDecentHatsCreationModuleV1
     * @dev Creates a complete organizational structure in one transaction.
     * The top hat is minted to the calling Safe, establishing ownership.
     * An autonomous admin is deployed to manage the admin hat for automated operations.
     * All role hats are created with their specified configurations and payment streams.
     */
    function createAndDeclareTree(
        CreateTreeParams calldata treeParams_
    ) public virtual override {
        // Create Top Hat
        (uint256 topHatId, address topHatAccount) = _processTopHat(
            treeParams_.hatsProtocol,
            treeParams_.erc6551Registry,
            treeParams_.hatsAccountImplementation,
            treeParams_.keyValuePairs,
            treeParams_.topHat
        );

        // Create Admin Hat
        uint256 adminHatId = _processAdminHat(
            treeParams_.hatsProtocol,
            treeParams_.erc6551Registry,
            treeParams_.hatsAccountImplementation,
            topHatId,
            topHatAccount,
            treeParams_.systemDeployer,
            treeParams_.decentAutonomousAdminImplementation,
            treeParams_.adminHat
        );

        // Create Role Hats
        _processRoleHats(
            CreateRoleHatsParams({
                hatsProtocol: treeParams_.hatsProtocol,
                erc6551Registry: treeParams_.erc6551Registry,
                hatsAccountImplementation: treeParams_
                    .hatsAccountImplementation,
                topHatId: topHatId,
                topHatAccount: topHatAccount,
                hatsModuleFactory: treeParams_.hatsModuleFactory,
                hatsElectionsEligibilityImplementation: treeParams_
                    .hatsElectionsEligibilityImplementation,
                adminHatId: adminHatId,
                hats: treeParams_.hats,
                keyValuePairs: treeParams_.keyValuePairs
            })
        );
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    /**
     * @notice Creates and configures the top hat for the organization
     * @dev Mints the top hat to the Safe and creates its ERC6551 account.
     * The top hat ID is stored in KeyValuePairs for off-chain indexing.
     * @param hatsProtocol_ Hats Protocol contract address
     * @param erc6551Registry_ Registry for creating token-bound accounts
     * @param hatsAccountImplementation_ Implementation for Hat accounts
     * @param keyValuePairs_ Contract for emitting metadata
     * @param topHat_ Configuration for the top hat
     * @return topHatId The ID of the created top hat
     * @return topHatAccount The ERC6551 account address for the top hat
     */
    function _processTopHat(
        address hatsProtocol_,
        address erc6551Registry_,
        address hatsAccountImplementation_,
        address keyValuePairs_,
        TopHatParams calldata topHat_
    ) internal virtual returns (uint256, address) {
        // Mint Top Hat to the Safe (msg.sender is the Safe)
        IAvatar(msg.sender).execTransactionFromModule(
            hatsProtocol_,
            0,
            abi.encodeCall(
                IHats.mintTopHat,
                (msg.sender, topHat_.details, topHat_.imageURI)
            ),
            Enum.Operation.Call
        );

        // Get the newly created top hat ID
        // Top hat IDs have the top 32 bits set, rest are zeros
        uint256 topHatId = uint256(
            IHatsExtended(hatsProtocol_).lastTopHatId()
        ) << 224;

        // Create ERC6551 account for the top hat
        // This account can hold assets, receive payment streams, and execute transactions
        address topHatAccount = IERC6551Registry(erc6551Registry_)
            .createAccount(
                hatsAccountImplementation_,
                SALT,
                block.chainid,
                hatsProtocol_,
                topHatId
            );

        // Emit top hat ID for off-chain indexing
        // This associates the Safe with its Hats tree
        IKeyValuePairsV1.KeyValuePair[]
            memory keyValuePairs = new IKeyValuePairsV1.KeyValuePair[](1);
        keyValuePairs[0] = IKeyValuePairsV1.KeyValuePair({
            key: "topHatId",
            value: Strings.toString(topHatId)
        });
        IAvatar(msg.sender).execTransactionFromModule(
            keyValuePairs_,
            0,
            abi.encodeCall(IKeyValuePairsV1.updateValues, (keyValuePairs)),
            Enum.Operation.Call
        );

        return (topHatId, topHatAccount);
    }

    /**
     * @notice Creates the admin hat with an autonomous admin module
     * @dev Deploys a DecentAutonomousAdmin contract to wear the admin hat,
     * enabling automated role management without manual intervention.
     * @param hatsProtocol_ Hats Protocol contract address
     * @param erc6551Registry_ Registry for creating token-bound accounts
     * @param hatsAccountImplementation_ Implementation for Hat accounts
     * @param topHatId_ The top hat ID to create admin under
     * @param topHatAccount_ The top hat's ERC6551 account (eligibility/toggle)
     * @param systemDeployer_ System deployer for proxy creation
     * @param decentAutonomousAdminImplementation_ Implementation for autonomous admin
     * @param adminHat_ Configuration for the admin hat
     * @return adminHatId The ID of the created admin hat
     */
    function _processAdminHat(
        address hatsProtocol_,
        address erc6551Registry_,
        address hatsAccountImplementation_,
        uint256 topHatId_,
        address topHatAccount_,
        address systemDeployer_,
        address decentAutonomousAdminImplementation_,
        AdminHatParams calldata adminHat_
    ) internal virtual returns (uint256) {
        // Calculate the admin hat ID (first child of top hat)
        uint256 adminHatId = IHats(hatsProtocol_).getNextId(topHatId_);

        // Create the admin hat with top hat account as eligibility/toggle
        IAvatar(msg.sender).execTransactionFromModule(
            hatsProtocol_,
            0,
            abi.encodeCall(
                IHats.createHat,
                (
                    topHatId_,
                    adminHat_.details,
                    1, // maxSupply: only one admin hat allowed
                    topHatAccount_, // eligibility: top hat account controls
                    topHatAccount_, // toggle: top hat account can disable
                    adminHat_.isMutable,
                    adminHat_.imageURI
                )
            ),
            Enum.Operation.Call
        );

        // Create ERC6551 account for the admin hat
        IERC6551Registry(erc6551Registry_).createAccount(
            hatsAccountImplementation_,
            SALT,
            block.chainid,
            hatsProtocol_,
            adminHatId
        );

        // Deploy autonomous admin module with deterministic address
        // Salt includes admin hat ID for uniqueness
        address autonomousAdmin = ISystemDeployerV1(systemDeployer_)
            .deployProxy(
                decentAutonomousAdminImplementation_,
                abi.encodeCall(IDecentAutonomousAdminV1.initialize, ()),
                keccak256(abi.encodePacked(SALT, adminHatId))
            );

        // Mint admin hat to the autonomous admin module
        // This enables automated management of child hats
        IAvatar(msg.sender).execTransactionFromModule(
            hatsProtocol_,
            0,
            abi.encodeCall(IHats.mintHat, (adminHatId, autonomousAdmin)),
            Enum.Operation.Call
        );

        return adminHatId;
    }
}
