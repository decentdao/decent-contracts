// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IHats} from "./interfaces/hats/full/IHats.sol";
import {IHatsElectionEligibility} from "./interfaces/hats/full/IHatsElectionEligibility.sol";
import {FactoryFriendly} from "@gnosis.pm/zodiac/contracts/factory/FactoryFriendly.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IDecentAutonomousAdmin} from "./interfaces/IDecentAutonomousAdmin.sol";

contract DecentAutonomousAdmin is
    IDecentAutonomousAdmin,
    ERC165,
    FactoryFriendly
{
    // //////////////////////////////////////////////////////////////
    //                         initializer
    // //////////////////////////////////////////////////////////////
    function setUp(bytes memory initializeParams) public override initializer {}

    // //////////////////////////////////////////////////////////////
    //                         Public Functions
    // //////////////////////////////////////////////////////////////
    function triggerStartNextTerm(TriggerStartArgs calldata args) public {
        require(
            args.userHatProtocol.isWearerOfHat(
                args.currentWearer,
                args.userHatId
            ),
            "Not current wearer"
        );
        address hatsEligibilityModuleAddress = args
            .userHatProtocol
            .getHatEligibilityModule(args.userHatId);

        IHatsElectionEligibility hatsElectionModule = IHatsElectionEligibility(
            hatsEligibilityModuleAddress
        );

        hatsElectionModule.startNextTerm();

        // This will burn the hat since wearer is no longer eligible
        args.userHatProtocol.checkHatWearerStatus(
            args.userHatId,
            args.currentWearer
        );
        // This will mint the hat to the nominated wearer
        args.userHatProtocol.mintHat(args.userHatId, args.nominatedWearer);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override returns (bool) {
        return
            interfaceId == type(IDecentAutonomousAdmin).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    // //////////////////////////////////////////////////////////////
    //                         Internal Functions
    // //////////////////////////////////////////////////////////////
}
