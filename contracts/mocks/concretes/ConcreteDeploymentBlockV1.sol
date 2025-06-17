// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {DeploymentBlockV1} from "../../DeploymentBlockV1.sol";

contract ConcreteDeploymentBlockV1 is DeploymentBlockV1 {
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __DeploymentBlockV1_init();
    }

    // This should fail if called after initialize
    function reinitialize() external reinitializer(2) {
        __DeploymentBlockV1_init();
    }
}
