// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

import "./interfaces/IAzorius.sol";
import "./interfaces/IBaseStrategy.sol";
import "@gnosis.pm/zodiac/contracts/factory/FactoryFriendly.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

abstract contract BaseStrategy is
    OwnableUpgradeable,
    FactoryFriendly,
    IBaseStrategy
{
    event AzoriusSet(address indexed newAzorius);
    event StrategySetup(address indexed AzoriusModule, address indexed owner);

    IAzorius public azoriusModule;

    modifier onlyAzorius() {
        require(
            msg.sender == address(azoriusModule),
            "Only callable by Azorius module"
        );
        _;
    }

    /// @notice Sets the address of the Azorius contract, only callable by owner
    /// @param _azoriusModule The address of the Azorius module
    function setAzorius(address _azoriusModule) external onlyOwner {
        _setAzorius(_azoriusModule);
    }

    /// @notice Called by the proposal module, this notifes the strategy of a new proposal
    /// @param _data Any extra data to pass to the voting strategy
    function initializeProposal(bytes memory _data) external virtual;

    /// @notice Calls the proposal module to notify that a quorum has been reached
    /// @param _proposalId The ID of the proposal to timelock
    function timelockProposal(uint256 _proposalId) external virtual;

    /// @notice Sets the address of the Azorius contract
    /// @param _azoriusModule The address of the Azorius module
    function _setAzorius(address _azoriusModule) internal {
        azoriusModule = IAzorius(_azoriusModule);

        emit AzoriusSet(_azoriusModule);
    }

    /// @notice Returns if a proposal has succeeded
    /// @param _proposalId The proposalId to check
    /// @return bool Returns true if the proposal has passed
    function isPassed(uint256 _proposalId) public view virtual returns (bool);

    /// @notice Returns if the specified address can submit a proposal
    /// @param _user The user address to check
    /// @return bool True if the user can submit a proposal
    function isProposer(address _user) public view virtual returns (bool);

    /// @notice Returns if voting is active on a proposal
    /// @param _proposalId The ID of the proposal to check
    /// @return bool True if the voting is active
    function isVotingActive(
        uint256 _proposalId
    ) public view virtual returns (bool);
}
