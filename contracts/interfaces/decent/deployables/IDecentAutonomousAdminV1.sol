// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IHats} from "../../hats/IHats.sol";

interface IDecentAutonomousAdminV1 {
    // --- Errors ---

    error NotCurrentWearer();

    // --- Structs ---

    struct TriggerStartArgs {
        address currentWearer;
        IHats hatsProtocol;
        uint256 hatId;
        address nominatedWearer;
    }

    // --- Constructor & Initializers ---

    function initialize() external;

    // --- State-Changing Functions ---

    function triggerStartNextTerm(TriggerStartArgs calldata args_) external;
}
