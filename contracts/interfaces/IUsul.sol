//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IUsul {
    struct Proposal {
        bool canceled;
        uint256 timeLockPeriod; // queue period for safety
        bytes32[] txHashes;
        uint256 executionCounter;
        address strategy; // the module that is allowed to vote on this
    }

    function proposals(uint256 proposaldId) external view returns (Proposal memory);
}