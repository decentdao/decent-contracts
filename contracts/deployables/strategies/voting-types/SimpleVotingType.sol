// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {
    IVotingType
} from "../../../interfaces/decent/deployables/IVotingTypes.sol";

/**
 * @title SimpleVotingType
 * @notice Implements traditional YES/NO/ABSTAIN voting
 * @dev This voting type maintains backward compatibility with the existing governance system
 * while implementing the new IVotingType interface
 */
contract SimpleVotingType is IVotingType {
    /**
     * @notice Configuration for simple voting
     * @param basisNumerator The numerator for basis calculation (denominator is 1,000,000)
     */
    struct SimpleVotingConfig {
        uint256 basisNumerator;
    }

    /**
     * @notice Voting data for a proposal
     * @param yesVotes Total weight of YES votes
     * @param noVotes Total weight of NO votes
     * @param abstainVotes Total weight of ABSTAIN votes
     * @param hasVoted Mapping of voter to whether they have voted
     * @param voterChoices Mapping of voter to their vote choice
     */
    struct SimpleVotingData {
        uint256 yesVotes;
        uint256 noVotes;
        uint256 abstainVotes;
        mapping(address => bool) hasVoted;
        mapping(address => uint8) voterChoices;
    }

    uint256 public constant BASIS_DENOMINATOR = 1_000_000;

    mapping(uint32 => SimpleVotingData) private proposalVotes;
    mapping(uint32 => SimpleVotingConfig) private proposalConfigs;
    mapping(uint32 => address) private proposalStrategy;

    mapping(address => bool) public isAuthorizedStrategy;

    error OnlyStrategy();
    error UnauthorizedStrategy();
    error AlreadyInitialized();
    error InvalidBasisNumerator();
    error InvalidVoteChoice();
    error NoVotingWeight();
    error AlreadyVoted();

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

        SimpleVotingConfig memory votingConfig = abi.decode(
            config,
            (SimpleVotingConfig)
        );
        if (
            votingConfig.basisNumerator < 500_000 ||
            votingConfig.basisNumerator >= 1_000_000
        ) {
            revert InvalidBasisNumerator();
        }
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
        uint8 choice = abi.decode(voteData, (uint8));
        if (choice > 2) revert InvalidVoteChoice();
        if (votingWeight == 0) revert NoVotingWeight();

        SimpleVotingData storage proposal = proposalVotes[proposalId];
        if (proposal.hasVoted[voter]) revert AlreadyVoted();

        proposal.hasVoted[voter] = true;
        proposal.voterChoices[voter] = choice;

        if (choice == 0) {
            proposal.noVotes += votingWeight;
        } else if (choice == 1) {
            proposal.yesVotes += votingWeight;
        } else {
            proposal.abstainVotes += votingWeight;
        }

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
        SimpleVotingData storage proposal = proposalVotes[proposalId];
        SimpleVotingConfig memory config = proposalConfigs[proposalId];

        uint256 quorumVotes = proposal.yesVotes + proposal.abstainVotes;
        bool quorumMet = quorumVotes >= quorumThreshold;

        uint256 totalDecisionVotes = proposal.yesVotes + proposal.noVotes;
        bool basisMet = totalDecisionVotes > 0 &&
            (proposal.yesVotes * BASIS_DENOMINATOR) >
            (totalDecisionVotes * config.basisNumerator);

        winningOptions = new bytes32[](0);
        if (quorumMet && basisMet) {
            winningOptions = new bytes32[](1);
            winningOptions[0] = bytes32(uint256(1));
        }

        return (
            winningOptions,
            quorumMet && basisMet,
            abi.encode(
                proposal.yesVotes,
                proposal.noVotes,
                proposal.abstainVotes
            )
        );
    }

    /**
     * @inheritdoc IVotingType
     */
    function hasVoted(
        uint32 proposalId,
        address voter
    ) external view override returns (bool) {
        return proposalVotes[proposalId].hasVoted[voter];
    }

    /**
     * @inheritdoc IVotingType
     */
    function getVoteState(
        uint32 proposalId
    ) external view override returns (bytes memory) {
        SimpleVotingData storage proposal = proposalVotes[proposalId];
        return
            abi.encode(
                proposal.yesVotes,
                proposal.noVotes,
                proposal.abstainVotes
            );
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
            "SimpleVotingType",
            "1.0.0",
            "Traditional YES/NO/ABSTAIN voting with quorum and basis requirements"
        );
    }

    /**
     * @inheritdoc IVotingType
     */
    function supportsMultipleWinners() external pure override returns (bool) {
        return false;
    }
}
