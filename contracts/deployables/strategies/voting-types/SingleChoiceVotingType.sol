// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {
    IVotingType
} from "../../../interfaces/decent/deployables/IVotingTypes.sol";

/**
 * @title SingleChoiceVotingType
 * @notice Implements single-choice voting from multiple options
 * @dev This voting type allows voters to choose one option from a list of predefined choices
 */
contract SingleChoiceVotingType is IVotingType {
    /**
     * @notice Configuration for single choice voting
     * @param optionIds Array of option identifiers
     * @param allowAbstain Whether abstain votes are allowed
     * @param minWinnerThreshold Minimum votes needed for an option to win
     */
    struct SingleChoiceConfig {
        bytes32[] optionIds;
        bool allowAbstain;
        uint256 minWinnerThreshold;
    }

    /**
     * @notice Voting state for a proposal
     */
    struct SingleChoiceState {
        mapping(bytes32 => uint256) optionVotes;
        mapping(address => bool) hasVoted;
        mapping(address => bytes32) voterChoices;
        uint256 totalVotes;
        uint256 abstainVotes;
    }

    mapping(uint32 => SingleChoiceState) private proposalStates;
    mapping(uint32 => SingleChoiceConfig) private proposalConfigs;
    mapping(uint32 => address) private proposalStrategy;

    mapping(address => bool) public isAuthorizedStrategy;

    error OnlyStrategy();
    error UnauthorizedStrategy();
    error AlreadyInitialized();
    error InvalidOption();
    error NoVotingWeight();
    error AlreadyVoted();
    error NoOptions();
    error TooManyOptions();

    uint256 public constant MAX_OPTIONS = 100;

    modifier onlyStrategy(uint32 proposalId) {
        if (msg.sender != proposalStrategy[proposalId]) revert OnlyStrategy();
        _;
    }

    modifier onlyAuthorizedStrategy() {
        if (!isAuthorizedStrategy[msg.sender]) revert UnauthorizedStrategy();
        _;
    }

    /**
     * @notice Authorizes a strategy to use this voting type
     * @param strategy The strategy address to authorize
     */
    function authorizeStrategy(address strategy) external {
        isAuthorizedStrategy[strategy] = true;
    }

    /**
     * @inheritdoc IVotingType
     */
    function initializeProposal(
        uint32 proposalId,
        bytes calldata config
    ) external override onlyAuthorizedStrategy {
        if (proposalStrategy[proposalId] != address(0))
            revert AlreadyInitialized();
        proposalStrategy[proposalId] = msg.sender;

        SingleChoiceConfig memory votingConfig = abi.decode(
            config,
            (SingleChoiceConfig)
        );

        if (votingConfig.optionIds.length == 0) revert NoOptions();
        if (votingConfig.optionIds.length > MAX_OPTIONS)
            revert TooManyOptions();

        proposalConfigs[proposalId] = votingConfig;
    }

    /**
     * @inheritdoc IVotingType
     */
    function processVote(
        uint32 proposalId,
        address voter,
        uint256 votingWeight,
        bytes calldata voteData
    )
        external
        override
        onlyStrategy(proposalId)
        returns (bool isValid, uint256 totalWeight)
    {
        bytes32 choice = abi.decode(voteData, (bytes32));
        if (votingWeight == 0) revert NoVotingWeight();

        SingleChoiceState storage state = proposalStates[proposalId];
        SingleChoiceConfig storage config = proposalConfigs[proposalId];

        if (state.hasVoted[voter]) revert AlreadyVoted();

        // Check if it's an abstain vote
        if (choice == bytes32(0)) {
            if (!config.allowAbstain) revert InvalidOption();
            state.abstainVotes += votingWeight;
        } else {
            // Verify the choice is valid
            bool validChoice = false;
            for (uint256 i = 0; i < config.optionIds.length; i++) {
                if (config.optionIds[i] == choice) {
                    validChoice = true;
                    break;
                }
            }
            if (!validChoice) revert InvalidOption();

            state.optionVotes[choice] += votingWeight;
        }

        state.hasVoted[voter] = true;
        state.voterChoices[voter] = choice;
        state.totalVotes += votingWeight;

        return (true, votingWeight);
    }

    /**
     * @inheritdoc IVotingType
     */
    function finalizeResults(
        uint32 proposalId,
        uint256 quorumThreshold
    )
        external
        view
        override
        returns (
            bytes32[] memory winningOptions,
            bool passed,
            bytes memory metadata
        )
    {
        SingleChoiceState storage state = proposalStates[proposalId];
        SingleChoiceConfig storage config = proposalConfigs[proposalId];

        // Check if quorum is met
        if (state.totalVotes < quorumThreshold) {
            return (new bytes32[](0), false, abi.encode(state.totalVotes));
        }

        // Find the option with the most votes
        bytes32 topChoice;
        uint256 maxVotes = 0;

        for (uint256 i = 0; i < config.optionIds.length; i++) {
            bytes32 optionId = config.optionIds[i];
            uint256 votes = state.optionVotes[optionId];
            if (votes > maxVotes) {
                maxVotes = votes;
                topChoice = optionId;
            }
        }

        // Check if the winner meets the minimum threshold
        if (maxVotes >= config.minWinnerThreshold) {
            winningOptions = new bytes32[](1);
            winningOptions[0] = topChoice;
            passed = true;
        } else {
            winningOptions = new bytes32[](0);
            passed = false;
        }

        // Encode all option votes as metadata
        uint256[] memory allVotes = new uint256[](config.optionIds.length);
        for (uint256 i = 0; i < config.optionIds.length; i++) {
            allVotes[i] = state.optionVotes[config.optionIds[i]];
        }

        return (
            winningOptions,
            passed,
            abi.encode(state.totalVotes, state.abstainVotes, allVotes)
        );
    }

    /**
     * @inheritdoc IVotingType
     */
    function hasVoted(
        uint32 proposalId,
        address voter
    ) external view override returns (bool) {
        return proposalStates[proposalId].hasVoted[voter];
    }

    /**
     * @inheritdoc IVotingType
     */
    function getVoteState(
        uint32 proposalId
    ) external view override returns (bytes memory) {
        SingleChoiceState storage state = proposalStates[proposalId];
        SingleChoiceConfig storage config = proposalConfigs[proposalId];

        uint256[] memory votes = new uint256[](config.optionIds.length);
        for (uint256 i = 0; i < config.optionIds.length; i++) {
            votes[i] = state.optionVotes[config.optionIds[i]];
        }

        return abi.encode(state.totalVotes, state.abstainVotes, votes);
    }

    /**
     * @inheritdoc IVotingType
     */
    function getVotingTypeInfo()
        external
        pure
        override
        returns (
            string memory name,
            string memory version,
            string memory description
        )
    {
        return (
            "SingleChoiceVotingType",
            "1.0.0",
            "Single choice voting from multiple options with plurality winner"
        );
    }

    /**
     * @inheritdoc IVotingType
     */
    function supportsMultipleWinners() external pure override returns (bool) {
        return false;
    }
}
