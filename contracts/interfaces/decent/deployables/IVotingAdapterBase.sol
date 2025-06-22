// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

/**
 * @title IVotingAdapterBase
 * @notice Base interface for voting adapters that calculate voting weights in the Azorius governance system
 * @dev Voting adapters are responsible for determining voter eligibility and calculating voting weights
 * based on different criteria (token balances, NFT ownership, etc.). Each adapter implements its own
 * logic for what constitutes a valid vote and how much weight that vote carries.
 *
 * Key responsibilities:
 * - Calculate voting weight for a given voter and proposal
 * - Validate voting credentials (adapter-specific data)
 * - Record votes and prevent double voting (implementation-specific)
 * - Support freeze voting for emergency governance
 *
 * Integration with Strategy:
 * - Only the Strategy contract can call recordVote()
 * - Each adapter enforces its own rules about vote validity
 * - Implementations determine how to calculate weights (e.g., current state vs. historical snapshots)
 *
 * Freeze voting:
 * - Authorized freeze voters can record votes through recordFreezeVote()
 * - Separate from regular proposal voting, with its own weight calculation logic
 * - Enables emergency governance actions in parent-child DAO relationships
 */
interface IVotingAdapterBase {
    // --- Errors ---

    /** @notice Thrown when a function restricted to the strategy is called by another address */
    error NotStrategy();

    /** @notice Thrown when attempting to vote on a proposal that hasn't been initialized */
    error ProposalNotInitialized();

    /** @notice Thrown when an unauthorized address attempts to record a freeze vote */
    error UnauthorizedFreezeVoter(address caller);

    /** @notice Thrown when a freeze voter has zero voting weight */
    error NoFreezeVotingWeight();

    // --- Events ---

    /**
     * @notice Emitted when a vote is successfully recorded
     * @param voter The address whose vote was recorded
     * @param proposalId The proposal being voted on
     * @param weightCasted The voting weight that was applied
     * @param votingAdapterVoteData Adapter-specific data used for the vote
     */
    event VoteRecorded(
        address indexed voter,
        uint32 indexed proposalId,
        uint256 weightCasted,
        bytes votingAdapterVoteData
    );

    /**
     * @notice Emitted when a freeze vote is successfully recorded
     * @param voter The address whose freeze vote was recorded
     * @param freezeProposalSnapshotAndId Combined snapshot block and proposal ID for the freeze vote
     * @param weightCasted The voting weight that was applied
     * @param adapterVoteData Adapter-specific data used for the freeze vote
     */
    event FreezeVoteRecorded(
        address indexed voter,
        uint48 indexed freezeProposalSnapshotAndId,
        uint256 weightCasted,
        bytes adapterVoteData
    );

    // --- View Functions ---

    /**
     * @notice Returns the strategy contract address that this adapter is associated with
     * @return strategy The address of the Strategy contract
     */
    function strategy() external view returns (address strategy);

    /**
     * @notice Calculates the voting weight for a voter on a specific proposal
     * @dev Implementation varies by adapter type (ERC20 balance, NFT ownership, etc.).
     * How weights are calculated (current state vs. historical snapshots) is implementation-specific.
     * @param voter_ The address to calculate voting weight for
     * @param proposalId_ The proposal to calculate weight for
     * @param votingAdapterVoteData_ Adapter-specific data (e.g., NFT token ID)
     * @return weight The voting weight (0 if ineligible)
     */
    function weightOf(
        address voter_,
        uint32 proposalId_,
        bytes calldata votingAdapterVoteData_
    ) external view returns (uint256 weight);

    /**
     * @notice Validates vote eligibility and calculates weight without recording
     * @dev Useful for UI validation before submitting transactions.
     * Checks both vote validity and weight in a single call.
     * @param voter_ The address that would cast the vote
     * @param proposalId_ The proposal to validate for
     * @param votingAdapterVoteData_ Adapter-specific data
     * @return isValid True if the vote would be accepted by recordVote()
     * @return weight The voting weight that would be applied (0 if invalid)
     */
    function validVotingAdapterVote(
        address voter_,
        uint32 proposalId_,
        bytes calldata votingAdapterVoteData_
    ) external view returns (bool isValid, uint256 weight);

    // --- State-Changing Functions ---

    /**
     * @notice Records a vote and returns the weight applied
     * @dev Only callable by the strategy contract. Implementations should:
     * - Validate the vote according to adapter-specific rules
     * - Prevent double voting (if applicable to the adapter type)
     * - Calculate weight using adapter-specific logic
     * - Emit VoteRecorded event
     * @param voter_ The address casting the vote
     * @param proposalId_ The proposal being voted on
     * @param votingAdapterVoteData_ Adapter-specific data (e.g., NFT token ID for ERC721)
     * @return weightCasted The voting weight that was applied
     * @custom:access Restricted to strategy contract
     * @custom:throws ProposalNotInitialized if proposal doesn't exist
     * @custom:emits VoteRecorded with vote details
     */
    function recordVote(
        address voter_,
        uint32 proposalId_,
        bytes calldata votingAdapterVoteData_
    ) external returns (uint256 weightCasted);

    /**
     * @notice Records a freeze vote for emergency governance
     * @dev Only callable by authorized freeze voter contracts. Used in parent-child
     * DAO relationships for emergency interventions. How freeze vote weights are
     * calculated is implementation-specific.
     * @param voter_ The address casting the freeze vote
     * @param freezeProposalSnapshotAndId_ Combined snapshot block and freeze proposal ID
     * @param adapterVoteData_ Adapter-specific data
     * @return weightCasted The voting weight that was applied
     * @custom:access Restricted to authorized freeze voters
     * @custom:throws UnauthorizedFreezeVoter if caller not authorized
     * @custom:throws NoFreezeVotingWeight if voter has zero weight
     * @custom:emits FreezeVoteRecorded with freeze vote details
     */
    function recordFreezeVote(
        address voter_,
        uint48 freezeProposalSnapshotAndId_,
        bytes calldata adapterVoteData_
    ) external returns (uint256 weightCasted);
}
