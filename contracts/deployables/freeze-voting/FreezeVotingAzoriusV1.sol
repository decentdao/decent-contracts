// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IFreezeVotingAzoriusV1} from "../../interfaces/decent/deployables/IFreezeVotingAzoriusV1.sol";
import {IFreezeVotingBase} from "../../interfaces/decent/deployables/IFreezeVotingBase.sol";
import {IVotingAdapterBase} from "../../interfaces/decent/deployables/IVotingAdapterBase.sol";
import {IModuleAzoriusV1} from "../../interfaces/decent/deployables/IModuleAzoriusV1.sol";
import {IStrategyV1} from "../../interfaces/decent/deployables/IStrategyV1.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {ILightAccountValidator} from "../../interfaces/decent/deployables/ILightAccountValidator.sol";
import {IDeploymentBlock} from "../../interfaces/decent/IDeploymentBlock.sol";
import {FreezeVotingBase} from "./FreezeVotingBase.sol";
import {DeploymentBlock} from "../../DeploymentBlock.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/**
 * @title FreezeVotingAzoriusV1
 * @author Decent Labs
 * @notice Implementation of freeze voting for Azorius-based parent DAOs
 * @dev This contract implements IFreezeVotingAzoriusV1, enabling token holders
 * of an Azorius-based parent DAO to vote to freeze a child DAO.
 *
 * Implementation details:
 * - Uses EIP-7201 namespaced storage pattern for upgradeability safety
 * - Inherits base freeze voting logic from FreezeVotingBase
 * - Integrates with parent's Azorius module for strategy/adapter validation
 * - Automatically creates new freeze proposals when needed
 * - Supports multiple voting adapters in single transaction
 * - Light Account support for gasless voting
 *
 * Freeze proposal lifecycle:
 * - First voter automatically creates proposal if none active
 * - Captures parent's current strategy at proposal creation
 * - Aggregates votes from multiple voting adapters
 * - Freezes immediately when threshold reached
 * - Proposals expire after freezeProposalPeriod
 *
 * Security model:
 * - Only voting adapters from parent's strategy are allowed
 * - Parent DAO (owner) retains unfreeze capability
 * - Strategy locked at proposal creation prevents manipulation
 *
 * @custom:security-contact security@decentlabs.io
 */
contract FreezeVotingAzoriusV1 is
    IFreezeVotingAzoriusV1,
    IVersion,
    FreezeVotingBase,
    DeploymentBlock,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /**
     * @notice Main storage struct for FreezeVotingAzoriusV1 following EIP-7201
     * @dev Contains parent DAO reference and current freeze proposal strategy
     * @custom:storage-location erc7201:Decent.FreezeVotingAzorius.main
     */
    struct FreezeVotingAzoriusStorage {
        /** @notice The parent DAO's Azorius module for strategy validation */
        IModuleAzoriusV1 parentAzorius;
        /** @notice Strategy contract snapshot for current freeze proposal */
        address freezeProposalStrategy;
    }

    /**
     * @dev Storage slot for FreezeVotingAzoriusStorage calculated using EIP-7201 formula:
     * keccak256(abi.encode(uint256(keccak256("Decent.FreezeVotingAzorius.main")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 internal constant FREEZE_VOTING_AZORIUS_STORAGE_LOCATION =
        0x9d1b207d938f3e5b6e54413a914efe44171cda038c387334c00ec1729143ba00;

    /**
     * @dev Returns the storage struct for FreezeVotingAzoriusV1
     * Following the EIP-7201 namespaced storage pattern to avoid storage collisions
     */
    function _getFreezeVotingAzoriusStorage()
        internal
        pure
        returns (FreezeVotingAzoriusStorage storage $)
    {
        assembly {
            $.slot := FREEZE_VOTING_AZORIUS_STORAGE_LOCATION
        }
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    /**
     * @inheritdoc IFreezeVotingAzoriusV1
     * @dev Initializes base freeze voting functionality and sets parent Azorius reference.
     * The parent Azorius module is used to validate voting adapters.
     */
    function initialize(
        address owner_,
        uint256 freezeVotesThreshold_,
        uint32 freezeProposalPeriod_,
        uint32 freezePeriod_,
        address parentAzorius_,
        address lightAccountFactory_
    ) public virtual override initializer {
        __FreezeVotingBase_init(
            owner_,
            freezeProposalPeriod_,
            freezePeriod_,
            freezeVotesThreshold_,
            lightAccountFactory_
        );
        __DeploymentBlock_init();

        FreezeVotingAzoriusStorage storage $ = _getFreezeVotingAzoriusStorage();
        $.parentAzorius = IModuleAzoriusV1(parentAzorius_);
    }

    // ======================================================================
    // IFreezeVotingAzoriusV1
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc IFreezeVotingAzoriusV1
     */
    function parentAzorius() public view virtual override returns (address) {
        FreezeVotingAzoriusStorage storage $ = _getFreezeVotingAzoriusStorage();
        return address($.parentAzorius);
    }

    /**
     * @inheritdoc IFreezeVotingAzoriusV1
     */
    function freezeProposalStrategy()
        public
        view
        virtual
        override
        returns (address)
    {
        FreezeVotingAzoriusStorage storage $ = _getFreezeVotingAzoriusStorage();
        return $.freezeProposalStrategy;
    }

    // --- State-Changing Functions ---

    /**
     * @inheritdoc IFreezeVotingAzoriusV1
     * @dev Implements the freeze voting logic with automatic proposal creation:
     * 1. Resolves voter address (handles Light Account voting)
     * 2. Creates new proposal if none active or expired
     * 3. Captures parent's current strategy on proposal creation
     * 4. Aggregates votes from all specified adapters
     * 5. Records vote and potentially triggers freeze
     */
    function castFreezeVote(
        VotingAdapterVoteData[] calldata votingAdaptersToUse_,
        uint256 lightAccountIndex_
    ) public virtual override {
        // Step 1: Resolve the actual voter (handles Light Account case)
        address resolvedVoter = potentialLightAccountResolvedOwner(
            msg.sender,
            lightAccountIndex_
        );

        FreezeVotingBaseStorage storage $base = _getFreezeVotingBaseStorage();
        FreezeVotingAzoriusStorage storage $ = _getFreezeVotingAzoriusStorage();

        // Step 2: Check if we need to create a new freeze proposal
        // This happens when no proposal exists or current one expired
        if (
            block.timestamp >
            $base.freezeProposalCreated + $base.freezeProposalPeriod
        ) {
            // Initialize new freeze proposal state
            _initializeFreezeVote();

            // Capture parent's current strategy to prevent manipulation
            // This ensures all votes use the same strategy configuration
            $.freezeProposalStrategy = $.parentAzorius.strategy();

            // Emit event for transparency
            emit FreezeProposalCreated(resolvedVoter, $.freezeProposalStrategy);
        }

        // Step 3: Calculate total voting weight from all adapters
        // and record the vote (potentially triggering freeze)
        _recordFreezeVote(
            resolvedVoter,
            _getVotes(resolvedVoter, votingAdaptersToUse_)
        );
    }

    // ======================================================================
    // FreezeVotingBase
    // ======================================================================

    // --- State-Changing Functions ---

    /**
     * @inheritdoc IFreezeVotingBase
     * @dev Extends base unfreeze to also clear the freeze proposal strategy.
     * This ensures a fresh strategy snapshot for the next freeze proposal.
     */
    function unfreeze() public virtual override onlyOwner {
        FreezeVotingAzoriusStorage storage $ = _getFreezeVotingAzoriusStorage();

        // Clear the strategy snapshot to ensure fresh capture next time
        $.freezeProposalStrategy = address(0);

        // Call parent implementation to reset freeze state
        super.unfreeze();
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

    /**
     * @inheritdoc ERC165
     * @dev Supports IFreezeVotingAzoriusV1, IFreezeVotingBase, ILightAccountValidator, IVersion, IDeploymentBlock, and IERC165
     */
    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IFreezeVotingAzoriusV1).interfaceId ||
            interfaceId_ == type(IFreezeVotingBase).interfaceId ||
            interfaceId_ == type(ILightAccountValidator).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlock).interfaceId ||
            super.supportsInterface(interfaceId_);
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    /**
     * @notice Aggregates voting weight from multiple voting adapters
     * @dev Validates each adapter against the freeze proposal strategy before recording votes.
     * Uses the strategy snapshot to prevent manipulation during voting.
     * @param voter_ The resolved voter address
     * @param votingAdaptersToUse_ Array of voting adapters and their data
     * @return userVotes Total voting weight accumulated from all adapters
     * @custom:throws InvalidVotingAdapter if adapter not in freeze proposal strategy
     */
    function _getVotes(
        address voter_,
        VotingAdapterVoteData[] calldata votingAdaptersToUse_
    ) internal virtual returns (uint256) {
        uint256 userVotes = 0;

        FreezeVotingAzoriusStorage storage $ = _getFreezeVotingAzoriusStorage();

        // Process each voting adapter
        for (uint256 i = 0; i < votingAdaptersToUse_.length; ) {
            address adapterAddress = votingAdaptersToUse_[i].votingAdapter;

            // Validate adapter is part of the freeze proposal strategy
            // This prevents using adapters added after proposal creation
            if (
                !IStrategyV1($.freezeProposalStrategy).isVotingAdapter(
                    adapterAddress
                )
            ) {
                revert InvalidVotingAdapter();
            }

            FreezeVotingBaseStorage
                storage $base = _getFreezeVotingBaseStorage();

            // Record vote through the adapter and accumulate weight
            // Each adapter handles its own vote validation and weight calculation
            userVotes += IVotingAdapterBase(adapterAddress).recordFreezeVote(
                voter_,
                $base.freezeProposalCreated,
                votingAdaptersToUse_[i].adapterVoteData
            );

            unchecked {
                ++i;
            }
        }

        return userVotes;
    }
}
