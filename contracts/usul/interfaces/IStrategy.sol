// SPDX-License-Identifier: LGPL-3.0-only

pragma solidity ^0.8.6;

interface IStrategy {
    /// @dev Called by the proposal module, this notifes the strategy of a new proposal.
    /// @param data any extra data to pass to the voting strategy
    function receiveProposal(bytes memory data) external;

    /// @dev Calls the proposal module to notify that a quorum has been reached.
    /// @param proposalId the proposal to vote for.
    function queueProposal(uint256 proposalId) external;
}
