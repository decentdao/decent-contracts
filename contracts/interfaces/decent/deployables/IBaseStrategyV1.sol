// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

/**
 * The specification for a voting strategy in Azorius.
 *
 * Each IBaseStrategy implementation need only implement the given functions here,
 * which allows for highly composable but simple or complex voting strategies.
 *
 * It should be noted that while many voting strategies make use of parameters such as
 * voting period or quorum, that is a detail of the individual strategy itself, and not
 * a requirement for the Azorius protocol.
 */
interface IBaseStrategyV1 {
    /**
     * Called by the [Azorius](../Azorius.md) module. This notifies this
     * [BaseStrategy](../BaseStrategy.md) that a new Proposal has been created.
     *
     * @param _data arbitrary data to pass to this BaseStrategy
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
     * this [BaseStrategy](../BaseStrategy.md).
     *
     * This allows a BaseStrategy to place any limits it would like on
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
}
