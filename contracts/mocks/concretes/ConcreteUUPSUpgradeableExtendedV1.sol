// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {UUPSUpgradeableExtended} from "../../UUPSUpgradeableExtended.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

/**
 * @title ConcreteUUPSUpgradeableExtended
 * @notice Concrete implementation of UUPSUpgradeableExtended for testing
 * @dev This mock contract provides a minimal implementation of the abstract
 * UUPSUpgradeableExtended contract for testing purposes.
 */
contract ConcreteUUPSUpgradeableExtended is
    UUPSUpgradeableExtended,
    Ownable2StepUpgradeable
{
    uint256 public testValue;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        __Ownable2Step_init();
        _transferOwnership(owner_);
        testValue = 42;
    }

    function setTestValue(uint256 newValue_) external onlyOwner {
        testValue = newValue_;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
