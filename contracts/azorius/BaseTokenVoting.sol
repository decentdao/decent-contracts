// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

import "./BaseStrategy.sol";

/// @title An abstract contract used as a base for ERC-20 token voting strategies
abstract contract BaseTokenVoting is BaseStrategy {

    /**
     * The voting options for a Proposal.
     */
    enum VoteType {
        YES,    // approves of executing the Proposal
        NO,     // disapproves of executing the Proposal
        ABSTAIN // neither YES nor NO, i.e. voting "present"
    }

    /**
     * Defines the current state of votes on a particular Proposal.
     * TODO rename this to something better
     */
    struct ProposalVoting {
        uint256 yesVotes; // current number of YES votes for the Proposal
        uint256 noVotes; // current number of NO votes for the Proposal
        uint256 abstainVotes; // current number of ABSTAIN votes for the Proposal
        uint256 votingStartBlock; // block that voting starts at
        uint256 votingEndBlock; // block that voting ends
        mapping(address => bool) hasVoted; // whether a given address has voted yet or not
    }

    /** Number of blocks a new Proposal can be voted on. */
    uint256 public votingPeriod;

    /** TODO is this needed? what's this for */
    string public name;

    /** proposalId to ProposalVoting, the voting state of a Proposal */
    mapping(uint256 => ProposalVoting) internal proposals; // TODO rename to voteState?

    event VotingPeriodUpdated(uint256 votingPeriod);
    event ProposalInitialized(uint256 proposalId, uint256 votingEndBlock);
    event Voted(address voter, uint256 proposalId, uint8 support, uint256 weight); // TODO should support be VoteType here?

    /**
     * Updates the voting time period for new Proposals.
     *
     * @param _votingPeriod voting time period (in blocks)
     */
    function updateVotingPeriod(uint256 _votingPeriod) external onlyOwner {
        _updateVotingPeriod(_votingPeriod);
    }

    /** Internal implementation of  updateVotingPeriod above TODO WHY */
    function _updateVotingPeriod(uint256 _votingPeriod) internal {
        votingPeriod = _votingPeriod;
        emit VotingPeriodUpdated(_votingPeriod);
    }

    /// @inheritdoc IBaseStrategy
    function initializeProposal(bytes memory _data) external virtual override onlyAzorius {
        uint256 proposalId = abi.decode(_data, (uint256));
        uint256 _votingEndBlock = block.number + votingPeriod;

        proposals[proposalId].votingEndBlock = _votingEndBlock;
        proposals[proposalId].votingStartBlock = block.number;

        emit ProposalInitialized(proposalId, _votingEndBlock);
    }
    
    /**
     * Internal function for casting a vote on a Proposal.
     *
     * @param _proposalId id of the Proposal
     * @param _voter address casting the vote
     * @param _support vote support, as defined in VoteType TODO should this be VoteType?
     * @param _weight amount of voting weight cast, typically the
     *          total number of tokens delegated
     */
    function _vote(uint256 _proposalId, address _voter, uint8 _support, uint256 _weight) internal {
        require(
            proposals[_proposalId].votingEndBlock != 0,
            "Proposal has not been submitted yet"
        );
        require(
            block.number <= proposals[_proposalId].votingEndBlock,
            "Voting period has passed"
        );
        require(
            !proposals[_proposalId].hasVoted[_voter],
            "Voter has already voted"
        );

        proposals[_proposalId].hasVoted[_voter] = true;

        if (_support == uint8(VoteType.NO)) {
            proposals[_proposalId].noVotes += _weight;
        } else if (_support == uint8(VoteType.YES)) {
            proposals[_proposalId].yesVotes += _weight;
        } else if (_support == uint8(VoteType.ABSTAIN)) {
            proposals[_proposalId].abstainVotes += _weight;
        } else {
            revert("Invalid value for enum VoteType"); // TODO making the param be VoteType removes this
        }

        emit Voted(_voter, _proposalId, _support, _weight);
    }

    /**
     * Returns whether an address has voted on the specified Proposal.
     *
     * @param _proposalId id of the Proposal to check
     * @param _address address to check
     * @return bool true if the address has voted on the Proposal, otherwise false
     */
    function hasVoted(uint256 _proposalId, address _address) public view returns (bool) {
        return proposals[_proposalId].hasVoted[_address];
    }

    /**
     * Returns the current state of the specified Proposal.
     *
     * @param _proposalId id of the Proposal
     * @return yesVotes current count of "YES" votes
     * @return noVotes current count of "NO" votes
     * @return abstainVotes current count of "ABSTAIN" votes
     * @return votingStartBlock block number voting starts
     * @return votingEndBlock block number voting ends
     */
    function getProposal(uint256 _proposalId) external view
        returns (
            uint256 yesVotes,
            uint256 noVotes,
            uint256 abstainVotes,
            uint256 votingStartBlock,
            uint256 votingEndBlock // TODO what's this error here?
        )
    {
        yesVotes = proposals[_proposalId].yesVotes;
        noVotes = proposals[_proposalId].noVotes;
        abstainVotes = proposals[_proposalId].abstainVotes;
        votingStartBlock = proposals[_proposalId].votingStartBlock;
        votingEndBlock = proposals[_proposalId].votingEndBlock;
    }

    /// @inheritdoc BaseStrategy
    function votingEndBlock(uint256 _proposalId) public view override returns (uint256) {
      return proposals[_proposalId].votingEndBlock;
    }
}
