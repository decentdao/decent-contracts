// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IDeploymentBlockV1} from "./interfaces/decent/IDeploymentBlockV1.sol";

abstract contract DeploymentBlockV1NonUpgradeable is IDeploymentBlockV1 {
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    uint256 internal immutable _deploymentBlock;

    // ======================================================================
    // CONSTRUCTOR
    // ======================================================================

    constructor() {
        _deploymentBlock = block.number;
    }

    // ======================================================================
    // IDeploymentBlockV1
    // ======================================================================

    // --- View Functions ---

    function deploymentBlock() public view virtual override returns (uint256) {
        return _deploymentBlock;
    }
}
