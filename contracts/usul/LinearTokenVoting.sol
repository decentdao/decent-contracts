// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "./BaseTokenVoting.sol";
import "./BaseQuorumPercent.sol";

/// @title A Usul strategy that enables linear token voting
contract LinearTokenVoting is BaseTokenVoting, BaseQuorumPercent {
    ERC20Votes public governanceToken;

    constructor(
        address _owner,
        ERC20Votes _governanceToken,
        address _usulModule,
        uint256 _votingPeriod,
        uint256 quorumNumerator_,
        uint256 _timelockPeriod,
        string memory name_
    ) {
        bytes memory initParams = abi.encode(
            _owner,
            _governanceToken,
            _usulModule,
            _votingPeriod,
            quorumNumerator_,
            _timelockPeriod,
            name_
        );
        setUp(initParams);
    }

    /// @notice Sets up the contract with initial parameters
    /// @param initParams The initial setup parameters encoded as bytes
    function setUp(bytes memory initParams) public override initializer {
        (
            address _owner,
            ERC20Votes _governanceToken,
            address _usulModule,
            uint256 _votingPeriod,
            uint256 quorumNumerator_,
            uint256 _timelockPeriod,
            string memory name_
        ) = abi.decode(
                initParams,
                (
                    address,
                    ERC20Votes,
                    address,
                    uint256,
                    uint256,
                    uint256,
                    string
                )
            );
        require(_votingPeriod > 1, "votingPeriod must be greater than 1");
        require(
            address(_governanceToken) != address(0),
            "Invalid governance token address"
        );

        name = name_;
        governanceToken = _governanceToken;
        __Ownable_init();
        _updateQuorumNumerator(quorumNumerator_);
        transferOwnership(_owner);
        _setUsul(_usulModule);
        _updateVotingPeriod(_votingPeriod);
        _updateTimelockPeriod(_timelockPeriod);

        emit StrategySetup(_usulModule, _owner);
    }

    /// @notice Casts a vote for a proposal
    /// @param proposalId The ID of the proposal to vote for
    /// @param support Proposal support represented as NO, YES, or ABSTAIN
    function vote(uint256 proposalId, uint8 support, bytes memory) external {
        _vote(
            proposalId,
            msg.sender,
            support,
            getVotingWeight(msg.sender, proposalId)
        );
    }

    /// @notice Returns if a proposal has succeeded
    /// @param proposalId The ID of the proposal to vote for
    /// @return bool True if the proposal has passed
    function isPassed(uint256 proposalId) public view override returns (bool) {
        require(
            proposals[proposalId].yesVotes > proposals[proposalId].noVotes,
            "Majority yesVotes not reached"
        );
        require(
            proposals[proposalId].yesVotes >=
                quorum(proposals[proposalId].startBlock),
            "Quorum has not been reached for the proposal"
        );
        require(
            proposals[proposalId].deadline < block.timestamp,
            "Voting period is not over"
        );

        return true;
    }

    /// @notice Calculates the number of token votes needed for quorum at a specific block number
    /// @param blockNumber The block number to calculate quorum at
    /// @return uint256 The number of token votes needed for quorum
    function quorum(
        uint256 blockNumber
    ) public view override returns (uint256) {
        return
            (governanceToken.getPastTotalSupply(blockNumber) *
                quorumNumerator) / quorumDenominator;
    }

    /// @notice Calculates the voting weight an address has for a specific proposal
    /// @param voter Address of the voter
    /// @param proposalId The ID of the proposal
    /// @return uint256 The user's vote count
    function getVotingWeight(
        address voter,
        uint256 proposalId
    ) public view returns (uint256) {
        return
            governanceToken.getPastVotes(
                voter,
                proposals[proposalId].startBlock
            );
    }

    /// @notice Returns if the specified address can submit a proposal
    /// @return bool True if the user can submit a proposal
    function isProposer(address) public pure override returns (bool) {
      return true;
    }
}
