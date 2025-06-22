// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IVotingAdapterBase} from "../interfaces/decent/deployables/IVotingAdapterBase.sol";

contract MockVotingAdapter is IVotingAdapterBase {
    mapping(address => uint256) public weightsToReturn;
    mapping(address => mapping(uint32 => mapping(bytes32 => uint256)))
        public recordedVotesWeight;
    mapping(address => mapping(uint32 => mapping(bytes32 => bool)))
        public hasRecordedVote;
    bool public shouldRevertRecordVote;
    address public lastVoterForRecordVote;
    uint32 public lastProposalIdForRecordVote;

    mapping(address => bool) private _validVoteToReturn;
    mapping(address => uint256) private _validationWeightToReturn;

    uint256 public weightToReturnOnRecord;
    uint256 public weightToReturnOnGet;
    address public lastVoterForRecord;
    uint48 public lastSnapshotAndIdForRecord;
    bytes public lastAdapterDataForRecord;
    bool public recordVoteCalled;

    address public lastVoterForGet;
    uint48 public lastSnapshotAndIdForGet;
    bytes public lastAdapterDataForGet;
    bool public getFreezeVoteWeightCalled;

    function recordVote(
        address _voter,
        uint32 _proposalId,
        bytes calldata _adapterVoteData
    ) external override returns (uint256 weightCasted) {
        if (shouldRevertRecordVote) {
            revert("MockVotingAdapter: recordVote forced revert");
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

    function setWeight(address _voter, uint256 _weight) external {
        weightsToReturn[_voter] = _weight;
        _validVoteToReturn[_voter] = true;
        _validationWeightToReturn[_voter] = _weight;
    }

    function setValidVote(
        address _voter,
        bool _isValid,
        uint256 _weight
    ) external {
        _validVoteToReturn[_voter] = _isValid;
        _validationWeightToReturn[_voter] = _weight;
    }

    function setShouldRevertOnRecordVote(bool _shouldRevert) external {
        shouldRevertRecordVote = _shouldRevert;
    }

    function weightOf(
        address _voter,
        uint32 _proposalId,
        bytes calldata _votingAdapterVoteData
    ) external view override returns (uint256 weight) {}

    function strategy() external view override returns (address) {}

    function setWeightToReturnOnRecord(uint256 weight) external {
        weightToReturnOnRecord = weight;
    }

    function setWeightToReturnOnGet(uint256 weight) external {
        weightToReturnOnGet = weight;
    }

    function recordFreezeVote(
        address voter,
        uint48 freezeProposalSnapshotAndId,
        bytes calldata adapterVoteData
    ) external virtual override returns (uint256 weightCasted) {
        if (shouldRevertRecordVote) {
            revert("MockVotingAdapter: recordFreezeVote forced revert");
        }
        lastVoterForRecord = voter;
        lastSnapshotAndIdForRecord = freezeProposalSnapshotAndId;
        lastAdapterDataForRecord = adapterVoteData;
        recordVoteCalled = true;
        emit FreezeVoteRecorded(
            voter,
            freezeProposalSnapshotAndId,
            weightToReturnOnRecord,
            adapterVoteData
        );
        return weightToReturnOnRecord;
    }

    // Helper to reset mock state for testing if needed, not part of interface
    function resetRecordVoteCall() external {
        recordVoteCalled = false;
        lastVoterForRecord = address(0);
        lastSnapshotAndIdForRecord = 0;
        lastAdapterDataForRecord = bytes("");
    }

    function validVotingAdapterVote(
        address lightAccountOwner_,
        uint32,
        bytes calldata
    ) external view override returns (bool, uint256) {
        return (
            _validVoteToReturn[lightAccountOwner_],
            _validationWeightToReturn[lightAccountOwner_]
        );
    }
}
