// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity =0.8.19;

import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import { LinearERC20Voting } from "../azorius/LinearERC20Voting.sol";

/**
 * A "token vester" contract, intended to allow for holding an ERC-20 token, to be released under a
 * predetermined vesting schedule.
 */
interface TokenVester {

    /**
     * Returns the current token balance in the vesting contract, for the given token holder, at a specific
     * block.
     *
     * Timestamping token balances at specific blocks is required on the vesting contract, in order to be
     * able to use a holder's historical balance when voting on proposals in the voting strategy.  Otherwise
     * it would be possible to acquire additional votes during the voting of a proposal.
     *
     * @param _token the ERC-20 token address for the asset you would like the balance of, in our usage this
     *          is always the Decent governance token address
     * @param _holder the token holder's address
     * @param _block the specific block number to query the balance at
     */
    function getBalance(address _token, address _holder, uint _block) external view returns (uint);
}

/**
 * An extension of the [LinearERC20Voting]("../azorius/LinearERC20Voting.md") voting strategy, specific
 * to Decent's voting needs.
 *
 * Decent will have a vesting contract which holds governance tokens for investors and contributors, to
 * be released under a predetermined vesting schedule, however these tokens should still be able to vote
 * on proposals.
 *
 * This contract gives voting weight to individuals equal to the token amount allocated to them in the 
 * vesting contract PLUS their voting weight, as determined by their VotesERC20 implementation.
 */
contract DecentDAOVoting is LinearERC20Voting {

    TokenVester public vester;

    function setUp(bytes memory initializeParams) public override initializer {
        (
            address _owner,
            IVotes _governanceToken,
            address _azoriusModule,
            uint32 _votingPeriod,
            uint256 _requiredProposerWeight,
            uint256 _quorumNumerator,
            uint256 _basisNumerator,
            address _vester
        ) = abi.decode(
            initializeParams,
            (address, IVotes, address, uint32, uint256, uint256, uint256, address)
        );
        super.setUp(abi.encode(_owner, _governanceToken, _azoriusModule, _votingPeriod, _requiredProposerWeight, _quorumNumerator, _basisNumerator));

        vester = TokenVester(_vester);
    }
       
    function getVotingWeight(address _voter, uint32 _proposalId) public view override returns (uint256) {
        return super.getVotingWeight(_voter, _proposalId) + vester.getBalance(address(governanceToken), _voter, proposalVotes[_proposalId].votingStartBlock);
    }
}
