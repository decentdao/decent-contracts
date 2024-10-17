// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IHats} from "./interfaces/hats/full/IHats.sol";
import {IHatsElectionEligibility} from "./interfaces/hats/full/IHatsElectionEligibility.sol";
import {ISablierV2Lockup} from "./interfaces/sablier/full/ISablierV2Lockup.sol";

contract DecentAutonomousAdmin {
    string public constant NAME = "DecentAutonomousAdmin";
    string public version_ = "0.1.0";

    struct SablierStreamInfo {
        uint256 streamId;
        ISablierV2Lockup sablierV2Lockup;
    }
    struct TriggerStartArgs {
        address currentWearer;
        IHats userHatProtocol;
        uint256 userHatId;
        address nominatedWearer;
    }

    // //////////////////////////////////////////////////////////////
    //                         initializer
    // //////////////////////////////////////////////////////////////
    function setUp() public {}

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

        // transfer user hat to self
        args.userHatProtocol.checkHatWearerStatus(
            args.userHatId,
            args.currentWearer
        );
        args.userHatProtocol.mintHat(args.userHatId, args.nominatedWearer);
    }

    // //////////////////////////////////////////////////////////////
    //                         Internal Functions
    // //////////////////////////////////////////////////////////////
}
