// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IStrategyBaseV1} from "../interfaces/decent/deployables/IStrategyBaseV1.sol";

contract MockVotingStrategy is IStrategyBaseV1 {
    struct TimestampPoints {
        uint48 startTimestamp;
        uint48 endTimestamp;
    }

    address public proposer;
    mapping(uint32 => bool) private _isPassed;
    mapping(uint32 => TimestampPoints) private _proposalTimestamps;
    mapping(uint32 => uint32) public mockVotingStartBlock;

    constructor(address _proposer) {
        proposer = _proposer;
    }

    function initializeProposal(
        uint32 _proposalId,
        bytes32[] memory _txHashes,
        bytes memory _data
    ) external override {}

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
        return (timestamps.startTimestamp, timestamps.endTimestamp);
    }

    function getVotingStartBlock(
        uint32 _proposalId
    ) external view override returns (uint32 votingStartBlock) {
        return mockVotingStartBlock[_proposalId];
    }

    // mock setters

    function setIsPassed(uint32 proposalId, bool passed) external {
        _isPassed[proposalId] = passed;
    }

    function setVotingTimestamps(
        uint32 proposalId,
        uint48 startTimestamp,
        uint48 endTimestamp
    ) external {
        _proposalTimestamps[proposalId] = TimestampPoints(
            startTimestamp,
            endTimestamp
        );
    }

    function setVotingStartBlock(
        uint32 proposalId,
        uint32 startBlock
    ) external {
        mockVotingStartBlock[proposalId] = startBlock;
    }
}
