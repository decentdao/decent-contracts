// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity =0.8.19;

import "./BaseStrategy.sol";

// TODO: move this into linearTOkenVoting
// TODO: rename to ERC20Voting

/// @title An abstract contract used as a base for ERC-20 token voting strategies
abstract contract BaseTokenVoting is BaseStrategy {
    enum VoteType {
        NO,
        YES,
        ABSTAIN
    }

    struct ProposalVotes {
        uint256 noVotes; // The total number of NO votes for this proposal
        uint256 yesVotes; // The total number of YES votes for this proposal
        uint256 abstainVotes; // The total number of ABSTAIN votes for this proposal
        uint256 votingStartBlock; // The block the proposal voting starts
        uint256 votingEndBlock; // The block voting ends for this proposal
        mapping(address => bool) hasVoted;
    }

    uint256 public votingPeriod; // The number of blocks a proposal can be voted on
    mapping(uint256 => ProposalVotes) internal proposalVotes;

    event VotingPeriodUpdated(uint256 newVotingPeriod);
    event ProposalInitialized(uint256 proposalId, uint256 votingEndBlock);
    event Voted(
        address voter,
        uint256 proposalId,
        uint8 support,
        uint256 weight
    );

    error InvalidProposal();
    error VotingEnded();
    error AlreadyVoted();
    error InvalidVote();

    /// @notice Updates the voting time period
    /// @param _newVotingPeriod The voting time period in blocks
    function updateVotingPeriod(uint256 _newVotingPeriod) external onlyOwner {
        _updateVotingPeriod(_newVotingPeriod);
    }

    /// @notice Called by the proposal module, this notifes the strategy of a new proposal
    /// @param _data Any extra data to pass to the voting strategy
    function initializeProposal(
        bytes memory _data
    ) external virtual override onlyAzorius {
        uint256 proposalId = abi.decode(_data, (uint256));
        uint256 _votingEndBlock = block.number + votingPeriod;

        proposalVotes[proposalId].votingEndBlock = _votingEndBlock;
        proposalVotes[proposalId].votingStartBlock = block.number;

        emit ProposalInitialized(proposalId, _votingEndBlock);
    }

    /// @notice Updates the voting time period
    /// @param _newVotingPeriod The voting time period in blocks
    function _updateVotingPeriod(uint256 _newVotingPeriod) internal {
        votingPeriod = _newVotingPeriod;

        emit VotingPeriodUpdated(_newVotingPeriod);
    }

    /// @notice Function for counting a vote for a proposal, can only be called internally
    /// @param _proposalId The ID of the proposal
    /// @param _voter The address of the account casting the vote
    /// @param _support Indicates vote support, which can be "No", "Yes", or "Abstain"
    /// @param _weight The amount of voting weight cast
    function _vote(
        uint256 _proposalId,
        address _voter,
        uint8 _support,
        uint256 _weight
    ) internal {
        if (proposalVotes[_proposalId].votingEndBlock == 0)
            revert InvalidProposal();
        if (block.number > proposalVotes[_proposalId].votingEndBlock)
            revert VotingEnded();
        if (proposalVotes[_proposalId].hasVoted[_voter]) revert AlreadyVoted();

        proposalVotes[_proposalId].hasVoted[_voter] = true;

        if (_support == uint8(VoteType.NO)) {
            proposalVotes[_proposalId].noVotes += _weight;
        } else if (_support == uint8(VoteType.YES)) {
            proposalVotes[_proposalId].yesVotes += _weight;
        } else if (_support == uint8(VoteType.ABSTAIN)) {
            proposalVotes[_proposalId].abstainVotes += _weight;
        } else {
            revert InvalidVote();
        }

        emit Voted(_voter, _proposalId, _support, _weight);
    }

    /// @notice Returns true if an account has voted on the specified proposal
    /// @param _proposalId The ID of the proposal to check
    /// @param _account The account address to check
    /// @return bool Returns true if the account has already voted on the proposal
    function hasVoted(
        uint256 _proposalId,
        address _account
    ) public view returns (bool) {
        return proposalVotes[_proposalId].hasVoted[_account];
    }

    /// @notice Returns the current state of the specified proposal
    /// @param _proposalId The ID of the proposal to get
    /// @return yesVotes The total count of "Yes" votes for the proposal
    /// @return noVotes The total count of "No" votes for the proposal
    /// @return abstainVotes The total count of "Abstain" votes for the proposal
    /// @return votingStartBlock The block number that the proposal voting starts
    /// @return votingEndBlock The block number that the proposal voting ends
    function getProposal(
        uint256 _proposalId
    )
        external
        view
        returns (
            uint256 yesVotes,
            uint256 noVotes,
            uint256 abstainVotes,
            uint256 votingStartBlock,
            uint256 votingEndBlock
        )
    {
        yesVotes = proposalVotes[_proposalId].yesVotes;
        noVotes = proposalVotes[_proposalId].noVotes;
        abstainVotes = proposalVotes[_proposalId].abstainVotes;
        votingStartBlock = proposalVotes[_proposalId].votingStartBlock;
        votingEndBlock = proposalVotes[_proposalId].votingEndBlock;
    }

    /// @notice Returns the block that voting ends on the proposal
    /// @param _proposalId The ID of the proposal to check
    /// @return uint256 The block number voting ends on the proposal
    function votingEndBlock(
        uint256 _proposalId
    ) public view override returns (uint256) {
        return proposalVotes[_proposalId].votingEndBlock;
    }
}
