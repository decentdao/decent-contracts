// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {ITokenAdapterBaseV1} from "../interfaces/decent/deployables/ITokenAdapterBaseV1.sol";

contract MockTokenAdapter is ITokenAdapterBaseV1 {
    mapping(address => uint256) public weightsToReturn;
    mapping(address => mapping(uint32 => mapping(bytes32 => uint256)))
        public recordedVotesWeight;
    mapping(address => mapping(uint32 => mapping(bytes32 => bool)))
        public hasRecordedVote;
    bool public shouldRevertRecordVote;
    address public lastVoterForRecordVote;
    uint32 public lastProposalIdForRecordVote;

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

    // mock setters

    function setWeight(address _voter, uint256 _weight) external {
        weightsToReturn[_voter] = _weight;
    }

    function setShouldRevertOnRecordVote(bool _shouldRevert) external {
        shouldRevertRecordVote = _shouldRevert;
    }
}
