// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

interface IBaseStrategy {
    /// @notice Sets the address of the Usul contract, only callable by owner
    /// @param _usulModule The address of the Usul module
    function setUsul(address _usulModule) external;

    /// @notice Called by the Usul module, this notifes the strategy of a new proposal
    /// @param _data Any extra data to pass to the voting strategy
    function receiveProposal(bytes memory _data) external;

    /// @notice Calls the proposal module to notify that a quorum has been reached
    /// @param _proposalId The ID of the proposal to queue
    function queueProposal(uint256 _proposalId) external;

    /// @notice Retruns if a proposal has succeeded
    /// @param proposalId The proposalId to check
    /// @return bool Returns true if the proposal has passed
    function isPassed(uint256 proposalId) external view returns (bool);
}