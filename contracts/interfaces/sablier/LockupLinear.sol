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
        uint40 startTime;
        uint40 endTime;
        uint40 cliffTime;
        bool cancelable;
        bool wasCanceled;
        address asset;
        bool transferable;
        uint128 totalAmount;
        address recipient;
    }

    /// @notice Enum representing the different statuses of a stream.
    /// @custom:value0 PENDING Stream created but not started; assets are in a pending state.
    /// @custom:value1 STREAMING Active stream where assets are currently being streamed.
    /// @custom:value2 SETTLED All assets have been streamed; recipient is due to withdraw them.
    /// @custom:value3 CANCELED Canceled stream; remaining assets await recipient's withdrawal.
    /// @custom:value4 DEPLETED Depleted stream; all assets have been withdrawn and/or refunded.
    enum Status {
        PENDING,
        STREAMING,
        SETTLED,
        CANCELED,
        DEPLETED
    }
}
