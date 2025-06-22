// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IVotingAdapterERC20V1} from "../../../../interfaces/decent/deployables/IVotingAdapterERC20V1.sol";
import {IVotingAdapterBase} from "../../../../interfaces/decent/deployables/IVotingAdapterBase.sol";
import {IStrategyV1} from "../../../../interfaces/decent/deployables/IStrategyV1.sol";
import {ClockMode} from "../../../../interfaces/decent/ClockMode.sol";
import {IVersion} from "../../../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlock} from "../../../../interfaces/decent/IDeploymentBlock.sol";
import {VotingAdapterBase} from "./VotingAdapterBase.sol";
import {DeploymentBlock} from "../../../../DeploymentBlock.sol";
import {ClockModeLib} from "../../../../libs/ClockModeLib.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";

/**
 * @title VotingAdapterERC20V1
 * @author Decent Labs
 * @notice Implementation of voting adapter for ERC20 token-based voting
 * @dev This contract implements IVotingAdapterERC20V1, providing voting weight calculation
 * based on ERC20 token balances with snapshot support.
 *
 * Implementation details:
 * - Uses EIP-7201 namespaced storage pattern for upgradeability safety
 * - Non-upgradeable contract deployed per voting strategy
 * - Enforces one vote per address per proposal
 * - Supports both timestamp and block number clock modes
 * - Calculates weight based on historical token balance at proposal start
 * - Separate tracking for regular and freeze votes
 * - Weight calculation: token balance × weightPerToken
 *
 * @custom:security-contact security@decentlabs.io
 */
contract VotingAdapterERC20V1 is
    IVotingAdapterERC20V1,
    IVersion,
    VotingAdapterBase,
    DeploymentBlock,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /**
     * @notice Main storage struct for VotingAdapterERC20V1 following EIP-7201
     * @dev Contains token configuration and vote tracking mappings
     * @custom:storage-location erc7201:Decent.VotingAdapterERC20.main
     */
    struct VotingAdapterERC20Storage {
        /** @notice The IVotes token used for voting weight calculation */
        IVotes token;
        /** @notice Multiplier applied to token balances for weight calculation */
        uint256 weightPerToken;
        /** @notice Clock mode of the token (timestamp or block number based) */
        ClockMode tokenClockMode;
        /** @notice Tracks if an address has voted on a specific proposal */
        mapping(uint32 proposalId => mapping(address voter => bool hasCastedVote)) hasCastedVoteForProposal;
        /** @notice Tracks freeze votes per freeze contract, proposal, and voter */
        mapping(address freezeVoteContract => mapping(uint48 freezeProposalSnapshotAndId => mapping(address voter => bool hasCastedVote))) hasCastedVotePerFreezeVoteProposalPerFreezeVoteContract;
    }

    /**
     * @dev Storage slot for VotingAdapterERC20Storage calculated using EIP-7201 formula:
     * keccak256(abi.encode(uint256(keccak256("Decent.VotingAdapterERC20.main")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 internal constant VOTING_ADAPTER_ERC20_STORAGE_LOCATION =
        0xbc832af39495cff298aa9cd8cf90e3bb4881fa94888ebfa74bb336837d3bd800;

    /**
     * @dev Returns the storage struct for VotingAdapterERC20V1
     * Following the EIP-7201 namespaced storage pattern to avoid storage collisions
     */
    function _getVotingAdapterERC20Storage()
        internal
        pure
        returns (VotingAdapterERC20Storage storage $)
    {
        assembly {
            $.slot := VOTING_ADAPTER_ERC20_STORAGE_LOCATION
        }
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    /**
     * @inheritdoc IVotingAdapterERC20V1
     * @dev Detects and stores the token's clock mode during initialization.
     * The weightPerToken allows for scaling voting power (e.g., 1e18 for 1:1).
     */
    function initialize(
        address token_,
        address strategy_,
        uint256 weightPerToken_
    ) public virtual override initializer {
        __VotingAdapterBase_init(strategy_);
        __DeploymentBlock_init();

        VotingAdapterERC20Storage storage $ = _getVotingAdapterERC20Storage();
        $.token = IVotes(token_);
        $.weightPerToken = weightPerToken_;
        $.tokenClockMode = ClockModeLib.getClockMode(token_);
    }

    // ======================================================================
    // IVotingAdapterERC20V1
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc IVotingAdapterERC20V1
     */
    function token() public view virtual override returns (address) {
        VotingAdapterERC20Storage storage $ = _getVotingAdapterERC20Storage();
        return address($.token);
    }

    /**
     * @inheritdoc IVotingAdapterERC20V1
     */
    function weightPerToken() public view virtual override returns (uint256) {
        VotingAdapterERC20Storage storage $ = _getVotingAdapterERC20Storage();
        return $.weightPerToken;
    }

    /**
     * @inheritdoc IVotingAdapterERC20V1
     * @dev Delegates to _calculateWeightAtSnapshot for weight calculation
     */
    function getFreezeVoteWeight(
        address voter_,
        uint48 freezeProposalSnapshotAndId_
    ) public view virtual override returns (uint256) {
        return _calculateWeightAtSnapshot(voter_, freezeProposalSnapshotAndId_);
    }

    /**
     * @inheritdoc IVotingAdapterERC20V1
     */
    function hasCastedVoteForProposal(
        uint32 proposalId_,
        address voter_
    ) public view virtual override returns (bool) {
        VotingAdapterERC20Storage storage $ = _getVotingAdapterERC20Storage();
        return $.hasCastedVoteForProposal[proposalId_][voter_];
    }

    /**
     * @inheritdoc IVotingAdapterERC20V1
     */
    function hasCastedVotePerFreezeVoteProposalPerFreezeVoteContract(
        address freezeVoteContract_,
        uint48 freezeProposalSnapshotAndId_,
        address voter_
    ) public view virtual override returns (bool) {
        VotingAdapterERC20Storage storage $ = _getVotingAdapterERC20Storage();

        return
            $.hasCastedVotePerFreezeVoteProposalPerFreezeVoteContract[
                freezeVoteContract_
            ][freezeProposalSnapshotAndId_][voter_];
    }

    // ======================================================================
    // IVotingAdapterBase
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc IVotingAdapterBase
     * @dev Returns 0 if the voter has already voted, otherwise calculates weight at proposal start
     */
    function weightOf(
        address voter_,
        uint32 proposalId_,
        bytes calldata voteData_
    ) public view virtual override returns (uint256) {
        VotingAdapterERC20Storage storage $ = _getVotingAdapterERC20Storage();

        if ($.hasCastedVoteForProposal[proposalId_][voter_]) {
            return 0;
        }
        return _getVoteWeightDetails(voter_, proposalId_, voteData_);
    }

    /**
     * @inheritdoc IVotingAdapterBase
     * @dev Validates vote eligibility by checking:
     * 1. Voter hasn't already voted on this proposal
     * 2. Proposal exists and is initialized
     * 3. Voter has checkpoints (voting history)
     * 4. Voter had token balance at proposal start
     * 5. The checkpoint isn't after the proposal end (optimization)
     *
     * Uses backward iteration through checkpoints for efficiency with recent proposals.
     */
    function validVotingAdapterVote(
        address voter_,
        uint32 proposalId_,
        bytes calldata
    ) public view virtual override returns (bool, uint256) {
        VotingAdapterERC20Storage storage $ = _getVotingAdapterERC20Storage();

        // Step 1: Check if the user has already voted
        if ($.hasCastedVoteForProposal[proposalId_][voter_]) {
            return (false, 0);
        }

        // Step 2: Get governance token and checkpoint count
        ERC20Votes governanceToken = ERC20Votes(address($.token));
        uint32 numCheckpoints = governanceToken.numCheckpoints(voter_);

        // Step 3: Get proposal details from strategy
        VotingAdapterBaseStorage storage $base = _getVotingAdapterBaseStorage();
        IStrategyV1.ProposalVotingDetails memory details = $base
            .strategy
            .proposalVotingDetails(proposalId_);

        // Check if proposal exists
        if (details.votingEndTimestamp == 0) {
            return (false, 0); // Proposal not initialized
        }

        // Step 4: Check if voter has any checkpoints
        if (numCheckpoints == 0) {
            return (false, 0);
        }

        // Step 5: Find the checkpoint at or before proposal start timestamp
        // Iterate backwards through checkpoints (more efficient for recent proposals)
        uint256 votingWeight = 0;
        for (uint256 i = numCheckpoints; i > 0; ) {
            // Get checkpoint (indices are 0-based, loop counter is 1-based)
            Checkpoints.Checkpoint208 memory checkpoint = governanceToken
                .checkpoints(voter_, uint32(i - 1));

            // Optimization: If checkpoint is after proposal end, vote would be invalid
            if (checkpoint._key > details.votingEndTimestamp) {
                return (false, 0);
            }

            // Found the checkpoint at or before proposal start
            if (checkpoint._key <= details.votingStartTimestamp) {
                votingWeight = checkpoint._value;
                break;
            }

            unchecked {
                --i;
            }
        }
        // If no checkpoint found <= startTimestamp, voter had 0 balance

        // Step 6: Apply weight multiplier
        votingWeight = votingWeight * $.weightPerToken;

        // Step 7: Validate final weight
        if (votingWeight == 0) {
            return (false, 0);
        }

        return (true, votingWeight);
    }

    // --- State-Changing Functions ---

    /**
     * @inheritdoc IVotingAdapterBase
     * @dev Tracks freeze votes separately per freeze voting contract to support multiple child DAOs
     */
    function recordFreezeVote(
        address voter_,
        uint48 freezeProposalSnapshotAndId_,
        bytes calldata
    ) public virtual override onlyAuthorizedFreezeVoter returns (uint256) {
        VotingAdapterERC20Storage storage $ = _getVotingAdapterERC20Storage();

        // Check if this voter has already voted on this freeze proposal from this freeze contract
        if (
            $.hasCastedVotePerFreezeVoteProposalPerFreezeVoteContract[
                msg.sender
            ][freezeProposalSnapshotAndId_][voter_]
        ) {
            revert AlreadyVoted();
        }

        // Calculate voting weight at the freeze proposal snapshot
        uint256 weightCasted = _calculateWeightAtSnapshot(
            voter_,
            freezeProposalSnapshotAndId_
        );

        if (weightCasted == 0) {
            revert NoFreezeVotingWeight();
        }

        // Mark this voter as having voted on this freeze proposal from this freeze contract
        $.hasCastedVotePerFreezeVoteProposalPerFreezeVoteContract[msg.sender][
            freezeProposalSnapshotAndId_
        ][voter_] = true;

        emit FreezeVoteRecorded(
            voter_,
            freezeProposalSnapshotAndId_,
            weightCasted,
            bytes("")
        );

        return weightCasted;
    }

    /**
     * @inheritdoc IVotingAdapterBase
     * @dev Enforces one vote per address per proposal. Marks voter as having voted before calculating weight.
     * Note: Weight is calculated from delegated voting power (via getPastVotes), not token balance.
     * Users must delegate to themselves or receive delegation to have voting weight.
     */
    function recordVote(
        address voter_,
        uint32 proposalId_,
        bytes calldata voteData_
    ) public virtual override onlyStrategy returns (uint256) {
        VotingAdapterERC20Storage storage $ = _getVotingAdapterERC20Storage();

        // Prevent double voting
        if ($.hasCastedVoteForProposal[proposalId_][voter_]) {
            revert AlreadyVoted();
        }

        // Mark as voted before calculating weight (checks-effects pattern)
        $.hasCastedVoteForProposal[proposalId_][voter_] = true;

        // Calculate weight based on voting power at proposal start
        uint256 weightCasted = _getVoteWeightDetails(
            voter_,
            proposalId_,
            voteData_
        );

        emit VoteRecorded(voter_, proposalId_, weightCasted, bytes(""));

        return weightCasted;
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
     * @dev Supports IVotingAdapterERC20V1, IVotingAdapterBase, IVersion, IDeploymentBlock, and IERC165
     */
    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IVotingAdapterERC20V1).interfaceId ||
            interfaceId_ == type(IVotingAdapterBase).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlock).interfaceId ||
            super.supportsInterface(interfaceId_);
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    /**
     * @notice Calculates voting weight at a specific snapshot timepoint
     * @dev Uses token's getPastVotes to get historical voting power (not balance) and applies weightPerToken multiplier.
     * Voting power comes from delegation, not token ownership.
     * @param voter_ The address to calculate weight for
     * @param snapshotTimepoint_ The timestamp or block number to query
     * @return The calculated voting weight
     */
    function _calculateWeightAtSnapshot(
        address voter_,
        uint48 snapshotTimepoint_
    ) internal view virtual returns (uint256) {
        VotingAdapterERC20Storage storage $ = _getVotingAdapterERC20Storage();

        return
            $.token.getPastVotes(voter_, snapshotTimepoint_) * $.weightPerToken;
    }

    /**
     * @notice Gets voting weight for a proposal based on the token's clock mode
     * @dev Determines whether to use timestamp or block number based on token configuration
     * @param voter_ The address to calculate weight for
     * @param proposalId_ The proposal to get weight for
     * @return The voting weight at the proposal's start timepoint
     * @custom:throws ProposalNotInitialized if proposal doesn't exist
     */
    function _getVoteWeightDetails(
        address voter_,
        uint32 proposalId_,
        bytes calldata
    ) internal view virtual returns (uint256) {
        uint48 startTimepoint;

        VotingAdapterERC20Storage storage $ = _getVotingAdapterERC20Storage();
        VotingAdapterBaseStorage storage $base = _getVotingAdapterBaseStorage();

        // Get the appropriate timepoint based on token's clock mode
        if ($.tokenClockMode == ClockMode.Timestamp) {
            (startTimepoint, ) = $base.strategy.getVotingTimestamps(
                proposalId_
            );
        } else {
            startTimepoint = $base.strategy.getVotingStartBlock(proposalId_);
        }

        if (startTimepoint == 0) revert ProposalNotInitialized();
        return _calculateWeightAtSnapshot(voter_, startTimepoint);
    }
}
