// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ISablierV2LockupLinear} from "../interfaces/sablier/ISablierV2LockupLinear.sol";
import {LockupLinear} from "../interfaces/sablier/LockupLinear.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockSablierV2LockupLinear is ISablierV2LockupLinear {
    struct Stream {
        address sender;
        address recipient;
        uint128 totalAmount;
        IERC20 asset;
        bool cancelable;
        bool transferable;
        LockupLinear.Durations durations;
        LockupLinear.Broker broker;
    }

    mapping(uint256 => Stream) public streams;
    uint256 public nextStreamId = 1;

    event StreamCreated(
        uint256 streamId,
        address sender,
        address recipient,
        uint128 totalAmount,
        address asset,
        uint40 startTime,
        uint40 endTime
    );

    function createWithDurations(
        LockupLinear.CreateWithDurations calldata params
    ) external override returns (uint256 streamId) {
        streamId = nextStreamId++;

        streams[streamId] = Stream({
            sender: params.sender,
            recipient: params.recipient,
            totalAmount: params.totalAmount,
            asset: params.asset,
            cancelable: params.cancelable,
            transferable: params.transferable,
            durations: params.durations,
            broker: params.broker
        });

        emit StreamCreated(
            streamId,
            params.sender,
            params.recipient,
            params.totalAmount,
            address(params.asset),
            uint40(block.timestamp + params.durations.cliff),
            uint40(block.timestamp + params.durations.total)
        );

        return streamId;
    }

    // Additional functions for testing purposes

    function getStream(uint256 streamId) external view returns (Stream memory) {
        return streams[streamId];
    }

    function mockStreamCompletion(uint256 streamId) external {
        // This function would be used to simulate a stream completing in tests
        delete streams[streamId];
    }
}
