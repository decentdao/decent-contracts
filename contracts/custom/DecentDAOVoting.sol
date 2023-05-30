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

interface IVotesDecent is IVotes {
    /**
     * Returns the token balance that `account` had at a specific moment in the past.
     * This is distinct from `getPastVotes` in that it is the account's *balance*, not the number of
     * delegated token votes, which can be different.
     */
    function getPastBalance(address account, uint256 timepoint) external view returns (uint256);
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

    /**
     * The token vesting contract, which holds an account's "unvested" tokens, which will be added to
     * their voting weight, despite not being in their possession.
     */
    TokenVester public vester;

    /**
     * Determines whether to count token delegation for a newly created proposal, or to simply
     * use the voter's token balance for voting weight instead.
     */
    bool public allowDelegation;

    /**
     * A mapping of `proposalId` to the value of `allowDelegation` when the proposal was created.
     * This snapshots whether the proposal should allow delegation, or use a voting account's balance
     * instead for voting weight.
     */
    mapping(uint256 => bool) internal proposalToAllowDelegation;

    function setUp(bytes memory initializeParams) public override initializer {
        (
            address _owner,
            IVotesDecent _governanceToken,
            address _azoriusModule,
            uint32 _votingPeriod,
            uint256 _requiredProposerWeight,
            uint256 _quorumNumerator,
            uint256 _basisNumerator,
            address _vester,
            bool _allowDelegation
        ) = abi.decode(
            initializeParams,
            (address, IVotesDecent, address, uint32, uint256, uint256, uint256, address, bool)
        );
        super.setUp(abi.encode(_owner, _governanceToken, _azoriusModule, _votingPeriod, _requiredProposerWeight, _quorumNumerator, _basisNumerator));

        vester = TokenVester(_vester);
        allowDelegation = _allowDelegation;
    }

    /** @inheritdoc LinearERC20Voting*/
    function initializeProposal(bytes memory _data) public override onlyAzorius {
        super.initializeProposal(_data);
        uint32 proposalId = abi.decode(_data, (uint32));
        proposalToAllowDelegation[proposalId] = allowDelegation;
    }
       
    function getVotingWeight(address _voter, uint32 _proposalId) public view override returns (uint256) {
        address governanceAddress = address(governanceToken);
        uint256 voteStartBlock = proposalVotes[_proposalId].votingStartBlock;
        uint256 personalWeight = proposalToAllowDelegation[_proposalId] ? 
            super.getVotingWeight(_voter, _proposalId) : 
            IVotesDecent(governanceAddress).getPastBalance(_voter, voteStartBlock);
        uint256 vestingWeight = vester.getBalance(governanceAddress, _voter, voteStartBlock);
        return personalWeight + vestingWeight;
    }

    function toggleAllowDelegation() external onlyOwner {
        allowDelegation = !allowDelegation;
    }
}
