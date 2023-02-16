// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

interface IBaseStrategy {
    /// @notice Sets the address of the Usul contract, only callable by owner
    /// @param _usulModule The address of the Usul module
    function setUsul(address _usulModule) external;

    /// @notice Called by the proposal module, this notifes the strategy of a new proposal
    /// @param _data Any extra data to pass to the voting strategy
    function initializeProposal(bytes memory _data) external;

    /// @notice Calls the proposal module to notify that a quorum has been reached
    /// @param _proposalId The ID of the proposal to timelock
    function timelockProposal(uint256 _proposalId) external;

    /// @notice Retruns if a proposal has succeeded
    /// @param _proposalId The proposalId to check
    /// @return bool Returns true if the proposal has passed
    function isPassed(uint256 _proposalId) external view returns (bool);

    /// @notice Returns if the specified address can submit a proposal
    /// @param _user The user address to check
    /// @return bool True if the user can submit a proposal
    function isProposer(address _user) external view returns (bool);
}
