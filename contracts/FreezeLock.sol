//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "@gnosis.pm/zodiac/contracts/factory/FactoryFriendly.sol";
import "./interfaces/IFreezeLock.sol";

contract FreezeLock is FactoryFriendly, IFreezeLock {

    uint256 public freezePeriod; // Number of blocks a freeze lasts, from time of freeze proposal creation
    uint256 private frozenBlock;

    event FreezeLockSetUp(address indexed owner);
    event FreezeStarted();
    event FreezeCanceled();
    event FreezePeriodUpdated(uint256 freezePeriod);

    /// @notice Initialize function, will be triggered when a new proxy is deployed
    /// @param initializeParams Parameters of initialization encoded
    function setUp(bytes memory initializeParams) public override initializer {
        (
            address _owner,
            uint256 _freezePeriod
        ) = abi.decode(
                initializeParams,
                (address, uint256)
            );

        __Ownable_init();
        _transferOwnership(_owner);
        _updateFreezePeriod(_freezePeriod);
        freezePeriod = _freezePeriod;
        emit FreezeLockSetUp(_owner);
    }

    function startFreeze() external onlyOwner {
        frozenBlock = block.number;
        emit FreezeStarted();
    }

    /// @notice Unfreezes the DAO, only callable by the owner
    function unfreeze() external onlyOwner {
        frozenBlock = block.number - freezePeriod;
        emit FreezeCanceled();
    }

    /// @notice Updates the freeze period, only callable by the owner
    /// @param _freezePeriod The number of blocks a freeze lasts, from time of freeze proposal creation
    function updateFreezePeriod(uint256 _freezePeriod) external onlyOwner {
        _updateFreezePeriod(_freezePeriod);
    }

    /// @notice Updates the freeze period
    /// @param _freezePeriod The number of blocks a freeze lasts, from time of freeze proposal creation
    function _updateFreezePeriod(uint256 _freezePeriod) internal {
        freezePeriod = _freezePeriod;

        emit FreezePeriodUpdated(_freezePeriod);
    }

    /// @notice Returns true if the DAO is currently frozen, false otherwise
    /// @return bool Indicates whether the DAO is currently frozen
    function isFrozen() external view returns (bool) {
        return frozenBlock + freezePeriod > block.number;
    }
}