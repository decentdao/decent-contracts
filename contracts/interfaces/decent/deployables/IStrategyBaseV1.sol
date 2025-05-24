// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

interface IStrategyBaseV1 {
    function initializeProposal(
        uint32 _proposalId,
        bytes32[] memory _txHashes,
        bytes memory _data
    ) external;

    function isPassed(uint32 _proposalId) external view returns (bool);

    function isProposer(address _address) external view returns (bool);

    function getVotingTimestamps(
        uint32 _proposalId
    ) external view returns (uint48 startTime, uint48 endTime);

    function getVotingStartBlock(
        uint32 _proposalId
    ) external view returns (uint32 votingStartBlock);
}
