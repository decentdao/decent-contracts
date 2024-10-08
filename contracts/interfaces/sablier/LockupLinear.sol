// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

library LockupLinear {
    struct CreateWithTimestamps {
        address sender;
        address recipient;
        uint128 totalAmount;
        IERC20 asset;
        bool cancelable;
        bool transferable;
        Timestamps timestamps;
        Broker broker;
    }

    struct Timestamps {
        uint40 start;
        uint40 cliff;
        uint40 end;
    }

    struct Broker {
        address account;
        uint256 fee;
    }

    struct Stream {
        address sender;
        address recipient;
        uint128 totalAmount;
        address asset;
        bool cancelable;
        bool transferable;
        uint40 startTime;
        uint40 cliffTime;
        uint40 endTime;
    }
}
