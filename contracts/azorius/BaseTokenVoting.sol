// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

import "./BaseStrategy.sol";

/**
 * @title BaseTokenVoting - an abstract contract used as a base for ERC-20 token voting strategies.
 */
abstract contract BaseTokenVoting is BaseStrategy {

    /**
     * The voting options for a Proposal.
     */
    enum VoteType {
        NO,     // disapproves of executing the Proposal
        YES,    // approves of executing the Proposal
        ABSTAIN // neither YES nor NO, i.e. voting "present"
    }

    /**
     * Defines the current state of votes on a particular Proposal.
     */
    struct ProposalVotes {
        uint256 noVotes; // current number of NO votes for the Proposal
        uint256 yesVotes; // current number of YES votes for the Proposal
        uint256 abstainVotes; // current number of ABSTAIN votes for the Proposal
        uint256 votingStartBlock; // block that voting starts at
        uint256 votingEndBlock; // block that voting ends
        mapping(address => bool) hasVoted; // whether a given address has voted yet or not
    }

    /** Number of blocks a new Proposal can be voted on. */
    uint256 public votingPeriod;

    /** proposalId to ProposalVotes, the voting state of a Proposal */
    mapping(uint256 => ProposalVotes) internal proposalVotes;

    event VotingPeriodUpdated(uint256 votingPeriod);
    event ProposalInitialized(uint256 proposalId, uint256 votingEndBlock);
    event Voted(address voter, uint256 proposalId, uint8 voteType, uint256 weight);

    /**
     * Updates the voting time period for new Proposals.
     *
     * @param _votingPeriod voting time period (in blocks)
     */
    function updateVotingPeriod(uint256 _votingPeriod) external onlyOwner {
        _updateVotingPeriod(_votingPeriod);
    }

    /** Internal implementation of updateVotingPeriod above */
    function _updateVotingPeriod(uint256 _votingPeriod) internal {
        votingPeriod = _votingPeriod;
        emit VotingPeriodUpdated(_votingPeriod);
    }

    /// @inheritdoc IBaseStrategy
    function initializeProposal(bytes memory _data) external virtual override onlyAzorius {
        uint256 proposalId = abi.decode(_data, (uint256));
        uint256 _votingEndBlock = block.number + votingPeriod;

        proposalVotes[proposalId].votingEndBlock = _votingEndBlock;
        proposalVotes[proposalId].votingStartBlock = block.number;

        emit ProposalInitialized(proposalId, _votingEndBlock);
    }
    
    /**
     * Internal function for casting a vote on a Proposal.
     *
     * @param _proposalId id of the Proposal
     * @param _voter address casting the vote
     * @param _voteType vote support, as defined in VoteType
     * @param _weight amount of voting weight cast, typically the
     *          total number of tokens delegated
     */
    function _vote(uint256 _proposalId, address _voter, uint8 _voteType, uint256 _weight) internal {
        require(
            proposalVotes[_proposalId].votingEndBlock != 0,
            "Proposal has not been submitted yet"
        );
        require(
            block.number <= proposalVotes[_proposalId].votingEndBlock,
            "Voting period has passed"
        );
        require(
            !proposalVotes[_proposalId].hasVoted[_voter],
            "Voter has already voted"
        );

        proposalVotes[_proposalId].hasVoted[_voter] = true;

        if (_voteType == uint8(VoteType.NO)) {
            proposalVotes[_proposalId].noVotes += _weight;
        } else if (_voteType == uint8(VoteType.YES)) {
            proposalVotes[_proposalId].yesVotes += _weight;
        } else if (_voteType == uint8(VoteType.ABSTAIN)) {
            proposalVotes[_proposalId].abstainVotes += _weight;
        } else {
            revert("Invalid value for enum VoteType");
        }

        emit Voted(_voter, _proposalId, _voteType, _weight);
    }

    /**
     * Returns whether an address has voted on the specified Proposal.
     *
     * @param _proposalId id of the Proposal to check
     * @param _address address to check
     * @return bool true if the address has voted on the Proposal, otherwise false
     */
    function hasVoted(uint256 _proposalId, address _address) public view returns (bool) {
        return proposalVotes[_proposalId].hasVoted[_address];
    }

    /**
     * Returns the current state of the specified Proposal.
     *
     * @param _proposalId id of the Proposal
     * @return noVotes current count of "NO" votes
     * @return yesVotes current count of "YES" votes
     * @return abstainVotes current count of "ABSTAIN" votes
     * @return votingStartBlock block number voting starts
     * @return votingEndBlock block number voting ends
     */
    function getProposal(uint256 _proposalId) external view
        returns (
            uint256 noVotes,
            uint256 yesVotes,
            uint256 abstainVotes,
            uint256 votingStartBlock,
            uint256 votingEndBlock
        )
    {
        noVotes = proposalVotes[_proposalId].noVotes;
        yesVotes = proposalVotes[_proposalId].yesVotes;
        abstainVotes = proposalVotes[_proposalId].abstainVotes;
        votingStartBlock = proposalVotes[_proposalId].votingStartBlock;
        votingEndBlock = proposalVotes[_proposalId].votingEndBlock;
    }

    /// @inheritdoc BaseStrategy
    function votingEndBlock(uint256 _proposalId) public view override returns (uint256) {
      return proposalVotes[_proposalId].votingEndBlock;
    }
}