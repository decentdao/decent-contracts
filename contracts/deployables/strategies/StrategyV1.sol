// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IStrategyV1} from "../../interfaces/decent/deployables/IStrategyV1.sol";
import {IVotingAdapterBase} from "../../interfaces/decent/deployables/IVotingAdapterBase.sol";
import {IProposerAdapterBaseV1} from "../../interfaces/decent/deployables/IProposerAdapterBaseV1.sol";
import {ILightAccountValidator} from "../../interfaces/decent/deployables/ILightAccountValidator.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlock} from "../../interfaces/decent/IDeploymentBlock.sol";
import {LightAccountValidator} from "../account-abstraction/LightAccountValidator.sol";
import {DeploymentBlock} from "../../DeploymentBlock.sol";
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
 * - Supports multiple voting and proposer adapters
 * - Implements two-phase initialization to resolve circular dependencies
 * - Tracks late vote attempts for informational purposes for gasless voting support
 * - Uses swap-and-pop pattern for array removals
 *
 * @custom:security-contact security@decentlabs.io
 */
contract StrategyV1 is
    IStrategyV1,
    IVersion,
    DeploymentBlock,
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
        mapping(uint32 proposalId => ProposalVotingDetails proposalVotingDetails) proposalVotingDetails;
        /** @notice Array of configured voting adapter addresses */
        address[] votingAdapters;
        /** @notice Array of configured proposer adapter addresses */
        address[] proposerAdapters;
        /** @notice Quick lookup for valid voting adapters */
        mapping(address votingAdapter => bool isVotingAdapter) isVotingAdapter;
        /** @notice Quick lookup for valid proposer adapters */
        mapping(address proposerAdapter => bool isProposerAdapter) isProposerAdapter;
        /** @notice Tracks authorized freeze voting contracts */
        mapping(address freezeVoterContract => bool isAuthorizedFreezeVoter) authorizedFreezeVotersMapping;
        /** @notice Array of authorized freeze voter addresses for enumeration */
        address[] authorizedFreezeVotersArray;
        /** @notice Tracks if someone tried to vote after voting period ended */
        mapping(uint32 proposalId => bool voteCastedAfterVotingPeriodEnded) voteCastedAfterVotingPeriodEnded;
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
     */
    function _getStrategyStorage()
        internal
        pure
        returns (StrategyStorage storage $)
    {
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
        __DeploymentBlock_init();

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
        address[] calldata votingAdapters_
    ) public virtual override reinitializer(2) {
        // Validate at least one voting adapter is provided
        if (votingAdapters_.length == 0) {
            revert NoVotingAdapters();
        }

        StrategyStorage storage $ = _getStrategyStorage();

        // Set the strategy admin (typically the Azorius module that will manage this strategy)
        $.strategyAdmin = strategyAdmin_;

        // Store the array of voting adapters
        $.votingAdapters = votingAdapters_;

        // Mark all provided adapters as valid voting adapters for quick lookup
        for (uint256 i = 0; i < votingAdapters_.length; ) {
            $.isVotingAdapter[votingAdapters_[i]] = true;
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
    ) public view virtual override returns (ProposalVotingDetails memory) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.proposalVotingDetails[proposalId];
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function votingAdapters()
        public
        view
        virtual
        override
        returns (address[] memory)
    {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.votingAdapters;
    }

    /**
     * @inheritdoc IStrategyV1
     */
    function isVotingAdapter(
        address votingAdapter_
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.isVotingAdapter[votingAdapter_];
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
     * @dev Calculates quorum based on YES + ABSTAIN votes. NO votes do not contribute to quorum.
     */
    function isQuorumMet(
        uint32 proposalId_
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        ProposalVotingDetails storage proposal = $.proposalVotingDetails[
            proposalId_
        ];

        if (proposal.votingEndTimestamp == 0) {
            revert ProposalNotInitialized();
        }

        uint256 totalVotesForQuorum = proposal.yesVotes + proposal.abstainVotes;
        return totalVotesForQuorum >= $.quorumThreshold;
    }

    /**
     * @inheritdoc IStrategyV1
     * @dev Uses integer multiplication to avoid division precision loss.
     * Formula: yesVotes * BASIS_DENOMINATOR > (yesVotes + noVotes) * basisNumerator
     */
    function isBasisMet(
        uint32 _proposalId
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        ProposalVotingDetails storage proposal = $.proposalVotingDetails[
            _proposalId
        ];

        if (proposal.votingEndTimestamp == 0) {
            revert ProposalNotInitialized();
        }

        return
            (proposal.yesVotes * BASIS_DENOMINATOR) >
            ((proposal.yesVotes + proposal.noVotes) * $.basisNumerator);
    }

    /**
     * @inheritdoc IStrategyV1
     * @dev A proposal must meet all three conditions to pass:
     * 1. Voting period has ended (current timestamp > votingEndTimestamp)
     * 2. Quorum is met (YES + ABSTAIN votes >= quorumThreshold)
     * 3. Basis is met (YES votes exceed required percentage of YES + NO votes)
     */
    function isPassed(
        uint32 _proposalId
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        ProposalVotingDetails storage proposal = $.proposalVotingDetails[
            _proposalId
        ];

        if (proposal.votingEndTimestamp == 0) {
            revert ProposalNotInitialized();
        }

        if (block.timestamp <= proposal.votingEndTimestamp) {
            return false;
        }

        return isQuorumMet(_proposalId) && isBasisMet(_proposalId);
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
        ProposalVotingDetails storage details = $.proposalVotingDetails[
            proposalId_
        ];
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
        ProposalVotingDetails storage details = $.proposalVotingDetails[
            proposalId_
        ];
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
     * @dev Performs comprehensive validation of a vote configuration:
     * - Checks if proposal exists and voting hasn't ended
     * - Validates vote type (must be 0, 1, or 2)
     * - Verifies all adapters are configured
     * - Ensures total voting weight > 0
     * - Checks for late vote attempts (informational tracking)
     */
    function validStrategyVote(
        address voter_,
        uint32 proposalId_,
        uint8 voteType_,
        VotingAdapterVoteData[] calldata votingAdaptersData_
    ) public view virtual override returns (bool) {
        // Early return if no voting adapters provided
        if (votingAdaptersData_.length == 0) {
            return false;
        }

        StrategyStorage storage $ = _getStrategyStorage();

        // Step 1: Verify proposal exists by checking for initialized voting details
        ProposalVotingDetails storage details = $.proposalVotingDetails[
            proposalId_
        ];

        // Proposal doesn't exist if voting end timestamp is zero
        if (details.votingEndTimestamp == 0) {
            return false;
        }

        // Step 2: Check if someone already tried voting after the period ended
        // This is tracked for informational purposes to support gasless voting
        if ($.voteCastedAfterVotingPeriodEnded[proposalId_]) {
            return false;
        }

        // Step 3: Validate vote type is within valid enum range
        // VoteType enum: NO=0, YES=1, ABSTAIN=2
        if (voteType_ > 2) {
            return false;
        }

        uint256 totalVotingWeight = 0;

        // Step 4: Iterate through each voting adapter to validate and sum voting weights
        for (uint256 i = 0; i < votingAdaptersData_.length; ) {
            VotingAdapterVoteData
                memory votingAdapterVoteData = votingAdaptersData_[i];
            address votingAdapter = votingAdapterVoteData.votingAdapter;

            // Verify the adapter is registered with this strategy
            if (!$.isVotingAdapter[votingAdapter]) {
                return false;
            }

            // Query the adapter to validate the vote and get voting weight
            // Note: validVotingAdapterVote should NEVER return (true, 0)
            (bool isValid, uint256 votingWeight) = IVotingAdapterBase(
                votingAdapter
            ).validVotingAdapterVote(
                    voter_,
                    proposalId_,
                    votingAdapterVoteData.adapterVoteData
                );

            if (!isValid) {
                return false;
            }

            // Accumulate voting weight from all adapters
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
     * Resets all vote counts to zero, allowing proposals to be re-initialized if needed.
     */
    function initializeProposal(
        uint32 proposalId_
    ) public virtual override onlyStrategyAdmin {
        StrategyStorage storage $ = _getStrategyStorage();
        ProposalVotingDetails storage proposal = $.proposalVotingDetails[
            proposalId_
        ];
        proposal.votingStartTimestamp = uint48(block.timestamp);
        proposal.votingEndTimestamp = uint48(block.timestamp + $.votingPeriod);
        proposal.votingStartBlock = uint32(block.number);
        proposal.yesVotes = 0;
        proposal.noVotes = 0;
        proposal.abstainVotes = 0;

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
     * - Aggregates weights from all adapters before updating vote tallies
     * - Each adapter enforces its own vote recording logic and constraints
     */
    function castVote(
        uint32 proposalId_,
        uint8 voteType_,
        VotingAdapterVoteData[] calldata votingAdaptersData,
        uint256 lightAccountIndex_
    ) public virtual override {
        // Validate at least one voting adapter is provided
        if (votingAdaptersData.length == 0) {
            revert NoVotingAdapters();
        }

        // Step 1: Resolve the actual voter address (support for Light Accounts/ERC-4337)
        // If lightAccountIndex_ > 0, this resolves to the Light Account owner
        address resolvedVoter = potentialLightAccountResolvedOwner(
            msg.sender,
            lightAccountIndex_
        );

        StrategyStorage storage $ = _getStrategyStorage();
        ProposalVotingDetails storage proposal = $.proposalVotingDetails[
            proposalId_
        ];

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

        // Step 4: Process votes through each adapter and accumulate voting weights
        uint256 totalWeightForThisVoteTransaction = 0;

        for (uint256 i = 0; i < votingAdaptersData.length; ) {
            VotingAdapterVoteData
                memory votingAdapterVoteData = votingAdaptersData[i];
            address votingAdapter = votingAdapterVoteData.votingAdapter;

            // Verify the adapter is registered with this strategy
            if (!$.isVotingAdapter[votingAdapter]) {
                revert InvalidVotingAdapter(votingAdapter);
            }

            // Record the vote with the adapter and get the voting weight
            // Each adapter enforces its own constraints (e.g., one vote per address for ERC20)
            uint256 votingWeight = IVotingAdapterBase(votingAdapter)
                .recordVote(
                    resolvedVoter,
                    proposalId_,
                    votingAdapterVoteData.adapterVoteData
                );

            // Ensure the adapter returned a valid voting weight
            if (votingWeight == 0) {
                revert NoVotingAdapterVotingWeight(votingAdapter);
            }

            totalWeightForThisVoteTransaction += votingWeight;

            unchecked {
                ++i;
            }
        }

        // Step 5: Update vote tallies based on vote type
        if (voteType_ == uint8(VoteType.YES)) {
            proposal.yesVotes += totalWeightForThisVoteTransaction;
        } else if (voteType_ == uint8(VoteType.NO)) {
            proposal.noVotes += totalWeightForThisVoteTransaction;
        } else if (voteType_ == uint8(VoteType.ABSTAIN)) {
            proposal.abstainVotes += totalWeightForThisVoteTransaction;
        } else {
            revert InvalidVoteType();
        }

        // Step 6: Emit voting event with aggregated weight
        emit Voted(
            resolvedVoter,
            proposalId_,
            VoteType(voteType_),
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
