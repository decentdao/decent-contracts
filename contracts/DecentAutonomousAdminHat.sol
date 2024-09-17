// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;
import "./interfaces/hats/IHats.sol";
import "./interfaces/hats/IHatsElectionEligibility.sol";

contract DecentAutonomousAdminHat {
    string public constant NAME = "DecentAutonomousAdminHat";

    uint256 public hatId;

    struct TriggerStartArgs {
        address userHatSmartAccountAddress;
        IHats userHatPropocol;
        uint256 userHatId;
    }

    // //////////////////////////////////////////////////////////////
    //                         Constructor
    // //////////////////////////////////////////////////////////////
    constructor() {}

    // //////////////////////////////////////////////////////////////
    //                         Initializer
    // //////////////////////////////////////////////////////////////

    /**
     *
     * @param _initData encoded initialization parameters: `uint256 hatId`
     */

    function _setup(bytes calldata _initData) internal {
        (hatId) = abi.decode(_initData, (uint256));
    }

    // //////////////////////////////////////////////////////////////
    //                         Public Functions
    // //////////////////////////////////////////////////////////////
    function triggerStartNextTerm(TriggerStartArgs calldata args) public {
        // ? should we use `checkHatWearerStatus` here?
        // ? should we use `isAdminOfHat` here?
        // ? should we use `isEligible` here?

        address hatsEE = args.userHatPropocol.getHatEligibilityModule(
            args.userHatId
        );

        IHatsElectionEligibility(hatsEE).startNextTerm();
    }

    // //////////////////////////////////////////////////////////////
    //                         Internal Functions
    // //////////////////////////////////////////////////////////////
}
