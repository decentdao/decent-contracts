// SPDX-License-Identifier: LGPL-3.0-only

pragma solidity ^0.8.6;

interface IProposal {
    function queueProposal(uint256 proposalId, uint256 timeLockPeriod) external;
}
