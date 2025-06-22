// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IFreezeVotingBase} from "../../interfaces/decent/deployables/IFreezeVotingBase.sol";
import {IFreezeVotingMultisigV1} from "../../interfaces/decent/deployables/IFreezeVotingMultisigV1.sol";
import {ILightAccountValidator} from "../../interfaces/decent/deployables/ILightAccountValidator.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlock} from "../../interfaces/decent/IDeploymentBlock.sol";
import {ISafe} from "../../interfaces/safe/ISafe.sol";
import {FreezeVotingBase} from "./FreezeVotingBase.sol";
import {DeploymentBlock} from "../../DeploymentBlock.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/**
 * @title FreezeVotingMultisigV1
 * @author Decent Labs
 * @notice Implementation of freeze voting for multisig-based parent DAOs
 * @dev This contract implements IFreezeVotingMultisigV1, enabling signers of a
 * multisig parent Safe to vote to freeze a child DAO.
 *
 * Implementation details:
 * - Uses EIP-7201 namespaced storage pattern for upgradeability safety
 * - Inherits base freeze voting logic from FreezeVotingBase
 * - Each Safe signer gets exactly one vote (not weighted)
 * - Tracks voting status per proposal to prevent double voting
 * - Automatically creates new freeze proposals when needed
 * - Light Account support for gasless voting
 *
 * Voting mechanics:
 * - Only current Safe signers can vote
 * - Each signer can vote once per proposal
 * - Vote weight is always 1 (equal voting power)
 * - Signer status checked at vote time
 * - Removed signers cannot vote on existing proposals
 *
 * Security model:
 * - Dynamic signer verification through parent Safe
 * - Parent Safe (owner) retains unfreeze capability
 * - Threshold prevents single signer from freezing
 *
 * @custom:security-contact security@decentlabs.io
 */
contract FreezeVotingMultisigV1 is
    IFreezeVotingMultisigV1,
    IVersion,
    FreezeVotingBase,
    DeploymentBlock,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /**
     * @notice Main storage struct for FreezeVotingMultisigV1 following EIP-7201
     * @dev Contains parent Safe reference and voting status tracking
     * @custom:storage-location erc7201:Decent.FreezeVotingMultisig.main
     */
    struct FreezeVotingMultisigStorage {
        /** @notice The parent multisig Safe for signer verification */
        ISafe parentSafe;
        /** @notice Tracks which accounts have voted on each proposal to prevent double voting */
        mapping(uint48 freezeProposalCreated => mapping(address voter => bool hasFreezeVoted)) accountHasFreezeVoted;
    }

    /**
     * @dev Storage slot for FreezeVotingMultisigStorage calculated using EIP-7201 formula:
     * keccak256(abi.encode(uint256(keccak256("Decent.FreezeVotingMultisig.main")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 internal constant FREEZE_VOTING_MULTISIG_STORAGE_LOCATION =
        0x03420cdda0f62079c98c6fb6a90eb9dcb80ca14f81a2a84283aa39b5ef26ab00;

    /**
     * @dev Returns the storage struct for FreezeVotingMultisigV1
     * Following the EIP-7201 namespaced storage pattern to avoid storage collisions
     */
    function _getFreezeVotingMultisigStorage()
        internal
        pure
        returns (FreezeVotingMultisigStorage storage $)
    {
        assembly {
            $.slot := FREEZE_VOTING_MULTISIG_STORAGE_LOCATION
        }
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    /**
     * @inheritdoc IFreezeVotingMultisigV1
     * @dev Initializes base freeze voting functionality and sets parent Safe reference.
     * The threshold should typically be set to a majority of Safe signers.
     */
    function initialize(
        address owner_,
        uint256 freezeVotesThreshold_,
        uint32 freezeProposalPeriod_,
        uint32 freezePeriod_,
        address parentSafe_,
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

        FreezeVotingMultisigStorage
            storage $ = _getFreezeVotingMultisigStorage();
        $.parentSafe = ISafe(parentSafe_);
    }

    // ======================================================================
    // IFreezeVotingMultisigV1
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc IFreezeVotingMultisigV1
     */
    function parentSafe() public view virtual override returns (address) {
        FreezeVotingMultisigStorage
            storage $ = _getFreezeVotingMultisigStorage();
        return address($.parentSafe);
    }

    /**
     * @inheritdoc IFreezeVotingMultisigV1
     */
    function accountHasFreezeVoted(
        uint48 freezeProposalCreated_,
        address account_
    ) public view virtual override returns (bool) {
        FreezeVotingMultisigStorage
            storage $ = _getFreezeVotingMultisigStorage();
        return $.accountHasFreezeVoted[freezeProposalCreated_][account_];
    }

    // --- State-Changing Functions ---

    /**
     * @inheritdoc IFreezeVotingMultisigV1
     * @dev Implements freeze voting for multisig signers:
     * 1. Resolves voter address (handles Light Account voting)
     * 2. Creates new proposal if none active or expired
     * 3. Verifies signer status and voting eligibility
     * 4. Records vote with weight of 1 if eligible
     * 5. Potentially triggers freeze if threshold reached
     */
    function castFreezeVote(
        uint256 lightAccountIndex_
    ) public virtual override {
        // Step 1: Resolve the actual voter (handles Light Account case)
        address resolvedVoter = potentialLightAccountResolvedOwner(
            msg.sender,
            lightAccountIndex_
        );

        FreezeVotingBaseStorage storage $base = _getFreezeVotingBaseStorage();

        // Step 2: Check if we need to create a new freeze proposal
        // This happens when no proposal exists or current one expired
        if (
            block.timestamp >
            $base.freezeProposalCreated + $base.freezeProposalPeriod
        ) {
            // Initialize new freeze proposal state
            _initializeFreezeVote();

            // Emit event for transparency
            emit FreezeProposalCreated(resolvedVoter);
        }

        // Step 3: Verify signer status and record vote
        // Vote weight is always 1 for multisig signers
        _recordFreezeVote(
            resolvedVoter,
            _getVotesAndUpdateHasVoted(resolvedVoter)
        );
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
     * @dev Supports IFreezeVotingMultisigV1, IFreezeVotingBase, ILightAccountValidator, IVersion, IDeploymentBlock, and IERC165
     */
    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IFreezeVotingMultisigV1).interfaceId ||
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
     * @notice Verifies signer status and records voting eligibility
     * @dev Performs three checks:
     * 1. Must be current signer of parent Safe
     * 2. Must not have already voted on this proposal
     * 3. Marks voter as having voted to prevent double voting
     * @param voter_ The resolved voter address
     * @return votes 1 if eligible to vote, 0 otherwise
     */
    function _getVotesAndUpdateHasVoted(
        address voter_
    ) internal virtual returns (uint256) {
        FreezeVotingMultisigStorage
            storage $ = _getFreezeVotingMultisigStorage();

        // Check 1: Verify voter is a current signer of the parent Safe
        // This ensures removed signers cannot vote
        if (!$.parentSafe.isOwner(voter_)) {
            return 0;
        }

        FreezeVotingBaseStorage storage $base = _getFreezeVotingBaseStorage();

        // Check 2: Ensure voter hasn't already voted on this proposal
        // Each signer can only vote once per proposal
        if ($.accountHasFreezeVoted[$base.freezeProposalCreated][voter_]) {
            return 0;
        }

        // Mark voter as having voted on this proposal
        // This prevents double voting
        $.accountHasFreezeVoted[$base.freezeProposalCreated][voter_] = true;

        // Return voting weight of 1 (all signers have equal weight)
        return 1;
    }
}
