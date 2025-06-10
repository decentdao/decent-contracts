// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

interface IVotingAdapterERC721V1 {
    // --- Errors ---

    error TokenIdAlreadyUsedForVote(uint256 tokenId);
    error TokenIdNotOwnedByVoter(uint256 tokenId);
    error DuplicateTokenIds();

    // --- Initializer Functions ---

    function initialize(
        address token_,
        address strategy_,
        uint256 weightPerToken_
    ) external;

    // --- View Functions ---

    function token() external view returns (address token);

    function weightPerToken() external view returns (uint256 weightPerToken);

    function tokenIdUsedForVote(
        uint32 proposalId_,
        uint256 tokenId_
    ) external view returns (bool tokenUsed);

    function weightOfWithValidTokenIds(
        address voter_,
        uint32 proposalId_,
        bytes calldata adapterVoteData_
    ) external view returns (uint256 weight, uint256[] memory validTokenIds);

    function getFreezeVoteWeight(
        address voter_,
        address freezeVoteContract_,
        uint48 freezeProposalSnapshotAndId_,
        bytes calldata adapterVoteData_
    ) external view returns (uint256 weight);

    function tokenIdUsedPerFreezeVoteProposalPerFreezeVoteContract(
        address freezeVoteContract_,
        uint48 freezeProposalSnapshotAndId_,
        uint256 tokenId_
    ) external view returns (bool tokenUsed);
}
