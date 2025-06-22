// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IFreezeVotingBase} from "../../interfaces/decent/deployables/IFreezeVotingBase.sol";
import {LightAccountValidator} from "../account-abstraction/LightAccountValidator.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

/**
 * @title FreezeVotingBase
 * @author Decent Labs
 * @notice Abstract base implementation for freeze voting mechanisms
 * @dev This abstract contract implements IFreezeVotingBase, providing core freeze
 * voting functionality that concrete implementations can extend.
 *
 * Implementation details:
 * - Uses EIP-7201 namespaced storage pattern for upgradeability safety
 * - Inherits LightAccountValidator for gasless voting support
 * - Abstract - requires concrete implementations for specific voting logic
 * - Tracks freeze proposals with automatic expiration
 * - Implements threshold-based freeze activation
 * - Auto-unfreezes after freeze period expires
 *
 * Freeze mechanics:
 * - Votes accumulate towards threshold within proposal period
 * - Freeze activates immediately when threshold reached
 * - Freeze automatically expires after freezePeriod
 * - Owner (parent DAO) can manually unfreeze anytime
 *
 * @custom:security-contact security@decentlabs.io
 */
abstract contract FreezeVotingBase is
    IFreezeVotingBase,
    LightAccountValidator,
    Ownable2StepUpgradeable
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /**
     * @notice Main storage struct for FreezeVotingBase following EIP-7201
     * @dev Contains all freeze voting state and configuration
     * @custom:storage-location erc7201:Decent.FreezeVotingBase.main
     */
    struct FreezeVotingBaseStorage {
        /** @notice Timestamp when current freeze proposal was created */
        uint48 freezeProposalCreated;
        /** @notice Accumulated votes for current freeze proposal */
        uint256 freezeProposalVoteCount;
        /** @notice Duration freeze proposals remain active */
        uint32 freezeProposalPeriod;
        /** @notice Duration a freeze remains active once triggered */
        uint32 freezePeriod;
        /** @notice Voting weight required to trigger a freeze */
        uint256 freezeVotesThreshold;
        /** @notice Timestamp when freeze was activated (0 if not frozen) */
        uint48 freezeActivated;
    }

    /**
     * @dev Storage slot for FreezeVotingBaseStorage calculated using EIP-7201 formula:
     * keccak256(abi.encode(uint256(keccak256("Decent.FreezeVotingBase.main")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 internal constant FREEZE_VOTING_BASE_STORAGE_LOCATION =
        0x5fcea62682ddc2ee9ccbce9f3a895c9dd644ee53c86fd38cf80a135b0e525500;

    /**
     * @dev Returns the storage struct for FreezeVotingBase
     * Following the EIP-7201 namespaced storage pattern to avoid storage collisions
     */
    function _getFreezeVotingBaseStorage()
        internal
        pure
        returns (FreezeVotingBaseStorage storage $)
    {
        assembly {
            $.slot := FREEZE_VOTING_BASE_STORAGE_LOCATION
        }
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Internal initializer for base freeze voting functionality
     * @dev Called by concrete implementations during initialization.
     * Sets up owner, light account support, and freeze parameters.
     * @param owner_ The owner address (typically parent DAO)
     * @param freezeProposalPeriod_ Duration freeze proposals remain active
     * @param freezePeriod_ Duration freezes remain active once triggered
     * @param freezeVotesThreshold_ Voting weight required to trigger freeze
     * @param lightAccountFactory_ Factory for gasless voting support
     */
    function __FreezeVotingBase_init(
        address owner_,
        uint32 freezeProposalPeriod_,
        uint32 freezePeriod_,
        uint256 freezeVotesThreshold_,
        address lightAccountFactory_
    ) internal onlyInitializing {
        // Initialize inherited contracts
        __Ownable_init(owner_);
        __LightAccountValidator_init(lightAccountFactory_);

        // Set freeze voting parameters
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();
        $.freezeVotesThreshold = freezeVotesThreshold_;
        $.freezeProposalPeriod = freezeProposalPeriod_;
        $.freezePeriod = freezePeriod_;
    }

    // ======================================================================
    // IFreezeVotingBase
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc IFreezeVotingBase
     */
    function freezeProposalCreated()
        public
        view
        virtual
        override
        returns (uint48)
    {
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();
        return $.freezeProposalCreated;
    }

    /**
     * @inheritdoc IFreezeVotingBase
     */
    function freezeProposalVoteCount()
        public
        view
        virtual
        override
        returns (uint256)
    {
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();
        return $.freezeProposalVoteCount;
    }

    /**
     * @inheritdoc IFreezeVotingBase
     */
    function freezeProposalPeriod()
        public
        view
        virtual
        override
        returns (uint32)
    {
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();
        return $.freezeProposalPeriod;
    }

    /**
     * @inheritdoc IFreezeVotingBase
     */
    function freezePeriod() public view virtual override returns (uint32) {
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();
        return $.freezePeriod;
    }

    /**
     * @inheritdoc IFreezeVotingBase
     */
    function freezeVotesThreshold()
        public
        view
        virtual
        override
        returns (uint256)
    {
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();
        return $.freezeVotesThreshold;
    }

    /**
     * @inheritdoc IFreezeVotingBase
     */
    function freezeActivated() public view virtual override returns (uint48) {
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();
        return $.freezeActivated;
    }

    /**
     * @inheritdoc IFreezeVotingBase
     * @dev Returns true only if:
     * 1. Vote count has reached threshold
     * 2. Current time is within the freeze period
     */
    function isFrozen() public view virtual override returns (bool) {
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();

        // Check both conditions for freeze to be active
        return
            $.freezeProposalVoteCount >= $.freezeVotesThreshold && // Threshold reached
            block.timestamp < $.freezeActivated + $.freezePeriod; // Within freeze period
    }

    // --- State-Changing Functions ---

    /**
     * @inheritdoc IFreezeVotingBase
     * @dev Resets all freeze-related state variables to allow new proposals
     */
    function unfreeze() public virtual override onlyOwner {
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();

        // Reset all freeze state
        $.freezeProposalCreated = 0; // Clear proposal timestamp
        $.freezeProposalVoteCount = 0; // Reset vote count
        $.freezeActivated = 0; // Clear freeze activation
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    /**
     * @notice Creates a new freeze proposal or resets an expired one
     * @dev Called internally when the first vote is cast on a new proposal.
     * Resets vote count and freeze activation status.
     */
    function _initializeFreezeVote() internal virtual {
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();

        // Start new freeze proposal
        $.freezeProposalCreated = uint48(block.timestamp); // Mark creation time
        $.freezeProposalVoteCount = 0; // Reset vote count
        $.freezeActivated = 0; // Clear any previous freeze
    }

    /**
     * @notice Records a freeze vote and activates freeze if threshold is reached
     * @dev Called by concrete implementations after validating the vote.
     * Automatically triggers freeze when threshold is reached.
     * @param voter_ The address casting the vote
     * @param weightCasted_ The voting weight to add
     * @custom:throws NoVotes if weight is zero
     */
    function _recordFreezeVote(
        address voter_,
        uint256 weightCasted_
    ) internal virtual {
        // Validate non-zero voting weight
        if (weightCasted_ == 0) revert NoVotes();

        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();

        // Add votes to the current proposal
        $.freezeProposalVoteCount += weightCasted_;

        // Check if threshold is reached and activate freeze immediately
        if ($.freezeProposalVoteCount >= $.freezeVotesThreshold) {
            $.freezeActivated = uint48(block.timestamp);
        }

        // Emit event for transparency
        emit FreezeVoteCast(voter_, weightCasted_);
    }
}
