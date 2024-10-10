// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISablierV2LockupLinear} from "../interfaces/sablier/ISablierV2LockupLinear.sol";
import {MockLockupLinear} from "./MockLockupLinear.sol";

contract MockSablierV2LockupLinear {
    mapping(uint256 => MockLockupLinear.Stream) public streams;
    uint256 public nextStreamId = 1;

    // Add this event declaration at the contract level
    event StreamCreated(
        uint256 streamId,
        address indexed sender,
        address indexed recipient,
        uint128 totalAmount,
        address indexed asset,
        bool cancelable,
        bool transferable,
        uint40 startTime,
        uint40 cliffTime,
        uint40 endTime
    );

    function createWithTimestamps(
        MockLockupLinear.CreateWithTimestamps calldata params
    ) external returns (uint256 streamId) {
        require(
            params.asset.transferFrom(
                msg.sender,
                address(this),
                params.totalAmount
            ),
            "Token transfer failed"
        );

        streamId = nextStreamId++;
        streams[streamId] = MockLockupLinear.Stream({
            sender: params.sender,
            recipient: params.recipient,
            totalAmount: params.totalAmount,
            asset: address(params.asset),
            cancelable: params.cancelable,
            wasCanceled: false,
            transferable: params.transferable,
            startTime: params.timestamps.start,
            cliffTime: params.timestamps.cliff,
            endTime: params.timestamps.end
        });

        // Emit the StreamCreated event
        emit StreamCreated(
            streamId,
            params.sender,
            params.recipient,
            params.totalAmount,
            address(params.asset),
            params.cancelable,
            params.transferable,
            params.timestamps.start,
            params.timestamps.cliff,
            params.timestamps.end
        );

        return streamId;
    }

    function getStream(
        uint256 streamId
    ) external view returns (MockLockupLinear.Stream memory) {
        return streams[streamId];
    }

    function withdrawableAmountOf(
        uint256 streamId
    ) public view returns (uint128) {
        MockLockupLinear.Stream memory stream = streams[streamId];
        if (block.timestamp <= stream.startTime) {
            return 0;
        }
        if (block.timestamp >= stream.endTime) {
            return stream.totalAmount;
        }
        return
            uint128(
                (stream.totalAmount * (block.timestamp - stream.startTime)) /
                    (stream.endTime - stream.startTime)
            );
    }

    function withdrawMax(
        uint256 streamId,
        address to
    ) external returns (uint128 withdrawnAmount) {
        withdrawnAmount = withdrawableAmountOf(streamId);
        MockLockupLinear.Stream storage stream = streams[streamId];

        require(
            msg.sender == stream.recipient,
            "Only recipient can call withdraw"
        );
        require(
            withdrawnAmount <= withdrawableAmountOf(streamId),
            "Insufficient withdrawable amount"
        );

        stream.totalAmount -= withdrawnAmount;
        IERC20(stream.asset).transfer(to, withdrawnAmount);
    }

    function cancel(uint256 streamId) external {
        MockLockupLinear.Stream memory stream = streams[streamId];
        require(stream.cancelable, "Stream is not cancelable");
        require(msg.sender == stream.sender, "Only sender can cancel");

        uint128 withdrawableAmount = withdrawableAmountOf(streamId);
        uint128 refundAmount = stream.totalAmount - withdrawableAmount;

        streams[streamId].wasCanceled = true;

        if (withdrawableAmount > 0) {
            IERC20(stream.asset).transfer(stream.recipient, withdrawableAmount);
        }
        if (refundAmount > 0) {
            IERC20(stream.asset).transfer(stream.sender, refundAmount);
        }
    }

    function isCancelable(uint256 streamId) external view returns (bool) {
        return streams[streamId].cancelable;
    }

    /// @dev Retrieves the stream's status without performing a null check.
    function statusOf(
        uint256 streamId
    ) public view returns (MockLockupLinear.Status) {
        uint256 withdrawableAmount = withdrawableAmountOf(streamId);
        if (withdrawableAmount == 0) {
            return MockLockupLinear.Status.DEPLETED;
        } else if (streams[streamId].wasCanceled) {
            return MockLockupLinear.Status.CANCELED;
        }

        if (block.timestamp < streams[streamId].startTime) {
            return MockLockupLinear.Status.PENDING;
        }

        if (block.timestamp < streams[streamId].endTime) {
            return MockLockupLinear.Status.STREAMING;
        } else {
            return MockLockupLinear.Status.SETTLED;
        }
    }
}
