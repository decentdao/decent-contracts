// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

contract MockLinearERC721VotingV1 {
    // Mapping: proposalId => endBlock
    mapping(uint32 => uint32) public votingEndBlock;
    // Mapping: proposalId => votingPeriodEnded
    mapping(uint32 => bool) public votingPeriodEnded;
    // Mapping: proposalId => tokenAddress => tokenId => hasVoted
    mapping(uint32 => mapping(address => mapping(uint256 => bool)))
        public hasVoted;
    // Mapping: tokenAddress => weight
    mapping(address => uint256) private tokenWeights;

    function vote(
        uint32 proposalId,
        uint8 voteType,
        address[] memory tokenAddresses,
        uint256[] memory tokenIds
    ) external {
        // Mock implementation - just for interface matching
    }

    function setVotingEndBlock(uint32 proposalId, uint32 endBlock) external {
        votingEndBlock[proposalId] = endBlock;
    }

    function setVotingPeriodEnded(uint32 proposalId, bool ended) external {
        votingPeriodEnded[proposalId] = ended;
    }

    function setHasVoted(
        uint32 proposalId,
        address tokenAddress,
        uint256 tokenId,
        bool voted
    ) external {
        hasVoted[proposalId][tokenAddress][tokenId] = voted;
    }

    function setTokenWeight(address tokenAddress, uint256 weight) external {
        tokenWeights[tokenAddress] = weight;
    }

    function getTokenWeight(
        address tokenAddress
    ) external view returns (uint256) {
        return tokenWeights[tokenAddress];
    }
}
