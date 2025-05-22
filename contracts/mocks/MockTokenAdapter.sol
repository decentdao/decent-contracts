// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {ITokenAdapterV1} from "../interfaces/decent/deployables/ITokenAdapterV1.sol";

contract MockTokenAdapter is ITokenAdapterV1 {
    // --- Storages for controlling behavior ---
    mapping(address => uint256) public weightsToReturn; // voter => weight
    mapping(address => bool) public proposerStatusToReturn; // proposerAddress => isProposer?
    mapping(address => mapping(uint32 => mapping(bytes32 => uint256)))
        public recordedVotesWeight; // voter -> proposalId -> keccak256(adapterVoteData) -> weight
    mapping(address => mapping(uint32 => mapping(bytes32 => bool)))
        public hasRecordedVote; // voter -> proposalId -> keccak256(adapterVoteData) -> bool

    bool public shouldRevertRecordVote; // New flag

    // Variables to observe calls, only set in non-view functions or specific test setups
    address public lastVoterForRecordVote;
    uint32 public lastProposalIdForRecordVote;

    // bytes public lastAdapterDataForRecordVote; // Commented out to save gas, not essential for current mock features

    // --- Admin functions to set mock behavior ---
    function setWeight(address _voter, uint256 _weight) external {
        weightsToReturn[_voter] = _weight;
    }

    function setProposerStatus(address _proposer, bool _isProposer) external {
        proposerStatusToReturn[_proposer] = _isProposer;
    }

    function setShouldRevertOnRecordVote(bool _shouldRevert) external {
        // New function
        shouldRevertRecordVote = _shouldRevert;
    }

    // --- ITokenAdapter Implementation ---
    function weightOf(
        address _voter,
        uint32 /*_proposalId*/,
        bytes calldata /*_adapterVoteData*/
    ) external view override returns (uint256 weight) {
        // View function: should not modify state.
        return weightsToReturn[_voter];
    }

    function recordVote(
        address _voter,
        uint32 _proposalId,
        bytes calldata _adapterVoteData
    ) external override returns (uint256 weightCasted) {
        if (shouldRevertRecordVote) {
            revert("MockTokenAdapter: recordVote forced revert");
        }

        lastVoterForRecordVote = _voter;
        lastProposalIdForRecordVote = _proposalId;

        bytes32 dataHash = keccak256(_adapterVoteData);
        uint256 weightToRecord = weightsToReturn[_voter];

        if (hasRecordedVote[_voter][_proposalId][dataHash]) {
            return 0;
        }

        recordedVotesWeight[_voter][_proposalId][dataHash] = weightToRecord;
        hasRecordedVote[_voter][_proposalId][dataHash] = true;
        return weightToRecord;
    }

    function isProposer(
        address _proposer
    ) external view override returns (bool) {
        // View function: should not modify state.
        return proposerStatusToReturn[_proposer];
    }
}
