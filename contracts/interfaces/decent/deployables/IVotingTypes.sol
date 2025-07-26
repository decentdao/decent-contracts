// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title IVotingTypes
 * @notice Core interfaces and types for the pluggable voting system
 * @dev This interface defines the standard for all voting type implementations
 */
interface IVotingTypes {
    /**
     * @notice Structure containing vote data from voting configs
     * @param configIndex Index of the voting configuration
     * @param voteData Data specific to the voting configuration
     */
    struct VotingConfigVoteData {
        uint256 configIndex;
        bytes voteData;
    }

    /**
     * @notice Configuration for a voting setup
     * @param votingWeight Address of the voting weight contract
     * @param voteTracker Address of the vote tracker contract
     */
    struct VotingConfig {
        address votingWeight;
        address voteTracker;
    }
}

/**
 * @title IVotingType
 * @notice Interface that all voting type implementations must follow
 * @dev Voting types are stateful contracts that manage their own proposal storage
 */
interface IVotingType {
    /**
     * @notice Initialize storage for a new proposal
     * @param proposalId The ID of the proposal being initialized
     * @param votingConfig Configuration data specific to this voting type
     */
    function initializeProposal(
        uint32 proposalId,
        bytes calldata votingConfig
    ) external;

    /**
     * @notice Process a vote for a proposal
     * @param proposalId The ID of the proposal being voted on
     * @param voter Address of the voter
     * @param votingWeight The voting weight of the voter
     * @param voteData The vote data (format depends on voting type)
     * @return isValid Whether the vote was valid
     * @return totalWeight The total weight used in this vote
     */
    function processVote(
        uint32 proposalId,
        address voter,
        uint256 votingWeight,
        bytes calldata voteData
    ) external returns (bool isValid, uint256 totalWeight);

    /**
     * @notice Determine final results after voting ends
     * @param proposalId The ID of the proposal
     * @param quorumThreshold Minimum participation required
     * @return winningOptions Array of winning option IDs
     * @return passed Whether the proposal passed
     * @return metadata Additional result data
     */
    function finalizeResults(
        uint32 proposalId,
        uint256 quorumThreshold
    )
        external
        view
        returns (
            bytes32[] memory winningOptions,
            bool passed,
            bytes memory metadata
        );

    /**
     * @notice Check if a voter has already voted on a proposal
     * @param proposalId The ID of the proposal
     * @param voter Address to check
     * @return Whether the voter has voted
     */
    function hasVoted(
        uint32 proposalId,
        address voter
    ) external view returns (bool);

    /**
     * @notice Get current vote state for a proposal
     * @param proposalId The ID of the proposal
     * @return Current state data (format depends on voting type)
     */
    function getVoteState(
        uint32 proposalId
    ) external view returns (bytes memory);

    /**
     * @notice Get information about this voting type
     * @return name Human-readable name
     * @return version Version string
     * @return description Description of the voting mechanism
     */
    function getVotingTypeInfo()
        external
        pure
        returns (
            string memory name,
            string memory version,
            string memory description
        );

    /**
     * @notice Check if this voting type supports multiple winners
     * @return Whether multiple winners are supported
     */
    function supportsMultipleWinners() external pure returns (bool);
}
