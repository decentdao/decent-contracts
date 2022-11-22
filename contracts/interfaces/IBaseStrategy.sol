//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IBaseStrategy {
    /// @dev Calls the proposal module to notify that a quorum has been reached.
    /// @param proposalId the proposal to vote for.
    function finalizeStrategy(uint256 proposalId) external;
}