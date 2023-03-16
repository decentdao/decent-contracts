// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "./BaseTokenVoting.sol";
import "./BaseQuorumPercent.sol";

/**
 * @title An Azorius BaseTokenVoting strategy that enables linear (i.e. 1 to 1) token voting.
 * Each token delegated to a given address in an ERC20Votes token equals 1 vote for a Proposal.
 */
contract LinearTokenVoting is BaseTokenVoting, BaseQuorumPercent {
    
    ERC20Votes public governanceToken;

    /**
     * Sets up the contract with its initial parameters.
     *
     * @param initParams initial setup parameters, encoded as bytes
     */
    function setUp(bytes memory initParams) public override initializer {
        (
            address _owner,
            ERC20Votes _governanceToken,
            address _azoriusModule,
            uint256 _votingPeriod,
            uint256 _quorumNumerator,
        ) = abi.decode(
                initParams,
                (
                    address,
                    ERC20Votes,
                    address,
                    uint256,
                    uint256,
                )
            );
        require(
            address(_governanceToken) != address(0),
            "Invalid governance token address"
        );

        governanceToken = _governanceToken;
        __Ownable_init();
        transferOwnership(_owner);
        _setAzorius(_azoriusModule);
        _updateQuorumNumerator(_quorumNumerator);
        _updateVotingPeriod(_votingPeriod);

        emit StrategySetUp(_azoriusModule, _owner);
    }

    /**
     * Casts votes for a Proposal, equal to the caller's token delegation.
     *
     * @param _proposalId id of the Proposal to vote on
     * @param _voteType Proposal support as defined in VoteType (NO, YES, ABSTAIN)
     */
    function vote(uint256 _proposalId, uint8 _voteType, bytes memory) external {
        _vote(
            _proposalId,
            msg.sender,
            _voteType,
            getVotingWeight(msg.sender, _proposalId)
        );
    }

    /**
     * Calculates the number of votes needed to achieve quorum at a specific block number.
     *
     * Because token supply is not necessarily static, it is required to calculate
     * quorum based on the supply at the time of a Proposal's creation.
     *
     * @param _blockNumber block number to calculate quorum at
     * @return uint256 the number of votes needed for quorum
     */
    function quorum(uint256 _blockNumber) public view override returns (uint256) {
        return
            (governanceToken.getPastTotalSupply(_blockNumber) *
                quorumNumerator) / QUORUM_DENOMINATOR;
    }

    /**
     * Calculates the voting weight an address has for a specific Proposal.
     *
     * @param _voter address of the voter
     * @param _proposalId id of the Proposal
     * @return uint256 the address' voting weight
     */
    function getVotingWeight(address _voter, uint256 _proposalId) public view returns (uint256) {
        return
            governanceToken.getPastVotes(
                _voter,
                proposalVotes[_proposalId].votingStartBlock
            );
    }

    /// @inheritdoc IBaseStrategy
    function isPassed(uint256 _proposalId) public view override returns (bool) {
        if (
            proposalVotes[_proposalId].yesVotes > proposalVotes[_proposalId].noVotes &&
            proposalVotes[_proposalId].yesVotes >=
            quorum(proposalVotes[_proposalId].votingStartBlock) &&
            proposalVotes[_proposalId].votingEndBlock != 0 &&
            block.number > proposalVotes[_proposalId].votingEndBlock
        ) {
            return true;
        }

        return false;
    }

    /// @inheritdoc IBaseStrategy
    function isProposer(address) public pure override returns (bool) {
        return true; // anyone can submit Proposals
    }
}