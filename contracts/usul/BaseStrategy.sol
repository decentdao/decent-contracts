// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

import "../interfaces/IFractalUsul.sol";
import "./IBaseStrategy.sol";
import "@gnosis.pm/zodiac/contracts/factory/FactoryFriendly.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

abstract contract BaseStrategy is
    OwnableUpgradeable,
    FactoryFriendly,
    IBaseStrategy
{
    event UsulSet(address indexed newUsul);
    event StrategySetup(address indexed UsulModule, address indexed owner);

    IFractalUsul public usulModule;

    modifier onlyUsul() {
        require(
            msg.sender == address(usulModule),
            "Only callable by Usul module"
        );
        _;
    }

    /// @notice Sets the address of the Usul contract, only callable by owner
    /// @param _usulModule The address of the Usul module
    function setUsul(address _usulModule) external onlyOwner {
        _setUsul(_usulModule);
    }

    /// @notice Called by the Usul module, this notifes the strategy of a new proposal
    /// @param _data Any extra data to pass to the voting strategy
    function receiveProposal(bytes memory _data) external virtual;

    /// @notice Calls the proposal module to notify that a quorum has been reached
    /// @param _proposalId The ID of the proposal to timelock
    function timelockProposal(uint256 _proposalId) external virtual;

    /// @notice Sets the address of the Usul contract
    /// @param _usulModule The address of the Usul module
    function _setUsul(address _usulModule) internal {
        usulModule = IFractalUsul(_usulModule);

        emit UsulSet(_usulModule);
    }

    /// @notice Returns if a proposal has succeeded
    /// @param proposalId The proposalId to check
    /// @return bool Returns true if the proposal has passed
    function isPassed(uint256 proposalId) public view virtual returns (bool);

    /// @notice Returns if the specified address can submit a proposal
    /// @param user The user address to check
    /// @return bool True if the user can submit a proposal
    function isProposer(address user) public view virtual returns (bool);
}
