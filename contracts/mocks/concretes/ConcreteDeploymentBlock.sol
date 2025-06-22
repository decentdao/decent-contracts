// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {DeploymentBlock} from "../../DeploymentBlock.sol";

contract ConcreteDeploymentBlock is DeploymentBlock {
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __DeploymentBlock_init();
    }

    // This should fail if called after initialize
    function reinitialize() external reinitializer(2) {
        __DeploymentBlock_init();
    }
}
