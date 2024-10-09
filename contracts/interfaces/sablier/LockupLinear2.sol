// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library LockupLinear2 {
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
