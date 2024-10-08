// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/sablier/ISablierV2LockupLinear.sol";
import {LockupLinear} from "../interfaces/sablier/LockupLinear.sol";

contract MockSablierV2LockupLinear is ISablierV2LockupLinear {
    mapping(uint256 => LockupLinear.Stream) public streams;
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
        LockupLinear.CreateWithTimestamps calldata params
    ) external override returns (uint256 streamId) {
        require(
            params.asset.transferFrom(
                msg.sender,
                address(this),
                params.totalAmount
            ),
            "Token transfer failed"
        );

        streamId = nextStreamId++;
        streams[streamId] = LockupLinear.Stream({
            sender: params.sender,
            recipient: params.recipient,
            totalAmount: params.totalAmount,
            asset: address(params.asset),
            cancelable: params.cancelable,
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
    ) external view returns (LockupLinear.Stream memory) {
        return streams[streamId];
    }

    function withdrawableAmountOf(
        uint256 streamId
    ) public view returns (uint128) {
        LockupLinear.Stream memory stream = streams[streamId];
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
        LockupLinear.Stream storage stream = streams[streamId];

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
        LockupLinear.Stream memory stream = streams[streamId];
        require(stream.cancelable, "Stream is not cancelable");
        require(msg.sender == stream.sender, "Only sender can cancel");

        uint128 withdrawableAmount = withdrawableAmountOf(streamId);
        uint128 refundAmount = stream.totalAmount - withdrawableAmount;

        // TODO: instead of deleting, update state similar to how the real Sablier contract does
        delete streams[streamId];

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
}
