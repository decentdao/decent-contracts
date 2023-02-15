// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/utils/cryptography/draft-EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./BaseStrategy.sol";

/// @title An abstract contract used as a base for ERC-20 token voting strategies
abstract contract BaseTokenVoting is BaseStrategy {
    enum VoteType {
        Against,
        For,
        Abstain
    }

    struct ProposalVoting {
        uint256 yesVotes; // The total number of YES votes for this proposal
        uint256 noVotes; // The total number of NO votes for this proposal
        uint256 abstainVotes; // The total number of ABSTAIN votes for this proposal
        uint256 deadline; // The timestamp voting ends for this proposal
        uint256 startBlock; // The block the proposal voting starts
        mapping(address => bool) hasVoted;
    }

    uint256 public votingPeriod; // the length of time voting is valid for a proposal
    uint256 public timelockPeriod;
    string public name;

    mapping(uint256 => ProposalVoting) internal proposals;

    event TimelockPeriodUpdated(uint256 newTimeLockPeriod);
    event VotingPeriodUpdated(uint256 newVotingPeriod);
    event ProposalReceived(uint256 proposalId, uint256 timestamp);
    event VoteFinalized(uint256 proposalId, uint256 timestamp);
    event Voted(
        address voter,
        uint256 proposalId,
        uint8 support,
        uint256 weight
    );

    /// @notice Updates the voting time period
    /// @param _newVotingPeriod The voting time period in seconds
    function updateVotingPeriod(uint256 _newVotingPeriod) external onlyOwner {
        _updateVotingPeriod(_newVotingPeriod);
    }

    /// @notice Updates the timelock period - time between queuing and when a proposal can be executed
    /// @param _newTimelockPeriod The new timelock period in seconds
    function updateTimelockPeriod(
        uint256 _newTimelockPeriod
    ) external onlyOwner {
        _updateTimelockPeriod(_newTimelockPeriod);
    }

    /// @notice Updates the voting time period
    /// @param _newVotingPeriod The voting time period in seconds
    function _updateVotingPeriod(uint256 _newVotingPeriod) internal {
        votingPeriod = _newVotingPeriod;

        emit VotingPeriodUpdated(_newVotingPeriod);
    }

    /// @notice Updates the timelock period - time between queuing and when a proposal can be executed
    /// @param _newTimelockPeriod The new timelock period in seconds
    function _updateTimelockPeriod(uint256 _newTimelockPeriod) internal {
        timelockPeriod = _newTimelockPeriod;

        emit TimelockPeriodUpdated(_newTimelockPeriod);
    }

    /// @notice Returns true if an account has voted on the specified proposal
    /// @param _proposalId The ID of the proposal to check
    /// @param _account The account address to check
    /// @return bool Returns true if the account has already voted on the proposal
    function hasVoted(
        uint256 _proposalId,
        address _account
    ) public view returns (bool) {
        return proposals[_proposalId].hasVoted[_account];
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
        require(
            proposals[_proposalId].deadline != 0,
            "Proposal has not been submitted yet"
        );
        require(
            block.timestamp <= proposals[_proposalId].deadline,
            "Voting period has passed"
        );
        require(
            !proposals[_proposalId].hasVoted[_voter],
            "Voter has already voted"
        );

        proposals[_proposalId].hasVoted[_voter] = true;

        if (_support == uint8(VoteType.Against)) {
            proposals[_proposalId].noVotes += _weight;
        } else if (_support == uint8(VoteType.For)) {
            proposals[_proposalId].yesVotes += _weight;
        } else if (_support == uint8(VoteType.Abstain)) {
            proposals[_proposalId].abstainVotes += _weight;
        } else {
            revert("Invalid value for enum VoteType");
        }

        emit Voted(_voter, _proposalId, _support, _weight);
    }

    /// @notice Called by the proposal module, this notifes the strategy of a new proposal
    /// @param _data Any extra data to pass to the voting strategy
    function initializeProposal(
        bytes memory _data
    ) external virtual override onlyUsul {
        uint256 proposalId = abi.decode(_data, (uint256));

        proposals[proposalId].deadline = votingPeriod + block.timestamp;
        proposals[proposalId].startBlock = block.number;

        emit ProposalReceived(proposalId, block.timestamp);
    }

    /// @notice Calls the Usul module to notify that a quorum has been reached
    /// @notice Timelocks the proposal and starts timelock period
    /// @param _proposalId The ID of the proposal to timelock
    function timelockProposal(uint256 _proposalId) public virtual override {
        require(isPassed(_proposalId));

        usulModule.timelockProposal(_proposalId, timelockPeriod);

        emit VoteFinalized(_proposalId, block.timestamp);
    }

    /// @notice Returns the current state of the specified proposal
    /// @param _proposalId The ID of the proposal to get
    /// @return yesVotes The total count of "Yes" votes for the proposal
    /// @return noVotes The total count of "No" votes for the proposal
    /// @return abstainVotes The total count of "Abstain" votes for the proposal
    /// @return deadline The timestamp at which proposal voting ends
    /// @return startBlock The block number that the proposal voting starts at
    function getProposal(
        uint256 _proposalId
    )
        external
        view
        returns (
            uint256 yesVotes,
            uint256 noVotes,
            uint256 abstainVotes,
            uint256 deadline,
            uint256 startBlock
        )
    {
        yesVotes = proposals[_proposalId].yesVotes;
        noVotes = proposals[_proposalId].noVotes;
        abstainVotes = proposals[_proposalId].abstainVotes;
        deadline = proposals[_proposalId].deadline;
        startBlock = proposals[_proposalId].startBlock;
    }
}
