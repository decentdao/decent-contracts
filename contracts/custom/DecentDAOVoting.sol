// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity =0.8.19;

import { LinearERC20Voting } from "../azorius/LinearERC20Voting.sol";
import { VotesERC20Wrapper } from "../VotesERC20Wrapper.sol";

interface Escrow {
    function getBalance(address _address, uint _block) external;
}

contract DecentDAOVoting is LinearERC20Voting {

    Escrow public escrow;

    // TODO override setUp() function to initialize the escrow contract

    function getVotingWeight(address _voter, uint32 _proposalId) public view override returns (uint256) {
        return super.getVotingWeight(_voter, _proposalId) + escrow.getBalance(_voter, proposalVotes[_proposalId].votingStartBlock);
    }
}
