// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IUtilityRolesManagementV1} from "../interfaces/decent/utilities/IUtilityRolesManagementV1.sol";
import {IDecentAutonomousAdminV1} from "../interfaces/decent/deployables/IDecentAutonomousAdminV1.sol";
import {ISystemDeployerV1} from "../interfaces/decent/singletons/ISystemDeployerV1.sol";
import {IKeyValuePairsV1} from "../interfaces/decent/singletons/IKeyValuePairsV1.sol";
import {IHatsExtended} from "../interfaces/hats/IHatsExtended.sol";
import {IERC6551Registry} from "../interfaces/erc6551/IERC6551Registry.sol";
import {IHats} from "../interfaces/hats/IHats.sol";
import {IHatsElectionsEligibility} from "../interfaces/hats/modules/IHatsElectionsEligibility.sol";
import {IHatsModuleFactory} from "../interfaces/hats/IHatsModuleFactory.sol";
import {ISablierV2LockupLinear} from "../interfaces/sablier/ISablierV2LockupLinear.sol";
import {ISablierV2Lockup} from "../interfaces/sablier/ISablierV2Lockup.sol";
import {LockupLinear, Lockup} from "../interfaces/sablier/types/DataTypes.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC6551Executable} from "../interfaces/erc6551/IERC6551Executable.sol";
import {IDeploymentBlock} from "../interfaces/decent/IDeploymentBlock.sol";
import {DeploymentBlockNonUpgradeable} from "../DeploymentBlockNonUpgradeable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title UtilityRolesManagementV1
 * @author Decent Labs
 * @notice Unified utility for creating and managing Hats Protocol organizational structures
 * @dev This contract implements IUtilityRolesManagementV1, providing comprehensive functionality
 * for both creating new Hats trees and modifying existing ones.
 *
 * Implementation details:
 * - Called via delegatecall from a Safe
 * - Creates complete Hats trees or adds roles to existing ones
 * - Deploys autonomous admin for automated role management
 * - Sets up payment streams for all roles
 * - Associates trees with Safes via KeyValuePairs
 * - Non-upgradeable utility contract
 * - Inherits from DeploymentBlockNonUpgradeable to track deployment
 * - Implements ERC165 for interface detection
 *
 * Key features:
 * - Full tree creation: top hat, admin hat, and role hats
 * - Role modification: add new roles to existing trees
 * - Payment stream integration via Sablier
 * - Support for both termed and untermed positions
 * - ERC6551 token-bound accounts for stream recipients
 *
 * Security considerations:
 * - Must be called via delegatecall from a Safe
 * - All operations execute with Safe's permissions
 * - address(this) is the Safe when called via delegatecall
 *
 * @custom:security-contact security@decentlabs.io
 */
contract UtilityRolesManagementV1 is IUtilityRolesManagementV1, DeploymentBlockNonUpgradeable, ERC165 {
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /** @notice Salt used for deterministic ERC6551 account creation */
    bytes32 public constant SALT =
        0x5d0e6ce4fd951366cc55da93f6e79d8b81483109d79676a04bcc2bed6a4b5072;

    // ======================================================================
    // IUtilityRolesManagementV1
    // ======================================================================

    // --- State-Changing Functions ---

    /**
     * @inheritdoc IUtilityRolesManagementV1
     * @dev Creates a complete organizational structure in one transaction.
     * The top hat is minted to the calling Safe, establishing ownership.
     * An autonomous admin is deployed to manage the admin hat for automated operations.
     * All role hats are created with their specified configurations and payment streams.
     */
    function createAndDeclareTree(
        CreateTreeParams calldata treeParams_
    ) public virtual override {
        // Process top hat and get the top hat ID
        uint256 topHatId = _processTopHat(
            treeParams_.hatsProtocol,
            treeParams_.topHat
        );

        // Process admin hat and get the admin hat ID
        uint256 adminHatId = _processAdminHat(
            treeParams_.hatsProtocol,
            treeParams_.erc6551Registry,
            treeParams_.hatsAccountImplementation,
            treeParams_.systemDeployer,
            treeParams_.decentAutonomousAdminImplementation,
            treeParams_.adminHat,
            topHatId
        );

        // Create role hats under the admin
        _processRoleHats(
            CreateRoleHatsParams({
                hatsProtocol: treeParams_.hatsProtocol,
                erc6551Registry: treeParams_.erc6551Registry,
                hatsAccountImplementation: treeParams_
                    .hatsAccountImplementation,
                topHatId: topHatId,
                topHatAccount: address(this),
                hatsModuleFactory: treeParams_.hatsModuleFactory,
                hatsElectionsEligibilityImplementation: treeParams_
                    .hatsElectionsEligibilityImplementation,
                adminHatId: adminHatId,
                hats: treeParams_.hats,
                keyValuePairs: treeParams_.keyValuePairs
            })
        );

        // Emit key-value pair to associate this Safe with the top hat ID
        IKeyValuePairsV1.KeyValuePair[]
            memory kvPairs = new IKeyValuePairsV1.KeyValuePair[](1);
        kvPairs[0] = IKeyValuePairsV1.KeyValuePair({
            key: "topHatId",
            value: Strings.toString(topHatId)
        });
        IKeyValuePairsV1(treeParams_.keyValuePairs).updateValues(kvPairs);
    }

    /**
     * @inheritdoc IUtilityRolesManagementV1
     * @dev Simply delegates to the internal _processRoleHats function,
     * which handles all the complex logic for creating roles with payment streams.
     */
    function createRoleHats(
        CreateRoleHatsParams calldata roleHatsParams_
    ) public virtual override {
        _processRoleHats(roleHatsParams_);
    }

    /**
     * @inheritdoc IUtilityRolesManagementV1
     */
    function withdrawMaxFromStream(
        address sablier_,
        address recipientHatAccount_,
        uint256 streamId_,
        address to_
    ) public virtual {
        // Check if there are funds to withdraw
        // This prevents reverts when stream has no withdrawable amount
        if (ISablierV2Lockup(sablier_).withdrawableAmountOf(streamId_) == 0) {
            return;
        }

        // Execute nested call through Hat account
        // Safe (via delegatecall) -> recipientHatAccount.execute() -> sablier.withdrawMax()
        IERC6551Executable(recipientHatAccount_).execute(
            sablier_,
            0,
            abi.encodeCall(ISablierV2Lockup.withdrawMax, (streamId_, to_)),
            0 // operation type
        );
    }

    /**
     * @inheritdoc IUtilityRolesManagementV1
     */
    function cancelStream(address sablier_, uint256 streamId_) public virtual {
        // Verify stream is cancellable
        // Only PENDING and STREAMING statuses can be cancelled
        Lockup.Status streamStatus = ISablierV2Lockup(sablier_).statusOf(
            streamId_
        );
        if (
            streamStatus != Lockup.Status.PENDING &&
            streamStatus != Lockup.Status.STREAMING
        ) {
            return;
        }

        // Cancel the stream
        // This will distribute funds according to Sablier's rules
        ISablierV2Lockup(sablier_).cancel(streamId_);
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    /**
     * @notice Creates and mints the top hat to the calling Safe
     * @dev The top hat establishes the root of the organizational hierarchy.
     * It's minted to address(this), which is the Safe when called via delegatecall.
     * @param hatsProtocol_ Address of the Hats Protocol contract
     * @param topHatParams_ Parameters for the top hat creation
     * @return topHatId The ID of the created top hat
     */
    function _processTopHat(
        address hatsProtocol_,
        TopHatParams memory topHatParams_
    ) internal virtual returns (uint256 topHatId) {
        // Get the next top hat ID from Hats Protocol
        uint32 lastTopHatId = IHatsExtended(hatsProtocol_).lastTopHatId();
        topHatId = uint256(lastTopHatId + 1) << 224; // Top hats occupy the first 32 bits

        // Mint top hat to the Safe (address(this) in delegatecall context)
        IHats(hatsProtocol_).mintTopHat(
            address(this),
            topHatParams_.details,
            topHatParams_.imageURI
        );

        return topHatId;
    }

    /**
     * @notice Creates the admin hat with an autonomous admin module
     * @dev The admin hat is worn by DecentAutonomousAdmin, which automates
     * administrative functions like role management. The admin is deployed
     * as a proxy through SystemDeployer for consistent addresses.
     * @param hatsProtocol_ Address of the Hats Protocol contract
     * @param erc6551Registry_ Registry for creating token-bound accounts
     * @param hatsAccountImplementation_ Implementation for Hat accounts
     * @param systemDeployer_ Deploys the autonomous admin proxy
     * @param adminHatParams_ Parameters for the admin hat
     * @param topHatId_ ID of the top hat to create admin under
     * @return adminHatId The ID of the created admin hat
     */
    function _processAdminHat(
        address hatsProtocol_,
        address erc6551Registry_,
        address hatsAccountImplementation_,
        address systemDeployer_,
        address decentAutonomousAdminImplementation_,
        AdminHatParams memory adminHatParams_,
        uint256 topHatId_
    ) internal virtual returns (uint256 adminHatId) {
        // Get next hat ID under the top hat
        adminHatId = IHats(hatsProtocol_).getNextId(topHatId_);

        // Create admin hat
        IHats(hatsProtocol_).createHat(
            topHatId_,
            adminHatParams_.details,
            1, // maxSupply
            address(this), // eligibility (topHatAccount)
            address(this), // toggle (topHatAccount)
            adminHatParams_.isMutable,
            adminHatParams_.imageURI
        );

        // Create ERC6551 account for the top hat
        IERC6551Registry(erc6551Registry_).createAccount(
            hatsAccountImplementation_,
            SALT,
            block.chainid,
            hatsProtocol_,
            topHatId_
        );

        // Deploy autonomous admin proxy through SystemDeployer
        ISystemDeployerV1(systemDeployer_).deployProxy(
            decentAutonomousAdminImplementation_,
            abi.encodeCall(IDecentAutonomousAdminV1.initialize, ()),
            adminHatParams_.salt
        );

        // Calculate the deployed admin address
        address autonomousAdmin = ISystemDeployerV1(systemDeployer_)
            .predictProxyAddress(
                decentAutonomousAdminImplementation_,
                abi.encodeCall(IDecentAutonomousAdminV1.initialize, ()),
                adminHatParams_.salt,
                address(this) // Deployer is the Safe in delegatecall context
            );

        // Mint admin hat to the autonomous admin
        IHats(hatsProtocol_).mintHat(adminHatId, autonomousAdmin);

        return adminHatId;
    }

    /**
     * @notice Processes batch creation of role Hats with payment streams
     * @dev Main orchestration function that coordinates Hat creation workflow.
     * For each Hat: creates eligibility module, mints Hat, sets up recipient, creates streams.
     * @param roleHatsParams_ Complete configuration for all Hats to create
     */
    function _processRoleHats(
        CreateRoleHatsParams memory roleHatsParams_
    ) internal virtual {
        for (uint256 i = 0; i < roleHatsParams_.hats.length; ) {
            HatParams memory hatParams = roleHatsParams_.hats[i];

            // Step 1: Create eligibility module for termed positions
            // Returns election module for termed, top hat account for untermed
            address eligibilityAddress = _createEligibilityModule(
                roleHatsParams_.hatsProtocol,
                roleHatsParams_.hatsModuleFactory,
                roleHatsParams_.hatsElectionsEligibilityImplementation,
                roleHatsParams_.topHatId,
                roleHatsParams_.topHatAccount,
                roleHatsParams_.adminHatId,
                hatParams.termEndDateTs
            );

            // Step 2: Create the Hat and mint to initial wearer
            uint256 hatId = _createAndMintHat(
                roleHatsParams_.hatsProtocol,
                roleHatsParams_.adminHatId,
                hatParams,
                eligibilityAddress,
                roleHatsParams_.topHatAccount
            );

            // Step 3: Determine stream recipient based on termed status
            // Termed: wearer receives directly, Untermed: ERC6551 account receives
            address streamRecipient = _setupStreamRecipient(
                roleHatsParams_.erc6551Registry,
                roleHatsParams_.hatsAccountImplementation,
                roleHatsParams_.hatsProtocol,
                hatParams.termEndDateTs,
                hatParams.wearer,
                hatId
            );

            // Step 4: Create payment streams for this role
            _processSablierStreams(
                hatParams.sablierStreamsParams,
                streamRecipient,
                roleHatsParams_.keyValuePairs,
                hatId
            );

            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Creates an eligibility module for termed positions or returns top hat account
     * @dev For termed positions (termEndDateTs_ > 0), deploys a HatsElectionsEligibility module
     * that manages elections and term limits. For untermed positions, returns the top hat
     * account as the eligibility address since no elections are needed.
     * @param hatsProtocol_ Address of the Hats Protocol contract
     * @param hatsModuleFactory_ Factory contract for creating Hats modules
     * @param hatsElectionsEligibilityImplementation_ Implementation address for election module
     * @param topHatId_ ID of the top hat (used for ballot box in elections)
     * @param topHatAccount_ Address holding the top hat (eligibility for untermed)
     * @param adminHatId_ Parent hat ID for calculating the new hat's ID
     * @param termEndDateTs_ Unix timestamp for term end (0 for untermed positions)
     * @return eligibilityAddress Either election module address (termed) or top hat account (untermed)
     */
    function _createEligibilityModule(
        address hatsProtocol_,
        address hatsModuleFactory_,
        address hatsElectionsEligibilityImplementation_,
        uint256 topHatId_,
        address topHatAccount_,
        uint256 adminHatId_,
        uint128 termEndDateTs_
    ) internal virtual returns (address) {
        // If the Hat is termed, create the eligibility module
        if (termEndDateTs_ != 0) {
            return
                IHatsModuleFactory(hatsModuleFactory_).createHatsModule(
                    hatsElectionsEligibilityImplementation_,
                    IHats(hatsProtocol_).getNextId(adminHatId_),
                    abi.encode(topHatId_, uint256(0)), // [BALLOT_BOX_ID, ADMIN_HAT_ID]
                    abi.encode(termEndDateTs_),
                    uint256(SALT)
                );
        }

        // Otherwise, return the Top Hat account
        return topHatAccount_;
    }

    /**
     * @notice Creates a Hat and mints it to the initial wearer
     * @dev Handles both termed and untermed Hat creation. For termed positions,
     * also nominates the wearer through the election module.
     * @param hatsProtocol_ Hats Protocol contract address
     * @param adminHatId_ Parent Hat that will admin the new Hat
     * @param hat_ Configuration for the Hat to create
     * @param eligibilityAddress_ Eligibility module address (election or top hat)
     * @param topHatAccount_ Account holding the top hat (for toggle permissions)
     * @return hatId The ID of the newly created Hat
     */
    function _createAndMintHat(
        address hatsProtocol_,
        uint256 adminHatId_,
        HatParams memory hat_,
        address eligibilityAddress_,
        address topHatAccount_
    ) internal virtual returns (uint256) {
        // Calculate the next Hat ID before creation
        uint256 hatId = IHats(hatsProtocol_).getNextId(adminHatId_);

        // Create the Hat with specified parameters
        IHats(hatsProtocol_).createHat(
            adminHatId_,
            hat_.details,
            hat_.maxSupply,
            eligibilityAddress_,
            topHatAccount_,
            hat_.isMutable,
            hat_.imageURI
        );

        // For termed positions, elect the initial wearer
        if (hat_.termEndDateTs != 0) {
            address[] memory nominatedWearers = new address[](1);
            nominatedWearers[0] = hat_.wearer;

            // Elect through the eligibility module
            IHatsElectionsEligibility(eligibilityAddress_).elect(
                hat_.termEndDateTs,
                nominatedWearers
            );
        }

        // Mint the Hat to the wearer
        IHats(hatsProtocol_).mintHat(hatId, hat_.wearer);
        return hatId;
    }

    /**
     * @notice Determines the recipient address for Sablier payment streams
     * @dev For termed positions, the wearer directly receives streams since they're
     * elected for a specific term. For untermed positions, creates an ERC6551
     * token-bound account tied to the Hat ID, ensuring payments follow the Hat
     * regardless of who wears it.
     * @param erc6551Registry_ Registry for creating token-bound accounts
     * @param hatsAccountImplementation_ Implementation for Hat token-bound accounts
     * @param hatsProtocol_ Address of the Hats Protocol contract
     * @param termEndDateTs_ Unix timestamp for term end (0 for untermed positions)
     * @param wearer_ Address of the initial Hat wearer
     * @param hatId_ The Hat ID to bind the account to (for untermed)
     * @return streamRecipient Address that will receive stream payments
     */
    function _setupStreamRecipient(
        address erc6551Registry_,
        address hatsAccountImplementation_,
        address hatsProtocol_,
        uint128 termEndDateTs_,
        address wearer_,
        uint256 hatId_
    ) internal virtual returns (address) {
        // If the hat is termed, the wearer is the stream recipient
        if (termEndDateTs_ != 0) {
            return wearer_;
        }

        // Otherwise, the Hat's smart account is the stream recipient
        return
            IERC6551Registry(erc6551Registry_).createAccount(
                hatsAccountImplementation_,
                SALT,
                block.chainid,
                hatsProtocol_,
                hatId_
            );
    }

    /**
     * @notice Creates Sablier payment streams for a Hat role
     * @dev Handles token approvals, stream creation, and metadata emission.
     * Each stream is associated with the Hat ID in KeyValuePairs for tracking.
     * @param streamParams_ Array of stream configurations
     * @param streamRecipient_ Address that will receive stream payments
     * @param keyValuePairs_ Contract for emitting stream-Hat associations
     * @param hatId_ The Hat ID to associate with streams
     */
    function _processSablierStreams(
        SablierStreamParams[] memory streamParams_,
        address streamRecipient_,
        address keyValuePairs_,
        uint256 hatId_
    ) internal virtual {
        for (uint256 i = 0; i < streamParams_.length; ) {
            SablierStreamParams memory sablierStreamParams = streamParams_[i];

            // Step 1: Approve Sablier to spend tokens
            IERC20(sablierStreamParams.asset).approve(
                sablierStreamParams.sablier,
                sablierStreamParams.totalAmount
            );

            // Get the stream ID that will be created
            uint256 streamId = ISablierV2LockupLinear(
                sablierStreamParams.sablier
            ).nextStreamId();

            // Step 2: Create the Sablier stream
            ISablierV2LockupLinear(sablierStreamParams.sablier)
                .createWithTimestamps(
                    LockupLinear.CreateWithTimestamps({
                        sender: sablierStreamParams.sender,
                        recipient: streamRecipient_,
                        totalAmount: sablierStreamParams.totalAmount,
                        asset: IERC20(sablierStreamParams.asset),
                        cancelable: sablierStreamParams.cancelable,
                        transferable: sablierStreamParams.transferable,
                        timestamps: sablierStreamParams.timestamps,
                        broker: sablierStreamParams.broker
                    })
                );

            // Step 3: Emit metadata linking Hat ID to stream ID
            // Format: "hatId:streamId" for easy parsing
            IKeyValuePairsV1.KeyValuePair[]
                memory keyValuePairs = new IKeyValuePairsV1.KeyValuePair[](1);
            keyValuePairs[0] = IKeyValuePairsV1.KeyValuePair({
                key: "hatIdToStreamId",
                value: string(
                    abi.encodePacked(
                        Strings.toString(hatId_),
                        ":",
                        Strings.toString(streamId)
                    )
                )
            });

            IKeyValuePairsV1(keyValuePairs_).updateValues(keyValuePairs);

            unchecked {
                ++i;
            }
        }
    }

    // ======================================================================
    // ERC165
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc ERC165
     * @dev Supports IUtilityRolesManagementV1, IDeploymentBlock, and IERC165
     */
    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IUtilityRolesManagementV1).interfaceId ||
            interfaceId_ == type(IDeploymentBlock).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
