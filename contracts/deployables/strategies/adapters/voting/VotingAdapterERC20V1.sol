// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IVotingAdapterERC20V1} from "../../../../interfaces/decent/deployables/IVotingAdapterERC20V1.sol";
import {IVotingAdapterBaseV1} from "../../../../interfaces/decent/deployables/IVotingAdapterBaseV1.sol";
import {IStrategyV1} from "../../../../interfaces/decent/deployables/IStrategyV1.sol";
import {ClockMode} from "../../../../interfaces/decent/ClockMode.sol";
import {IVersion} from "../../../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlockV1} from "../../../../interfaces/decent/IDeploymentBlockV1.sol";
import {VotingAdapterBaseV1} from "./VotingAdapterBaseV1.sol";
import {DeploymentBlockV1} from "../../../../DeploymentBlockV1.sol";
import {ClockModeLib} from "../../../../libs/ClockModeLib.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";

contract VotingAdapterERC20V1 is
    IVotingAdapterERC20V1,
    IVersion,
    VotingAdapterBaseV1,
    DeploymentBlockV1,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    IVotes internal _token;
    uint256 internal _weightPerToken;
    ClockMode internal _tokenClockMode;
    mapping(uint32 proposalId => mapping(address voter => bool hasCastedVote))
        internal _hasCastedVoteForProposal;
    mapping(address freezeVoteContract => mapping(uint48 freezeProposalSnapshotAndId => mapping(address voter => bool hasCastedVote)))
        internal _hasCastedVotePerFreezeVoteProposalPerFreezeVoteContract;

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address token_,
        address strategy_,
        uint256 weightPerToken_
    ) public virtual override initializer {
        __VotingAdapterBaseV1_init(strategy_);
        __DeploymentBlockV1_init();
        _token = IVotes(token_);
        _weightPerToken = weightPerToken_;
        _tokenClockMode = ClockModeLib.getClockMode(token_);
    }

    // ======================================================================
    // IVotingAdapterERC20V1
    // ======================================================================

    // --- View Functions ---

    function token() public view virtual override returns (address) {
        return address(_token);
    }

    function weightPerToken() public view virtual override returns (uint256) {
        return _weightPerToken;
    }

    function getFreezeVoteWeight(
        address voter_,
        uint48 freezeProposalSnapshotAndId_
    ) public view virtual override returns (uint256) {
        return _calculateWeightAtSnapshot(voter_, freezeProposalSnapshotAndId_);
    }

    function hasCastedVoteForProposal(
        uint32 proposalId_,
        address voter_
    ) public view virtual override returns (bool) {
        return _hasCastedVoteForProposal[proposalId_][voter_];
    }

    function hasCastedVotePerFreezeVoteProposalPerFreezeVoteContract(
        address freezeVoteContract_,
        uint48 freezeProposalSnapshotAndId_,
        address voter_
    ) public view virtual override returns (bool) {
        return
            _hasCastedVotePerFreezeVoteProposalPerFreezeVoteContract[
                freezeVoteContract_
            ][freezeProposalSnapshotAndId_][voter_];
    }

    // ======================================================================
    // IVotingAdapterBaseV1
    // ======================================================================

    // --- View Functions ---

    function weightOf(
        address voter_,
        uint32 proposalId_,
        bytes calldata voteData_
    ) public view virtual override returns (uint256) {
        if (_hasCastedVoteForProposal[proposalId_][voter_]) {
            return 0;
        }
        return _getVoteWeightDetails(voter_, proposalId_, voteData_);
    }

    function validVotingAdapterVote(
        address voter_,
        uint32 proposalId_,
        bytes calldata
    ) public view virtual override returns (bool, uint256) {
        // check if the user has voted
        if (_hasCastedVoteForProposal[proposalId_][voter_]) {
            return (false, 0);
        }

        // get the governance token
        ERC20Votes governanceToken = ERC20Votes(address(_token));

        // get the number of checkpoints for the voter
        uint32 numCheckpoints = governanceToken.numCheckpoints(voter_);

        IStrategyV1.ProposalVotingDetails memory details = _strategy
            .proposalVotingDetails(proposalId_);

        if (details.votingEndTimestamp == 0) {
            return (false, 0); // Proposal not initialized
        }
        uint48 startTimestamp = details.votingStartTimestamp;
        uint48 endTimestamp = details.votingEndTimestamp;

        // if there are no checkpoints, user has no voting weight
        if (numCheckpoints == 0) {
            return (false, 0);
        }

        // Iterate backwards through checkpoints to find the relevant one for startTimestamp.
        // This is potentially more efficient than binary search if startTimestamp is recent.
        uint256 votingWeight = 0;
        for (uint256 i = numCheckpoints; i > 0; ) {
            // Checkpoint indices are 0-based, loop index 'j' is 1-based count.
            Checkpoints.Checkpoint208 memory checkpoint = governanceToken
                .checkpoints(voter_, uint32(i - 1));

            // If this checkpoint's timestamp is after the proposal's endTimestamp,
            // it implies the current timestamp is also after endTimestamp.
            // Thus, the voting period has definitively ended, and any vote is invalid.
            if (checkpoint._key > endTimestamp) {
                return (false, 0); // Vote is invalid as the proposal has ended.
            }

            // If the checkpoint timestamp is less than or equal to the proposal start timestamp,
            // we've found the relevant voting weight.
            if (checkpoint._key <= startTimestamp) {
                votingWeight = checkpoint._value;
                break; // Exit loop once the correct checkpoint is found
            }

            unchecked {
                --i;
            }
        }
        // If the loop completes without finding a checkpoint where fromTimestamp <= startTimestamp,
        // (and the optimization above didn't trigger and return false),
        // it means all checkpoints are after startTimestamp, so the weight at startTimestamp was 0.
        // votingWeight remains 0 in this case.

        // multiply votingWeight by _weightPerToken
        votingWeight = votingWeight * _weightPerToken;

        // Check if the user had any voting weight at the proposal start timestamp
        if (votingWeight == 0) {
            return (false, 0);
        }

        return (true, votingWeight);
    }

    // --- State-Changing Functions ---

    function recordFreezeVote(
        address voter_,
        uint48 freezeProposalSnapshotAndId_,
        bytes calldata
    ) public virtual override onlyAuthorizedFreezeVoter returns (uint256) {
        if (
            _hasCastedVotePerFreezeVoteProposalPerFreezeVoteContract[
                msg.sender
            ][freezeProposalSnapshotAndId_][voter_]
        ) {
            revert AlreadyVoted();
        }

        uint256 weightCasted = _calculateWeightAtSnapshot(
            voter_,
            freezeProposalSnapshotAndId_
        );

        if (weightCasted == 0) {
            revert NoFreezeVotingWeight();
        }

        _hasCastedVotePerFreezeVoteProposalPerFreezeVoteContract[msg.sender][
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

    function recordVote(
        address voter_,
        uint32 proposalId_,
        bytes calldata voteData_
    ) public virtual override onlyStrategy returns (uint256) {
        if (_hasCastedVoteForProposal[proposalId_][voter_]) {
            revert AlreadyVoted();
        }
        _hasCastedVoteForProposal[proposalId_][voter_] = true;

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

    function version() public pure virtual override returns (uint16) {
        return 1;
    }

    // ======================================================================
    // ERC165
    // ======================================================================

    // --- View Functions ---

    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IVotingAdapterERC20V1).interfaceId ||
            interfaceId_ == type(IVotingAdapterBaseV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            super.supportsInterface(interfaceId_);
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    function _calculateWeightAtSnapshot(
        address voter_,
        uint48 snapshotTimepoint_
    ) internal view virtual returns (uint256) {
        return
            _token.getPastVotes(voter_, snapshotTimepoint_) * _weightPerToken;
    }

    function _getVoteWeightDetails(
        address voter_,
        uint32 proposalId_,
        bytes calldata
    ) internal view virtual returns (uint256) {
        uint48 startTimepoint;
        if (_tokenClockMode == ClockMode.Timestamp) {
            (startTimepoint, ) = _strategy.getVotingTimestamps(proposalId_);
        } else {
            startTimepoint = _strategy.getVotingStartBlock(proposalId_);
        }

        if (startTimepoint == 0) revert ProposalNotInitialized();
        return _calculateWeightAtSnapshot(voter_, startTimepoint);
    }
}
