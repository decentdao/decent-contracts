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

    /// @dev Updates the time that proposals are active for voting.
    /// @param _newVotingPeriod the voting window.
    function updateVotingPeriod(uint256 _newVotingPeriod) external onlyOwner {
        _updateVotingPeriod(_newVotingPeriod);
    }

    /// @dev Updates the grace period time after a proposal passed before it can execute.
    /// @param _newTimelockPeriod the new delay before execution.
    function updateTimelockPeriod(uint256 _newTimelockPeriod)
        external
        onlyOwner
    {
      _updateTimelockPeriod(_newTimelockPeriod);
    }

    function _updateTimelockPeriod(uint256 _newTimelockPeriod) internal {
        timeLockPeriod = _newTimelockPeriod;
        emit TimelockPeriodUpdated(_newTimelockPeriod);
    }

    function _updateVotingPeriod(uint256 _newVotingPeriod) internal {
        votingPeriod = _newVotingPeriod;

        emit VotingPeriodUpdated(_newVotingPeriod);
    }

    /// @dev Returns true if an account has voted on a specific proposal.
    /// @param proposalId the proposal to inspect.
    /// @param account the account to inspect.
    /// @return boolean.
    function hasVoted(uint256 proposalId, address account)
        public
        view
        returns (bool)
    {
        return proposals[proposalId].hasVoted[account];
    }

    function _vote(
        uint256 proposalId,
        address voter,
        uint8 support,
        uint256 weight
    ) internal {
        require(
            block.timestamp <= proposals[proposalId].deadline,
            "voting period has passed"
        );
        require(!hasVoted(proposalId, voter), "voter has already voted");
        proposals[proposalId].hasVoted[voter] = true;
        if (support == uint8(VoteType.Against)) {
            proposals[proposalId].noVotes += weight;
        } else if (support == uint8(VoteType.For)) {
            proposals[proposalId].yesVotes += weight;
        } else if (support == uint8(VoteType.Abstain)) {
            proposals[proposalId].abstainVotes += weight;
        } else {
            revert("invalid value for enum VoteType");
        }
        emit Voted(voter, proposalId, support, weight);
    }

    /// @dev Called by the proposal module, this notifes the strategy of a new proposal.
    /// @param data any extra data to pass to the voting strategy
    function receiveProposal(bytes memory data)
        external
        virtual
        override
        onlyUsul
    {
        uint256 proposalId = abi.decode(data, (uint256));
        proposals[proposalId].deadline = votingPeriod + block.timestamp;
        proposals[proposalId].startBlock = block.number;
        emit ProposalReceived(proposalId, block.timestamp);
    }

    /// @dev Calls the proposal module to notify that a quorum has been reached.
    /// @param proposalId the proposal to vote for.
    function queueProposal(uint256 proposalId) public virtual override {
        if (isPassed(proposalId)) {
            usulModule.queueProposal(proposalId, timeLockPeriod);
        }
        emit VoteFinalized(proposalId, block.timestamp);
    }
}
