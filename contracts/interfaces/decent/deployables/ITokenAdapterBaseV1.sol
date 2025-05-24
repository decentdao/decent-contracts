// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

interface ITokenAdapterBaseV1 {
    event VoteRecorded(
        address indexed voter,
        uint32 indexed proposalId,
        uint256 weightCasted,
        bytes adapterVoteData
    );

    function isProposer(address _proposer) external view returns (bool);

    function recordVote(
        address _voter,
        uint32 _proposalId,
        bytes calldata _adapterVoteData
    ) external returns (uint256 weightCasted);
}
