// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

import {DecentHatsModuleUtils} from "./DecentHatsModuleUtils.sol";
import {IERC6551Registry} from "../interfaces/ERC6551/IERC6551Registry.sol";
import {IHats} from "../interfaces/hats/IHats.sol";
import {IHatsModuleFactory} from "../interfaces/hats/IHatsModuleFactory.sol";
import {Enum} from "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import {IAvatar} from "@gnosis-guild/zodiac/contracts/interfaces/IAvatar.sol";
import {ModuleProxyFactory} from "@gnosis-guild/zodiac/contracts/factory/ModuleProxyFactory.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

contract DecentHatsCreationModule is DecentHatsModuleUtils {
    struct TopHatParams {
        string details;
        string imageURI;
    }

    struct AdminHatParams {
        string details;
        string imageURI;
        bool isMutable;
    }

    struct CreateTreeParams {
        IHats hatsProtocol;
        IERC6551Registry erc6551Registry;
        IHatsModuleFactory hatsModuleFactory;
        ModuleProxyFactory moduleProxyFactory;
        address keyValuePairs;
        address decentAutonomousAdminImplementation;
        address hatsAccountImplementation;
        address hatsElectionsEligibilityImplementation;
        TopHatParams topHat;
        AdminHatParams adminHat;
        HatParams[] hats;
    }

    /* /////////////////////////////////////////////////////////////////////////////
                        EXTERNAL FUNCTIONS
    ///////////////////////////////////////////////////////////////////////////// */
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
     * @param treeParams The parameters for creating the Hat Tree with Roles
     */
    function createAndDeclareTree(
        CreateTreeParams calldata treeParams
    ) external {
        // Create Top Hat
        (uint256 topHatId, address topHatAccount) = _processTopHat(
            treeParams.hatsProtocol,
            treeParams.erc6551Registry,
            treeParams.hatsAccountImplementation,
            treeParams.keyValuePairs,
            treeParams.topHat
        );

        // Create Admin Hat
        uint256 adminHatId = _processAdminHat(
            treeParams.hatsProtocol,
            treeParams.erc6551Registry,
            treeParams.hatsAccountImplementation,
            topHatId,
            topHatAccount,
            treeParams.moduleProxyFactory,
            treeParams.decentAutonomousAdminImplementation,
            treeParams.adminHat
        );

        // Create Role Hats
        _processRoleHats(
            CreateRoleHatsParams({
                hatsProtocol: treeParams.hatsProtocol,
                erc6551Registry: treeParams.erc6551Registry,
                hatsAccountImplementation: treeParams.hatsAccountImplementation,
                topHatId: topHatId,
                topHatAccount: topHatAccount,
                hatsModuleFactory: treeParams.hatsModuleFactory,
                hatsElectionsEligibilityImplementation: treeParams
                    .hatsElectionsEligibilityImplementation,
                adminHatId: adminHatId,
                hats: treeParams.hats,
                keyValuePairs: treeParams.keyValuePairs
            })
        );
    }

    /* /////////////////////////////////////////////////////////////////////////////
                        INTERNAL FUNCTIONS
    ///////////////////////////////////////////////////////////////////////////// */

    function _processTopHat(
        IHats hatsProtocol,
        IERC6551Registry erc6551Registry,
        address hatsAccountImplementation,
        address keyValuePairs,
        TopHatParams calldata topHat
    ) internal returns (uint256 topHatId, address topHatAccount) {
        // Call lastTopHatId() and properly decode the response
        (bool success, bytes memory data) = address(hatsProtocol).call(
            abi.encodeWithSignature("lastTopHatId()")
        );
        require(success, "Failed to get lastTopHatId");
        topHatId = (abi.decode(data, (uint256)) + 1) << 224;

        // Mint Top Hat to the Safe
        IAvatar(msg.sender).execTransactionFromModule(
            address(hatsProtocol),
            0,
            abi.encodeWithSignature(
                "mintTopHat(address,string,string)",
                msg.sender,
                topHat.details,
                topHat.imageURI
            ),
            Enum.Operation.Call
        );

        // Create Top Hat's ERC6551 Account
        topHatAccount = erc6551Registry.createAccount(
            hatsAccountImplementation,
            SALT,
            block.chainid,
            address(hatsProtocol),
            topHatId
        );

        // Declare Top Hat ID to Safe via KeyValuePairs
        string[] memory keys = new string[](1);
        string[] memory values = new string[](1);
        keys[0] = "topHatId";
        values[0] = Strings.toString(topHatId);
        IAvatar(msg.sender).execTransactionFromModule(
            keyValuePairs,
            0,
            abi.encodeWithSignature(
                "updateValues(string[],string[])",
                keys,
                values
            ),
            Enum.Operation.Call
        );
    }

    function _processAdminHat(
        IHats hatsProtocol,
        IERC6551Registry erc6551Registry,
        address hatsAccountImplementation,
        uint256 topHatId,
        address topHatAccount,
        ModuleProxyFactory moduleProxyFactory,
        address decentAutonomousAdminImplementation,
        AdminHatParams calldata adminHat
    ) internal returns (uint256 adminHatId) {
        // Create Admin Hat
        adminHatId = hatsProtocol.getNextId(topHatId);
        IAvatar(msg.sender).execTransactionFromModule(
            address(hatsProtocol),
            0,
            abi.encodeWithSignature(
                "createHat(uint256,string,uint32,address,address,bool,string)",
                topHatId,
                adminHat.details,
                1, // only one Admin Hat
                topHatAccount,
                topHatAccount,
                adminHat.isMutable,
                adminHat.imageURI
            ),
            Enum.Operation.Call
        );

        // Create Admin Hat's ERC6551 Account
        erc6551Registry.createAccount(
            hatsAccountImplementation,
            SALT,
            block.chainid,
            address(hatsProtocol),
            adminHatId
        );

        // Deploy Decent Autonomous Admin Module, which will wear the Admin Hat
        address autonomousAdmin = moduleProxyFactory.deployModule(
            decentAutonomousAdminImplementation,
            abi.encodeWithSignature("setUp(bytes)", bytes("")),
            uint256(
                keccak256(
                    abi.encodePacked(
                        // for the salt, we'll concatenate our static salt
                        // with the Admin Hat ID
                        SALT,
                        adminHatId
                    )
                )
            )
        );

        // Mint Hat to the Decent Autonomous Admin Module
        IAvatar(msg.sender).execTransactionFromModule(
            address(hatsProtocol),
            0,
            abi.encodeWithSignature(
                "mintHat(uint256,address)",
                adminHatId,
                autonomousAdmin
            ),
            Enum.Operation.Call
        );
    }
}
