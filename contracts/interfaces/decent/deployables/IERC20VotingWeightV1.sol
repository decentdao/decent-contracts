// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

/**
 * Interface of functions for retrieving voting weights
 */
interface IERC20VotingWeightV1 {
    /**
     * Calculates the voting weight an address if a proposal is made right now.
     *
     * @param _voter address of the voter
     * @return uint256 the address' voting weight
     */
    function getCurrentVotingWeight(
        address _voter
    ) external view returns (uint256);

    /**
     * Calculates the voting weight an address has for a specific Proposal.
     *
     * @param _voter address of the voter
     * @param _proposalId id of the Proposal
     * @return uint256 the address' voting weight
     */
    function getVotingWeight(
        address _voter,
        uint32 _proposalId
    ) external view returns (uint256);
}
