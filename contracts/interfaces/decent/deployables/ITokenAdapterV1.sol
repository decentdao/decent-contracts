// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

/**
 * @title ITokenAdapter
 * @notice Interface for a Token Adapter that can be plugged into StrategyV1.
 * Each adapter is responsible for calculating voting weight for specific assets
 * and recording that those assets have been used in a vote for a proposal.
 */
interface ITokenAdapterV1 {
    /**
     * @notice Calculates the voting weight of a given voter for a specific proposal, using specific asset data.
     * @dev This function should check ownership and if the assets in _adapterVoteData have already been used for this proposal.
     * It returns the weight contribution of the specified, valid, and unused assets.
     * @param _voter The address of the voter.
     * @param _proposalId The ID of the proposal for which weight is being calculated.
     * @param _adapterVoteData Data specific to the adapter, e.g., for ERC721, this could be an array of token IDs.
     * @return weight The voting weight of the voter for the specified assets.
     */
    function weightOf(
        address _voter,
        uint32 _proposalId,
        bytes calldata _adapterVoteData
    ) external view returns (uint256 weight);

    /**
     * @notice Records a vote for specific assets, marking them as used for the proposal, and returns the weight cast.
     * @dev This function is called by StrategyV1 after overall vote conditions are met.
     * The adapter MUST ensure that the same underlying asset (e.g., a specific NFT ID) cannot be used to cast weight twice for the same proposal.
     * It should revert if assets in _adapterVoteData are invalid, not owned by _voter, or already used.
     * @param _voter The address of the voter casting the vote.
     * @param _proposalId The ID of the proposal.
     * @param _adapterVoteData Data specific to the adapter, identifying the assets to be voted with.
     * @return weightCasted The actual voting weight successfully recorded and cast by this adapter for this transaction.
     */
    function recordVote(
        address _voter,
        uint32 _proposalId,
        bytes calldata _adapterVoteData
    ) external returns (uint256 weightCasted);

    /**
     * @notice Checks if a given address is eligible to create proposals based on this adapter's criteria.
     * @param _proposer The address to check.
     * @return True if the address is eligible to propose, false otherwise.
     */
    function isProposer(address _proposer) external view returns (bool);
}
