// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IHats} from "./hats/full/IHats.sol";
import {ISablierV2Lockup} from "./sablier/full/ISablierV2Lockup.sol";

interface IDecentAutonomousAdmin {
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

    function triggerStartNextTerm(TriggerStartArgs calldata args) external;
}
