// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IDecentHatsCreationModule} from "../interfaces/decent/utilities/IDecentHatsCreationModule.sol";
import {IDecentAutonomousAdminV1} from "../interfaces/decent/deployables/IDecentAutonomousAdminV1.sol";
import {ISystemDeployerV1} from "../interfaces/decent/singletons/ISystemDeployerV1.sol";
import {IKeyValuePairsV1} from "../interfaces/decent/singletons/IKeyValuePairsV1.sol";
import {IERC6551Registry} from "../interfaces/erc6551/IERC6551Registry.sol";
import {IHats} from "../interfaces/hats/IHats.sol";
import {DecentHatsModuleUtils} from "./DecentHatsModuleUtils.sol";
import {Enum} from "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import {IAvatar} from "@gnosis-guild/zodiac/contracts/interfaces/IAvatar.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

interface IHatsExtended is IHats {
    function lastTopHatId() external view returns (uint32 lastTopHatId);
}

contract DecentHatsCreationModule is
    IDecentHatsCreationModule,
    DecentHatsModuleUtils
{
    // ======================================================================
    // IDecentHatsCreationModule
    // ======================================================================

    // --- State-Changing Functions ---

    /**
     * @notice For a safe without any roles previously created on it, this function should be called. It sets up the
     * top hat and admin hat, as well as any other hats and their streams that are provided, then transfers the top hat
     * to the calling safe.
     *
     * @notice This contract should be enabled a module on the Safe for which the role(s) are to be created, and disabled after.
     *
     * @dev For each hat that is included, if the hat is:
     *  - termed, its stream funds on are targeted directly at the nominated wearer. The wearer should directly call `withdraw-`
     *    on the Sablier contract.
     *  - untermed, its stream funds are targeted at the hat's smart account. In order to withdraw funds from the stream, the
     * hat's smart account must be the one call to `withdraw-` on the Sablier contract, setting the recipient arg to its wearer.
     *
     * @dev In order for a Safe to seamlessly create roles even if it has never previously created a role and thus has
     * no hat tree, we defer the creation of the hat tree and its setup to this contract. This way, in a single tx block,
     * the resulting topHatId of the newly created hat can be used to create an admin hat and any other hats needed.
     * We also make use of `KeyValuePairs` to associate the topHatId with the Safe.
     *
     * @param treeParams_ The parameters for creating the Hat Tree with Roles
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

    function _processTopHat(
        address hatsProtocol_,
        address erc6551Registry_,
        address hatsAccountImplementation_,
        address keyValuePairs_,
        TopHatParams calldata topHat_
    ) internal virtual returns (uint256, address) {
        // Mint Top Hat to the Safe
        IAvatar(msg.sender).execTransactionFromModule(
            hatsProtocol_,
            0,
            abi.encodeCall(
                IHats.mintTopHat,
                (msg.sender, topHat_.details, topHat_.imageURI)
            ),
            Enum.Operation.Call
        );

        // get the new Top Hat ID
        uint256 topHatId = uint256(
            IHatsExtended(hatsProtocol_).lastTopHatId()
        ) << 224;

        // Create Top Hat's ERC6551 Account
        address topHatAccount = IERC6551Registry(erc6551Registry_)
            .createAccount(
                hatsAccountImplementation_,
                SALT,
                block.chainid,
                hatsProtocol_,
                topHatId
            );

        // Declare Top Hat ID to Safe via KeyValuePairs
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
        // Create Admin Hat
        uint256 adminHatId = IHats(hatsProtocol_).getNextId(topHatId_);
        IAvatar(msg.sender).execTransactionFromModule(
            hatsProtocol_,
            0,
            abi.encodeCall(
                IHats.createHat,
                (
                    topHatId_,
                    adminHat_.details,
                    1, // only one Admin Hat
                    topHatAccount_,
                    topHatAccount_,
                    adminHat_.isMutable,
                    adminHat_.imageURI
                )
            ),
            Enum.Operation.Call
        );

        // Create Admin Hat's ERC6551 Account
        IERC6551Registry(erc6551Registry_).createAccount(
            hatsAccountImplementation_,
            SALT,
            block.chainid,
            hatsProtocol_,
            adminHatId
        );

        // Deploy Decent Autonomous Admin Module, which will wear the Admin Hat
        address autonomousAdmin = ISystemDeployerV1(systemDeployer_)
            .deployProxy(
                decentAutonomousAdminImplementation_,
                abi.encodeCall(IDecentAutonomousAdminV1.initialize, ()),
                keccak256(
                    abi.encodePacked(
                        // for the salt, we'll concatenate our static salt
                        // with the Admin Hat ID
                        SALT,
                        adminHatId
                    )
                )
            );

        // Mint Hat to the Decent Autonomous Admin Module
        IAvatar(msg.sender).execTransactionFromModule(
            hatsProtocol_,
            0,
            abi.encodeCall(IHats.mintHat, (adminHatId, autonomousAdmin)),
            Enum.Operation.Call
        );

        return adminHatId;
    }
}
