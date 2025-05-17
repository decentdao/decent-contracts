// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

// Mirror the struct for getProposalVotes return values
struct ProposalPeriod {
    uint48 startTime;
    uint48 endTime;
}

contract MockLinearERC721VotingV1 {
    // Mapping: proposalId => ProposalPeriod
    mapping(uint32 => ProposalPeriod) public getVotingTimestamps;
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

    function setVotingTimestamps(
        uint32 proposalId,
        ProposalPeriod calldata data
    ) external {
        getVotingTimestamps[proposalId] = data;
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
