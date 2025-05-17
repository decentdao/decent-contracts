// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IBaseStrategyV1} from "../interfaces/decent/deployables/IBaseStrategyV1.sol";
import {ClockMode} from "../interfaces/decent/ClockMode.sol";

contract MockVotingStrategy is IBaseStrategyV1 {
    struct TimestampPoints {
        uint48 startTime;
        uint48 endTime;
    }

    address public proposer;
    mapping(uint32 => bool) private _isPassed;
    mapping(uint32 => TimestampPoints) private _proposalTimestamps;

    constructor(address _proposer) {
        proposer = _proposer;
    }

    function initializeProposal(bytes memory) external override {}

    function isPassed(uint32 proposalId) external view override returns (bool) {
        return _isPassed[proposalId];
    }

    function isProposer(
        address _proposer
    ) external view override returns (bool) {
        return _proposer == proposer;
    }

    function getVotingTimestamps(
        uint32 proposalId
    ) external view override returns (uint48, uint48) {
        TimestampPoints memory timestamps = _proposalTimestamps[proposalId];
        return (timestamps.startTime, timestamps.endTime);
    }

    function setVotingTimestamps(
        uint32 proposalId,
        uint48 startTime,
        uint48 endTime
    ) external {
        _proposalTimestamps[proposalId] = TimestampPoints(startTime, endTime);
    }

    function setIsPassed(uint32 proposalId, bool passed) external {
        _isPassed[proposalId] = passed;
    }
}
