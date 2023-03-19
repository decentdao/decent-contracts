//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";

interface IFreezeLock {

    /// @notice Freezes the DAO
    function startFreeze() external;

    /// @notice Unfreezes the DAO
    function unfreeze() external;

    /// @notice Updates the freeze period
    /// @param _freezePeriod The number of blocks a freeze lasts, from time of freeze proposal creation
    function updateFreezePeriod(uint256 _freezePeriod) external;

    /// @notice Returns true if the DAO is currently frozen, false otherwise
    /// @return bool Indicates whether the DAO is currently frozen
    function isFrozen() external view returns (bool);
}