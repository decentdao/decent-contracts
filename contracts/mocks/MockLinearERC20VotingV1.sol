// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

// Mirror the struct for getProposalVotes return values
struct ProposalPeriod {
    uint32 startBlock;
    uint32 endBlock;
}

// Mirror the struct from IERC20Votes
struct Checkpoint {
    uint32 fromBlock;
    uint224 votes;
}

contract MockLinearERC20VotingV1 {
    // Mapping: proposalId => ProposalPeriod
    mapping(uint32 => ProposalPeriod) public getProposalPeriod;
    // Mapping: proposalId => votingPeriodEnded
    mapping(uint32 => bool) public votingPeriodEnded;
    // Mapping: proposalId => voter => hasVoted
    mapping(uint32 => mapping(address => bool)) public hasVoted;
    // governance token
    address public governanceToken;

    // Mapping: address => numCheckpoints
    mapping(address => uint32) public numCheckpoints;
    // Mapping: address => checkpointIndex => Checkpoint
    mapping(address => Checkpoint[]) private _checkpoints;

    function vote(uint32 proposalId, uint8 voteType) external {
        // Mock implementation - just for interface matching
    }

    function setProposalPeriod(
        uint32 proposalId,
        ProposalPeriod calldata data
    ) external {
        getProposalPeriod[proposalId] = data;
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

    function setGovernanceToken(address tokenAddress) external {
        governanceToken = tokenAddress;
    }

    function checkpoints(
        address account,
        uint32 pos
    ) public view virtual returns (Checkpoint memory) {
        return _checkpoints[account][pos];
    }

    function setCheckpoints(
        address account,
        Checkpoint[] calldata checkpointsData
    ) external {
        // Clear existing checkpoints
        while (_checkpoints[account].length > 0) {
            _checkpoints[account].pop();
        }

        // Add new checkpoints one by one
        for (uint32 i = 0; i < checkpointsData.length; i++) {
            _checkpoints[account].push(checkpointsData[i]);
        }

        // Update the checkpoint count
        numCheckpoints[account] = uint32(checkpointsData.length);
    }
}
