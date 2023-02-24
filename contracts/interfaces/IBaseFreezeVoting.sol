//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";

interface IBaseFreezeVoting {
    /// @notice Allows user to cast a freeze vote, creating a freeze proposal if necessary
    function castFreezeVote() external;

    /// @notice Unfreezes the DAO, only callable by the owner
    function defrost() external;

    /// @notice Updates the freeze votes threshold, only callable by the owner
    /// @param _freezeVotesThreshold Number of freeze votes required to activate a freeze
    function updateFreezeVotesThreshold(uint256 _freezeVotesThreshold) external;

    /// @notice Updates the freeze proposal period, only callable by the owner
    /// @param _freezeProposalPeriod The number of seconds a freeze proposal has to succeed
    function updateFreezeProposalPeriod(uint256 _freezeProposalPeriod) external;

    /// @notice Updates the freeze period, only callable by the owner
    /// @param _freezePeriod The number of seconds a freeze lasts, from time of freeze proposal creation
    function updateFreezePeriod(uint256 _freezePeriod) external;

    /// @notice Returns true if the DAO is currently frozen, false otherwise
    /// @return bool Indicates whether the DAO is currently frozen
    function isFrozen() external view returns (bool);
}
