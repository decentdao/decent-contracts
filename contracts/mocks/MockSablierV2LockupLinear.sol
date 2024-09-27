// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/sablier/ISablierV2LockupLinear.sol";
import {LockupLinear} from "../interfaces/sablier/LockupLinear.sol";

contract MockSablierV2LockupLinear is ISablierV2LockupLinear {
    // Define the Stream struct here
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

    mapping(uint256 => Stream) public streams;
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
        streams[streamId] = Stream({
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

    function getStream(uint256 streamId) external view returns (Stream memory) {
        return streams[streamId];
    }

    function withdrawableAmountOf(
        uint256 streamId
    ) public view returns (uint128) {
        Stream memory stream = streams[streamId];
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

    function withdraw(uint256 streamId, uint128 amount) external {
        Stream storage stream = streams[streamId];
        require(msg.sender == stream.recipient, "Only recipient can withdraw");
        require(
            amount <= withdrawableAmountOf(streamId),
            "Insufficient withdrawable amount"
        );

        stream.totalAmount -= amount;
        IERC20(stream.asset).transfer(stream.recipient, amount);
    }

    function cancel(uint256 streamId) external {
        Stream memory stream = streams[streamId];
        require(stream.cancelable, "Stream is not cancelable");
        require(msg.sender == stream.sender, "Only sender can cancel");

        uint128 withdrawableAmount = withdrawableAmountOf(streamId);
        uint128 refundAmount = stream.totalAmount - withdrawableAmount;

        delete streams[streamId];

        if (withdrawableAmount > 0) {
            IERC20(stream.asset).transfer(stream.recipient, withdrawableAmount);
        }
        if (refundAmount > 0) {
            IERC20(stream.asset).transfer(stream.sender, refundAmount);
        }
    }

    function renounce(uint256 streamId) external {
        Stream memory stream = streams[streamId];
        require(msg.sender == stream.recipient, "Only recipient can renounce");

        uint128 withdrawableAmount = withdrawableAmountOf(streamId);
        uint128 refundAmount = stream.totalAmount - withdrawableAmount;

        delete streams[streamId];

        if (withdrawableAmount > 0) {
            IERC20(stream.asset).transfer(stream.recipient, withdrawableAmount);
        }
        if (refundAmount > 0) {
            IERC20(stream.asset).transfer(stream.sender, refundAmount);
        }
    }

    function transferFrom(uint256 streamId, address recipient) external {
        Stream storage stream = streams[streamId];
        require(stream.transferable, "Stream is not transferable");
        require(
            msg.sender == stream.recipient,
            "Only current recipient can transfer"
        );

        stream.recipient = recipient;
    }

    function getRecipient(uint256 streamId) external view returns (address) {
        return streams[streamId].recipient;
    }
}
