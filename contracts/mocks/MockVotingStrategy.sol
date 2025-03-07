// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

import {IBaseStrategyV1} from "../interfaces/decent/deployables/IBaseStrategyV1.sol";

contract MockVotingStrategy is IBaseStrategyV1 {
    address public proposer;
    mapping(uint32 => bool) private _isPassed;
    mapping(uint32 => uint32) private _votingEndBlock;

    constructor(address _proposer) {
        proposer = _proposer;
    }

    // required by IBaseStrategyV1

    function setAzorius(address _azoriusModule) external override {}

    function initializeProposal(bytes memory _data) external override {}

    function isPassed(uint32 proposalId) external view override returns (bool) {
        return _isPassed[proposalId];
    }

    function isProposer(
        address _proposer
    ) external view override returns (bool) {
        return _proposer == proposer;
    }

    function votingEndBlock(
        uint32 proposalId
    ) external view override returns (uint32) {
        return _votingEndBlock[proposalId];
    }

    // setters, for testing

    function setVotingEndBlock(uint32 proposalId, uint32 endBlock) external {
        _votingEndBlock[proposalId] = endBlock;
    }

    function setIsPassed(uint32 proposalId, bool passed) external {
        _isPassed[proposalId] = passed;
    }
}
