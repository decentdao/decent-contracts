// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IBaseStrategyV1} from "../interfaces/decent/deployables/IBaseStrategyV1.sol";
import {ClockMode} from "../interfaces/decent/ClockMode.sol";

contract MockVotingStrategy is IBaseStrategyV1 {
    struct PeriodPoints {
        uint256 startPoint;
        uint256 endPoint;
    }

    address public proposer;
    mapping(uint32 => bool) private _isPassed;
    mapping(uint32 => PeriodPoints) private _proposalPeriodPoints;

    ClockMode private currentClockMode;

    constructor(address _proposer) {
        proposer = _proposer;
        currentClockMode = ClockMode.Timestamp;
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

    function setClockMode(ClockMode _newMode) external {
        currentClockMode = _newMode;
    }

    function getClockMode() external view override returns (ClockMode) {
        return currentClockMode;
    }

    function getProposalVotingPeriodPoints(
        uint32 proposalId
    ) external view override returns (uint256, uint256) {
        PeriodPoints memory periodPoints = _proposalPeriodPoints[proposalId];
        return (periodPoints.startPoint, periodPoints.endPoint);
    }

    function setProposalPeriodPoints(
        uint32 proposalId,
        uint256 startPoint,
        uint256 endPoint
    ) external {
        _proposalPeriodPoints[proposalId] = PeriodPoints(startPoint, endPoint);
    }

    function setIsPassed(uint32 proposalId, bool passed) external {
        _isPassed[proposalId] = passed;
    }
}
