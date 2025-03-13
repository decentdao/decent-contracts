// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

/**
 * Defines the current state of votes on a particular Proposal.
 */
struct ProposalVotesV1 {
    uint48 votingStartTimestamp; // timestamp that voting starts at
    uint48 votingEndTimestamp; // timestamp that voting ends
    uint256 noVotes; // current number of NO votes for the Proposal
    uint256 yesVotes; // current number of YES votes for the Proposal
    uint256 abstainVotes; // current number of ABSTAIN votes for the Proposal
    /**
     * ERC-721 contract address to individual NFT id to bool
     * of whether it has voted on this proposal.
     */
    mapping(address => mapping(uint256 => bool)) hasVoted;
}
