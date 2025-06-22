// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

/**
 * @title IFreezeVotingBase
 * @notice Base interface for freeze voting contracts that enable parent DAOs to freeze child DAOs
 * @dev Freeze voting is a critical emergency mechanism in parent-child DAO relationships.
 * It allows token holders of a parent DAO to vote to freeze a child DAO's operations,
 * preventing the child from executing any transactions while frozen.
 *
 * Key mechanics:
 * - Freeze proposals are separate from regular governance proposals
 * - Votes accumulate until the threshold is reached
 * - Once threshold is met, the child DAO is immediately frozen
 * - Freeze automatically expires after a set period
 * - Only the owner (parent DAO) can manually unfreeze
 *
 * Security features:
 * - Time-limited freeze proposals prevent stale votes
 * - Automatic expiration prevents permanent freezing
 * - Configurable threshold allows DAOs to set appropriate requirements
 * - Parent DAO retains ultimate control through ownership
 *
 * This base interface defines the common freeze voting functionality shared by
 * different implementations (Azorius-based and Multisig-based parent DAOs).
 */
interface IFreezeVotingBase {
    // --- Errors ---

    /** @notice Thrown when attempting to cast a freeze vote with zero voting weight */
    error NoVotes();

    // --- Events ---

    /**
     * @notice Emitted when a freeze vote is successfully cast
     * @param voter_ The address that cast the vote
     * @param votesCast_ The voting weight applied to the freeze proposal
     */
    event FreezeVoteCast(address indexed voter_, uint256 votesCast_);

    // --- View Functions ---

    /**
     * @notice Returns when the current freeze proposal was created
     * @dev Returns 0 if no freeze proposal exists or it expired
     * @return freezeProposalCreated Timestamp of the current freeze proposal creation
     */
    function freezeProposalCreated()
        external
        view
        returns (uint48 freezeProposalCreated);

    /**
     * @notice Returns the accumulated votes for the current freeze proposal
     * @dev Resets to 0 when a new freeze proposal is created
     * @return freezeProposalVoteCount Total voting weight cast for freezing
     */
    function freezeProposalVoteCount()
        external
        view
        returns (uint256 freezeProposalVoteCount);

    /**
     * @notice Returns the duration for which freeze proposals remain active
     * @dev After this period, a new freeze proposal must be created
     * @return freezeProposalPeriod Duration in seconds
     */
    function freezeProposalPeriod()
        external
        view
        returns (uint32 freezeProposalPeriod);

    /**
     * @notice Returns the duration for which a freeze remains active once triggered
     * @dev After this period, the DAO automatically unfreezes
     * @return freezePeriod Duration in seconds
     */
    function freezePeriod() external view returns (uint32 freezePeriod);

    /**
     * @notice Returns the voting weight threshold required to freeze the child DAO
     * @dev When vote count reaches this threshold, freeze is activated immediately
     * @return freezeVotesThreshold The required voting weight
     */
    function freezeVotesThreshold()
        external
        view
        returns (uint256 freezeVotesThreshold);

    /**
     * @notice Returns when the current freeze was activated
     * @dev Returns 0 if not currently frozen
     * @return freezeActivated Timestamp when the freeze was triggered
     */
    function freezeActivated() external view returns (uint48 freezeActivated);

    /**
     * @notice Checks if the child DAO is currently frozen
     * @dev Returns true if frozen and within the freeze period
     * @return isFrozen True if the DAO is currently frozen
     */
    function isFrozen() external view returns (bool isFrozen);

    // --- State-Changing Functions ---

    /**
     * @notice Allows the owner to manually unfreeze the child DAO
     * @dev Resets freeze state and proposal counts. Only the parent DAO can call this.
     * @custom:access Restricted to owner (parent DAO)
     */
    function unfreeze() external;
}
