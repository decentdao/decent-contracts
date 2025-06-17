// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {DeploymentBlockV1NonUpgradeable} from "../../DeploymentBlockV1NonUpgradeable.sol";

// Concrete implementation for testing
contract ConcreteDeploymentBlockV1NonUpgradeable is
    DeploymentBlockV1NonUpgradeable
{
    constructor() DeploymentBlockV1NonUpgradeable() {}
}
