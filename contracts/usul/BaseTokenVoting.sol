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
        uint256 yesVotes; // the total number of YES votes for this proposal
        uint256 noVotes; // the total number of NO votes for this proposal
        uint256 abstainVotes; // introduce abstain votes
        uint256 deadline; // voting deadline TODO: consider using block number
        uint256 startBlock; // the starting block of the proposal
        mapping(address => bool) hasVoted;
    }

    uint256 public votingPeriod; // the length of time voting is valid for a proposal
    uint256 public timeLockPeriod;
    string public name;

    mapping(uint256 => ProposalVoting) public proposals;

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
    function updateTimelockPeriod(uint256 _newTimelockPeriod)
        external
        onlyOwner
    {
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
        timeLockPeriod = _newTimelockPeriod;

        emit TimelockPeriodUpdated(_newTimelockPeriod);
    }

    /// @notice Returns true if an account has voted on the specified proposal
    /// @param _proposalId The ID of the proposal to check
    /// @param _account The account address to check
    /// @return bool Returns true if the account has already voted on the proposal
    function hasVoted(uint256 _proposalId, address _account)
        public
        view
        returns (bool)
    {
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
            block.timestamp <= proposals[_proposalId].deadline,
            "voting period has passed"
        );
        require(!hasVoted(_proposalId, _voter), "voter has already voted");

        proposals[_proposalId].hasVoted[_voter] = true;

        if (_support == uint8(VoteType.Against)) {
            proposals[_proposalId].noVotes += _weight;
        } else if (_support == uint8(VoteType.For)) {
            proposals[_proposalId].yesVotes += _weight;
        } else if (_support == uint8(VoteType.Abstain)) {
            proposals[_proposalId].abstainVotes += _weight;
        } else {
            revert("invalid value for enum VoteType");
        }

        emit Voted(_voter, _proposalId, _support, _weight);
    }

    /// @notice Notifies the strategy of a new proposal, only callable by the Usul Module
    /// @param _data Encoded proposal data, in this implementation only includes proposal ID
    function receiveProposal(bytes memory _data)
        external
        virtual
        override
        onlyUsul
    {
        uint256 proposalId = abi.decode(_data, (uint256));

        proposals[proposalId].deadline = votingPeriod + block.timestamp;
        proposals[proposalId].startBlock = block.number;

        emit ProposalReceived(proposalId, block.timestamp);
    }

    /// @notice Calls the Usul module to notify that a quorum has been reached
    /// @notice Queues the proposal and starts timelock period
    /// @param _proposalId The ID of the proposal to queue
    function queueProposal(uint256 _proposalId) public virtual override {
        require(isPassed(_proposalId));

        usulModule.queueProposal(_proposalId, timeLockPeriod);
        
        emit VoteFinalized(_proposalId, block.timestamp);
    }
}
