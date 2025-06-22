// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {DeploymentBlockNonUpgradeable} from "../../DeploymentBlockNonUpgradeable.sol";

// Concrete implementation for testing
contract ConcreteDeploymentBlockNonUpgradeable is
    DeploymentBlockNonUpgradeable
{
    constructor() DeploymentBlockNonUpgradeable() {}
}
