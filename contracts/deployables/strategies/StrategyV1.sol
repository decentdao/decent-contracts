// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IStrategyV1} from "../../interfaces/decent/deployables/IStrategyV1.sol";
import {
    IVotingTypes,
    IVotingType
} from "../../interfaces/decent/deployables/IVotingTypes.sol";
import {
    IVotingWeightV1
} from "../../interfaces/decent/deployables/IVotingWeightV1.sol";
import {
    IVoteTrackerV1
} from "../../interfaces/decent/deployables/IVoteTrackerV1.sol";
import {
    IProposerAdapterBaseV1
} from "../../interfaces/decent/deployables/IProposerAdapterBaseV1.sol";
import {
    ILightAccountValidator
} from "../../interfaces/decent/deployables/ILightAccountValidator.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlock} from "../../interfaces/decent/IDeploymentBlock.sol";
import {
    LightAccountValidator
} from "../account-abstraction/LightAccountValidator.sol";
import {
    DeploymentBlockInitializable
} from "../../DeploymentBlockInitializable.sol";
import {InitializerEventEmitter} from "../../InitializerEventEmitter.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/**
 * @title StrategyV1
 * @author Decent Labs
 * @notice Implementation of the core voting strategy for Azorius governance
 * @dev This contract implements IStrategyV1, providing the voting logic and rules
 * for proposals created through ModuleAzoriusV1.
 *
 * Implementation details:
 * - Uses EIP-7201 namespaced storage pattern for future upgradeability
 * - Non-upgradeable contract deployed per DAO
 * - Integrates Light Account support for gasless voting
 * - Supports multiple voting configurations and proposer adapters
 * - Implements two-phase initialization to resolve circular dependencies
 * - Tracks late vote attempts for informational purposes for gasless voting support
 * - Uses swap-and-pop pattern for array removals
 *
 * @custom:security-contact security@decentlabs.io
 */
contract StrategyV1 is
    IStrategyV1,
    IVersion,
    DeploymentBlockInitializable,
    InitializerEventEmitter,
    LightAccountValidator,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /**
     * @notice Main storage struct for StrategyV1 following EIP-7201
     * @dev Contains all voting configuration and proposal state
     * @custom:storage-location erc7201:Decent.Strategy.main
     */
    struct StrategyStorage {
        /** @notice Address that can initialize proposals and manage freeze voters (typically Azorius) */
        address strategyAdmin;
        /** @notice Fixed duration in seconds for all proposal voting periods */
        uint32 votingPeriod;
        /** @notice Minimum total weight (YES + ABSTAIN) required for quorum */
        uint256 quorumThreshold;
        /** @notice Numerator for basis calculation (denominator is 1,000,000) */
        uint256 basisNumerator;
        /** @notice Mapping from proposal ID to voting details and tallies */
        mapping(uint32 proposalId => IStrategyV1.ProposalVotingDetails proposalVotingDetails) proposalVotingDetails;
        /** @notice Array of configured voting configurations */
        IVotingTypes.VotingConfig[] votingConfigs;
        /** @notice Array of configured proposer adapter addresses */
        address[] proposerAdapters;
        /** @notice Quick lookup for valid proposer adapters */
        mapping(address proposerAdapter => bool isProposerAdapter) isProposerAdapter;
        /** @notice Tracks authorized freeze voting contracts */
        mapping(address freezeVoterContract => bool isAuthorizedFreezeVoter) authorizedFreezeVotersMapping;
        /** @notice Array of authorized freeze voter addresses for enumeration */
        address[] authorizedFreezeVotersArray;
        /** @notice Tracks if someone tried to vote after voting period ended */
        mapping(uint32 proposalId => bool voteCastedAfterVotingPeriodEnded) voteCastedAfterVotingPeriodEnded;
        /** @notice Array of authorized voting type contracts */
        address[] authorizedVotingTypes;
        /** @notice Quick lookup for valid voting types */
        mapping(address votingType => bool isAuthorized) isAuthorizedVotingType;
        /** @notice Voting type used for each proposal */
        mapping(uint32 proposalId => address votingType) proposalVotingType;
    }

    /**
     * @dev Storage slot for StrategyStorage calculated using EIP-7201 formula:
     * keccak256(abi.encode(uint256(keccak256("Decent.Strategy.main")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 internal constant STRATEGY_STORAGE_LOCATION =
        0x95295deadfd7c71125b4fbd75b5d49605029b50806f286522633fd9c072a4700;

    /**
     * @dev Returns the storage struct for StrategyV1
     * Following the EIP-7201 namespaced storage pattern to avoid storage collisions
     * @return $ The storage struct for StrategyV1
     */
    function _getStrategyStorage()
        internal
        pure
        returns (StrategyStorage storage $)
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            $.slot := STRATEGY_STORAGE_LOCATION
        }
    }

    /**
     * @notice Denominator for basis percentage calculations (represents 100%)
     * @dev Used with basisNumerator to calculate required approval percentage
     */
    uint256 public constant BASIS_DENOMINATOR = 1_000_000;

    // ======================================================================
    // MODIFIERS
    // ======================================================================

    /**
     * @notice Restricts function access to the strategy admin
     * @dev The strategy admin is typically the Azorius module that manages this strategy
     * @custom:throws InvalidStrategyAdmin if msg.sender is not the strategy admin
     */
    modifier onlyStrategyAdmin() {
        StrategyStorage storage $ = _getStrategyStorage();
        if (msg.sender != $.strategyAdmin) revert InvalidStrategyAdmin();
        _;
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function initialize(
        uint32 votingPeriod_,
        uint256 quorumThreshold_,
        uint256 basisNumerator_,
        address[] calldata proposerAdapters_,
        address lightAccountFactory_
    ) public virtual override initializer {
        // Validate at least one proposer adapter is provided
        if (proposerAdapters_.length == 0) {
            revert NoProposerAdapters();
        }

        // Validate basis numerator is within acceptable range
        // Must be at least 50% (500,000) and less than 100% (1,000,000)
        if (
            basisNumerator_ >= BASIS_DENOMINATOR ||
            basisNumerator_ < BASIS_DENOMINATOR / 2
        ) revert InvalidBasisNumerator();

        // Initialize parent contracts
        __LightAccountValidator_init(lightAccountFactory_);
        __DeploymentBlockInitializable_init();
        __InitializerEventEmitter_init(
            abi.encode(
                votingPeriod_,
                quorumThreshold_,
                basisNumerator_,
                proposerAdapters_,
                lightAccountFactory_
            )
        );

        // Store voting configuration
        StrategyStorage storage $ = _getStrategyStorage();
        $.votingPeriod = votingPeriod_;
        $.quorumThreshold = quorumThreshold_;
        $.basisNumerator = basisNumerator_;
        $.proposerAdapters = proposerAdapters_;

        // Mark all provided adapters as valid proposer adapters
        for (uint256 i = 0; i < proposerAdapters_.length; ) {
            $.isProposerAdapter[proposerAdapters_[i]] = true;
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function initialize2(
        address strategyAdmin_,
        IVotingTypes.VotingConfig[] calldata votingConfigs_
    ) public virtual override reinitializer(2) {
        // Validate at least one voting config is provided
        if (votingConfigs_.length == 0) {
            revert NoVotingConfigs();
        }

        StrategyStorage storage $ = _getStrategyStorage();

        // Set the strategy admin (typically the Azorius module that will manage this strategy)
        $.strategyAdmin = strategyAdmin_;

        // Store the array of voting configurations
        for (uint256 i = 0; i < votingConfigs_.length; ) {
            $.votingConfigs.push(votingConfigs_[i]);
            unchecked {
                ++i;
            }
        }
    }

    // ======================================================================
    // IStrategyV1
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc IStrategyV1
     */
    function strategyAdmin() public view virtual override returns (address) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.strategyAdmin;
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function votingPeriod() public view virtual override returns (uint32) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.votingPeriod;
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function quorumThreshold() public view virtual override returns (uint256) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.quorumThreshold;
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function basisNumerator() public view virtual override returns (uint256) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.basisNumerator;
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function proposalVotingDetails(
        uint32 proposalId
    )
        public
        view
        virtual
        override
        returns (IStrategyV1.ProposalVotingDetails memory)
    {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.proposalVotingDetails[proposalId];
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function votingConfigs()
        public
        view
        virtual
        override
        returns (IVotingTypes.VotingConfig[] memory)
    {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.votingConfigs;
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function votingConfig(
        uint256 configIndex_
    ) public view virtual override returns (IVotingTypes.VotingConfig memory) {
        StrategyStorage storage $ = _getStrategyStorage();
        if (configIndex_ >= $.votingConfigs.length) {
            revert InvalidVotingConfig(configIndex_);
        }
        return $.votingConfigs[configIndex_];
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function isProposerAdapter(
        address proposerAdapter_
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.isProposerAdapter[proposerAdapter_];
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function proposerAdapters()
        public
        view
        virtual
        override
        returns (address[] memory)
    {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.proposerAdapters;
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function voteCastedAfterVotingPeriodEnded(
        uint32 proposalId_
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.voteCastedAfterVotingPeriodEnded[proposalId_];
    }

    /**
     * @inheritdoc IStrategyV1
     * @dev Delegates quorum calculation to the voting type contract
     */
    function isQuorumMet(
        uint32 proposalId_
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        IStrategyV1.ProposalVotingDetails storage proposal = $
            .proposalVotingDetails[proposalId_];

        if (proposal.votingEndTimestamp == 0) {
            revert ProposalNotInitialized();
        }

        IVotingType votingType = IVotingType(proposal.votingType);
        (, bool passed, ) = votingType.finalizeResults(
            proposalId_,
            $.quorumThreshold
        );
        return passed;
    }

    /**
     * @inheritdoc IStrategyV1
     * @dev Delegates basis calculation to the voting type contract
     */
    function isBasisMet(
        uint32 _proposalId
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        IStrategyV1.ProposalVotingDetails storage proposal = $
            .proposalVotingDetails[_proposalId];

        if (proposal.votingEndTimestamp == 0) {
            revert ProposalNotInitialized();
        }

        IVotingType votingType = IVotingType(proposal.votingType);
        (, bool passed, ) = votingType.finalizeResults(
            _proposalId,
            $.quorumThreshold
        );
        return passed;
    }

    /**
     * @inheritdoc IStrategyV1
     * @dev A proposal passes if voting has ended and the voting type determines it passed
     */
    function isPassed(
        uint32 _proposalId
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        IStrategyV1.ProposalVotingDetails storage proposal = $
            .proposalVotingDetails[_proposalId];

        if (proposal.votingEndTimestamp == 0) {
            revert ProposalNotInitialized();
        }

        if (block.timestamp <= proposal.votingEndTimestamp) {
            return false;
        }

        IVotingType votingType = IVotingType(proposal.votingType);
        (, bool passed, ) = votingType.finalizeResults(
            _proposalId,
            $.quorumThreshold
        );
        return passed;
    }

    /**
     * @inheritdoc IStrategyV1
     * @dev Delegates the eligibility check to the specified proposer adapter
     */
    function isProposer(
        address address_,
        address proposerAdapter_,
        bytes calldata proposerAdapterData_
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        if (!$.isProposerAdapter[proposerAdapter_]) {
            revert InvalidProposerAdapter();
        }

        return
            IProposerAdapterBaseV1(proposerAdapter_).isProposer(
                address_,
                proposerAdapterData_
            );
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function getVotingTimestamps(
        uint32 proposalId_
    ) public view virtual override returns (uint48, uint48) {
        StrategyStorage storage $ = _getStrategyStorage();
        IStrategyV1.ProposalVotingDetails storage details = $
            .proposalVotingDetails[proposalId_];
        if (details.votingEndTimestamp == 0) revert ProposalNotInitialized();
        return (details.votingStartTimestamp, details.votingEndTimestamp);
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function getVotingStartBlock(
        uint32 proposalId_
    ) public view virtual override returns (uint32) {
        StrategyStorage storage $ = _getStrategyStorage();
        IStrategyV1.ProposalVotingDetails storage details = $
            .proposalVotingDetails[proposalId_];
        if (details.votingEndTimestamp == 0) revert ProposalNotInitialized();
        return details.votingStartBlock;
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function isAuthorizedFreezeVoter(
        address freezeVoterContract_
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.authorizedFreezeVotersMapping[freezeVoterContract_];
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function authorizedFreezeVoters()
        public
        view
        virtual
        override
        returns (address[] memory)
    {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.authorizedFreezeVotersArray;
    }

    /**
     * @inheritdoc IStrategyV1
     * @dev Validates whether a vote configuration is eligible for gas sponsorship through ERC-4337 paymaster.
     * This function is specifically designed for the gasless voting flow where:
     * 1. User signs a vote operation off-chain
     * 2. ERC-4337 bundler submits it through a Light Account
     * 3. DecentPaymasterV1 calls its validator
     * 4. Validator calls this function to determine if the vote should be sponsored
     *
     * IMPORTANT: This function uses getVotingWeightForPaymaster() instead of calculateWeight()
     * to avoid ERC-4337 banned opcodes (block.timestamp, block.number) during validation phase.
     *
     * Validation checks:
     * - Proposal exists and is still active
     * - All voting configs are valid
     * - Voter has voting weight > 0
     * - Voter hasn't already voted with these configs
     */
    function validStrategyVote(
        address voter_,
        uint32 proposalId_,
        IVotingTypes.VotingConfigVoteData[] calldata votingConfigsData_
    ) public view virtual override returns (bool) {
        // Early return if no voting configs provided
        if (votingConfigsData_.length == 0) {
            return false;
        }

        StrategyStorage storage $ = _getStrategyStorage();

        // Step 1: Verify proposal exists by checking for initialized voting details
        IStrategyV1.ProposalVotingDetails storage details = $
            .proposalVotingDetails[proposalId_];

        // Proposal doesn't exist if voting end timestamp is zero
        if (details.votingEndTimestamp == 0) {
            return false;
        }

        // Step 2: Check if someone already tried voting after the period ended
        // This is tracked for informational purposes to support gasless voting
        if ($.voteCastedAfterVotingPeriodEnded[proposalId_]) {
            return false;
        }

        // Step 3: Check if voting type is set
        if (details.votingType == address(0)) {
            return false;
        }

        uint256 totalVotingWeight = 0;

        // Step 4: Iterate through each voting config to validate and sum voting weights
        for (uint256 i = 0; i < votingConfigsData_.length; ) {
            IVotingTypes.VotingConfigVoteData
                memory configData = votingConfigsData_[i];

            // Verify the config index is valid
            if (configData.configIndex >= $.votingConfigs.length) {
                return false;
            }

            IVotingTypes.VotingConfig memory config = $.votingConfigs[
                configData.configIndex
            ];

            // Calculate voting weight using paymaster-safe method
            // This avoids banned opcodes during ERC-4337 validation phase
            uint256 votingWeight = IVotingWeightV1(config.votingWeight)
                .getVotingWeightForPaymaster(
                    voter_,
                    details.votingStartTimestamp,
                    configData.voteData
                );

            if (votingWeight == 0) {
                return false;
            }

            // Check if already voted with this config
            if (
                IVoteTrackerV1(config.voteTracker).hasVoted(
                    proposalId_,
                    voter_,
                    configData.voteData
                )
            ) {
                return false;
            }

            // Accumulate voting weight from all configs
            totalVotingWeight += votingWeight;

            unchecked {
                ++i;
            }
        }

        // Step 5: Ensure the voter has at least some voting power
        return totalVotingWeight > 0;
    }

    // --- State-Changing Functions ---

    /**
     * @inheritdoc IStrategyV1
     * @dev Sets voting timestamps based on current block time and configured voting period.
     * Initializes the voting type contract for this proposal.
     */
    function initializeProposal(
        uint32 proposalId_,
        address votingType_,
        bytes calldata votingConfig_
    ) public virtual override onlyStrategyAdmin {
        StrategyStorage storage $ = _getStrategyStorage();
        IStrategyV1.ProposalVotingDetails storage proposal = $
            .proposalVotingDetails[proposalId_];
        proposal.votingStartTimestamp = uint48(block.timestamp);
        proposal.votingEndTimestamp = uint48(block.timestamp + $.votingPeriod);
        proposal.votingStartBlock = uint32(block.number);
        proposal.votingType = votingType_;

        // Validate and set voting type
        if (!$.isAuthorizedVotingType[votingType_]) {
            revert UnauthorizedVotingType();
        }
        $.proposalVotingType[proposalId_] = votingType_;

        // Initialize proposal in the voting type contract
        IVotingType(votingType_).initializeProposal(proposalId_, votingConfig_);

        emit ProposalInitialized(
            proposalId_,
            proposal.votingStartTimestamp,
            proposal.votingEndTimestamp,
            proposal.votingStartBlock
        );
    }

    /**
     * @inheritdoc IStrategyV1
     * @dev Implementation notes:
     * - Resolves Light Account ownership for gasless voting support
     * - Tracks late vote attempts for the first occurrence per proposal
     * - Aggregates weights from all voting configs before updating vote tallies
     * - Each voting config enforces its own vote recording logic and constraints
     */
    function castVote(
        uint32 proposalId_,
        bytes calldata voteData_,
        IVotingTypes.VotingConfigVoteData[] calldata votingConfigsData_,
        uint256 lightAccountIndex_
    ) public virtual override {
        // Validate at least one voting config is provided
        if (votingConfigsData_.length == 0) {
            revert NoVotingConfigs();
        }

        // Step 1: Resolve the actual voter address (support for Light Accounts/ERC-4337)
        // If lightAccountIndex_ > 0, this resolves to the Light Account owner
        address resolvedVoter = potentialLightAccountResolvedOwner(
            msg.sender,
            lightAccountIndex_
        );

        StrategyStorage storage $ = _getStrategyStorage();
        IStrategyV1.ProposalVotingDetails storage proposal = $
            .proposalVotingDetails[proposalId_];

        // Step 2: Verify the proposal has been initialized
        if (proposal.votingEndTimestamp == 0) {
            revert ProposalNotInitialized();
        }

        // Step 3: Check if voting period has ended
        if (block.timestamp > proposal.votingEndTimestamp) {
            // Track the first late vote attempt for informational purposes
            // This helps with gasless voting infrastructure
            if (!$.voteCastedAfterVotingPeriodEnded[proposalId_]) {
                $.voteCastedAfterVotingPeriodEnded[proposalId_] = true;
                emit VotingPeriodEnded(proposalId_);
                return; // Exit gracefully on first late attempt
            }
            revert ProposalNotActive();
        }

        // Step 4: Process votes through each config and accumulate voting weights
        uint256 totalWeightForThisVoteTransaction = _processVotingConfigs(
            $,
            proposalId_,
            resolvedVoter,
            proposal.votingStartTimestamp,
            votingConfigsData_
        );

        // Step 5: Process vote through voting type
        IVotingType votingType = IVotingType(proposal.votingType);
        (bool isValid, ) = votingType.processVote(
            proposalId_,
            resolvedVoter,
            totalWeightForThisVoteTransaction,
            voteData_
        );

        if (!isValid) {
            revert InvalidVote();
        }

        // Step 6: Emit voting event with aggregated weight
        emit VoteCast(
            resolvedVoter,
            proposalId_,
            address(votingType),
            voteData_,
            totalWeightForThisVoteTransaction
        );
    }

    /**
     * @inheritdoc IStrategyV1
     * @dev Maintains both a mapping for O(1) lookups and an array for enumeration.
     * Prevents duplicates in the array while allowing re-authorization.
     */
    function addAuthorizedFreezeVoter(
        address freezeVoterContract_
    ) public virtual override onlyStrategyAdmin {
        if (freezeVoterContract_ == address(0)) revert InvalidAddress();

        StrategyStorage storage $ = _getStrategyStorage();

        if (!$.authorizedFreezeVotersMapping[freezeVoterContract_]) {
            $.authorizedFreezeVotersArray.push(freezeVoterContract_);
        }
        $.authorizedFreezeVotersMapping[freezeVoterContract_] = true;

        emit FreezeVoterAuthorizationChanged(freezeVoterContract_, true);
    }

    /**
     * @inheritdoc IStrategyV1
     * @dev Uses swap-and-pop pattern for gas-efficient array removal.
     * Sets mapping to false regardless of whether the address was previously authorized.
     */
    function removeAuthorizedFreezeVoter(
        address freezeVoterContract_
    ) public virtual override onlyStrategyAdmin {
        if (freezeVoterContract_ == address(0)) revert InvalidAddress();

        StrategyStorage storage $ = _getStrategyStorage();

        if ($.authorizedFreezeVotersMapping[freezeVoterContract_]) {
            for (uint256 i = 0; i < $.authorizedFreezeVotersArray.length; ) {
                if ($.authorizedFreezeVotersArray[i] == freezeVoterContract_) {
                    $.authorizedFreezeVotersArray[i] = $
                        .authorizedFreezeVotersArray[
                            $.authorizedFreezeVotersArray.length - 1
                        ];
                    $.authorizedFreezeVotersArray.pop();
                    break;
                }
                unchecked {
                    ++i;
                }
            }
        }

        $.authorizedFreezeVotersMapping[freezeVoterContract_] = false;

        emit FreezeVoterAuthorizationChanged(freezeVoterContract_, false);
    }

    /**
     * @dev Internal function to process voting configs and calculate total weight
     * @param $ Storage pointer
     * @param proposalId_ The proposal ID
     * @param resolvedVoter The resolved voter address
     * @param votingStartTimestamp The voting start timestamp
     * @param votingConfigsData_ The voting configs data
     * @return totalWeight The total voting weight accumulated
     */
    function _processVotingConfigs(
        StrategyStorage storage $,
        uint32 proposalId_,
        address resolvedVoter,
        uint48 votingStartTimestamp,
        IVotingTypes.VotingConfigVoteData[] calldata votingConfigsData_
    ) internal returns (uint256 totalWeight) {
        for (uint256 i = 0; i < votingConfigsData_.length; ) {
            IVotingTypes.VotingConfigVoteData
                memory configData = votingConfigsData_[i];

            // Verify the config index is valid
            if (configData.configIndex >= $.votingConfigs.length) {
                revert InvalidVotingConfig(configData.configIndex);
            }

            IVotingTypes.VotingConfig memory config = $.votingConfigs[
                configData.configIndex
            ];

            // Calculate voting weight and get processed data
            (
                uint256 votingWeight,
                bytes memory processedData
            ) = IVotingWeightV1(config.votingWeight).calculateWeight(
                    resolvedVoter,
                    votingStartTimestamp,
                    configData.voteData
                );

            // Ensure valid voting weight
            if (votingWeight == 0) {
                revert NoVotingWeight(configData.configIndex);
            }

            // Record the vote to prevent double voting
            IVoteTrackerV1(config.voteTracker).recordVote(
                proposalId_,
                resolvedVoter,
                processedData
            );

            totalWeight += votingWeight;

            unchecked {
                ++i;
            }
        }
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function addAuthorizedVotingType(
        address votingType_
    ) public virtual override onlyStrategyAdmin {
        if (votingType_ == address(0)) revert InvalidAddress();

        StrategyStorage storage $ = _getStrategyStorage();

        if (!$.isAuthorizedVotingType[votingType_]) {
            $.authorizedVotingTypes.push(votingType_);
        }
        $.isAuthorizedVotingType[votingType_] = true;

        emit VotingTypeAuthorizationChanged(votingType_, true);
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function removeAuthorizedVotingType(
        address votingType_
    ) public virtual override onlyStrategyAdmin {
        if (votingType_ == address(0)) revert InvalidAddress();

        StrategyStorage storage $ = _getStrategyStorage();

        if ($.isAuthorizedVotingType[votingType_]) {
            for (uint256 i = 0; i < $.authorizedVotingTypes.length; ) {
                if ($.authorizedVotingTypes[i] == votingType_) {
                    $.authorizedVotingTypes[i] = $.authorizedVotingTypes[
                        $.authorizedVotingTypes.length - 1
                    ];
                    $.authorizedVotingTypes.pop();
                    break;
                }
                unchecked {
                    ++i;
                }
            }
        }
        $.isAuthorizedVotingType[votingType_] = false;

        emit VotingTypeAuthorizationChanged(votingType_, false);
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function isAuthorizedVotingType(
        address votingType_
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.isAuthorizedVotingType[votingType_];
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function authorizedVotingTypes()
        public
        view
        virtual
        override
        returns (address[] memory)
    {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.authorizedVotingTypes;
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function proposalVotingType(
        uint32 proposalId_
    ) public view virtual override returns (address) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.proposalVotingType[proposalId_];
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function getWinningOptions(
        uint32 proposalId_
    ) public view virtual override returns (bytes32[] memory) {
        StrategyStorage storage $ = _getStrategyStorage();
        IStrategyV1.ProposalVotingDetails storage proposal = $
            .proposalVotingDetails[proposalId_];

        IVotingType votingType = IVotingType(proposal.votingType);
        (bytes32[] memory winningOptions, , ) = votingType.finalizeResults(
            proposalId_,
            $.quorumThreshold
        );

        return winningOptions;
    }

    // ======================================================================
    // IVersion
    // ======================================================================

    // --- Pure Functions ---

    /**
     * @inheritdoc IVersion
     */
    function version() public pure virtual override returns (uint16) {
        return 1;
    }

    // ======================================================================
    // ERC165
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc ERC165
     * @dev Supports IStrategyV1, ILightAccountValidator, IVersion, IDeploymentBlock, and IERC165
     */
    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IStrategyV1).interfaceId ||
            interfaceId_ == type(ILightAccountValidator).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlock).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
