// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {ITokenAdapterV1} from "./ITokenAdapterV1.sol";

/**
 * The specification for a voting strategy in Azorius.
 *
 * Each IStrategyV1 implementation need only implement the given functions here,
 * which allows for highly composable but simple or complex voting strategies.
 *
 * It should be noted that while many voting strategies make use of parameters such as
 * voting period or quorum, that is a detail of the individual strategy itself, and not
 * a requirement for the Azorius protocol.
 */
interface IStrategyV1 {
    /**
     * Called by the [Azorius](../Azorius.md) module. This notifies this
     * [StrategyV1](../StrategyV1.md) that a new Proposal has been created.
     *
     * @param _data arbitrary data to pass to this StrategyV1
     */
    function initializeProposal(bytes memory _data) external;

    /**
     * Returns whether a Proposal has been passed.
     *
     * @param _proposalId proposalId to check
     * @return bool true if the proposal has passed, otherwise false
     */
    function isPassed(uint32 _proposalId) external view returns (bool);

    /**
     * Returns whether the specified address can submit a Proposal with
     * this [StrategyV1](../StrategyV1.md).
     *
     * This allows a StrategyV1 to place any limits it would like on
     * who can create new Proposals, such as requiring a minimum token
     * delegation.
     *
     * @param _address address to check
     * @return bool true if the address can submit a Proposal, otherwise false
     */
    function isProposer(address _address) external view returns (bool);

    /**
     * @notice Returns the start and end timestamps of a proposal's voting period.
     * @param _proposalId The ID of the proposal.
     * @return startTime The start timestamp of the voting period.
     * @return endTime The end timestamp of the voting period.
     */
    function getVotingTimestamps(
        uint32 _proposalId
    ) external view returns (uint48 startTime, uint48 endTime);

    /**
     * @notice Casts a vote on a proposal using specified token adapters and their respective data.
     * @param _proposalId The ID of the proposal to vote on.
     * @param _voteType The type of vote (e.g., 0 for NO, 1 for YES, 2 for ABSTAIN).
     * @param _adaptersToUse An array of token adapter contract addresses to use for this vote.
     * @param _adapterVoteData An array of adapter-specific data, corresponding to each adapter in _adaptersToUse.
     *                       For ERC721Adapter, this would be abi.encode(uint256[] tokenIds).
     *                       For ERC20Adapter, this could be empty bytes abi.encode().
     */
    function vote(
        uint32 _proposalId,
        uint8 _voteType,
        ITokenAdapterV1[] calldata _adaptersToUse,
        bytes[] calldata _adapterVoteData
    ) external;

    /**
     * @notice Gets the voting start block for a proposal.
     * @param _proposalId The ID of the proposal.
     * @return votingStartBlock The block number when voting started.
     */
    function getProposalBlocks(
        uint32 _proposalId
    ) external view returns (uint32 votingStartBlock);
}
