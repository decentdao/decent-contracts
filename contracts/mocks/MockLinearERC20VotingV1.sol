// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

contract MockLinearERC20VotingV1 {
    // Mapping: proposalId => endBlock
    mapping(uint32 => uint32) public votingEndBlock;
    // Mapping: proposalId => votingPeriodEnded
    mapping(uint32 => bool) public votingPeriodEnded;
    // Mapping: proposalId => voter => hasVoted
    mapping(uint32 => mapping(address => bool)) public hasVoted;
    // Mapping: voter => proposalId => votingWeight
    mapping(address => mapping(uint32 => uint256)) public getVotingWeight;

    function vote(uint32 proposalId, uint8 voteType) external {
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
        address account,
        bool voted
    ) external {
        hasVoted[proposalId][account] = voted;
    }

    function setVotingWeight(
        address _voter,
        uint32 _proposalId,
        uint256 _weight
    ) external {
        getVotingWeight[_voter][_proposalId] = _weight;
    }
}
