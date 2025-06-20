// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IDeploymentBlockV1} from "./interfaces/decent/IDeploymentBlockV1.sol";

abstract contract DeploymentBlockV1NonUpgradeable is IDeploymentBlockV1 {
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /// @custom:storage-location erc7201:Decent.DeploymentBlockNonUpgradeable.main
    struct DeploymentBlockNonUpgradeableStorage {
        uint256 deploymentBlock;
    }

    // EIP-7201: keccak256(abi.encode(uint256(keccak256("Decent.DeploymentBlockNonUpgradeable.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32
        internal constant DEPLOYMENT_BLOCK_NON_UPGRADEABLE_STORAGE_LOCATION =
        0x75420419808cf80485ed57399dff70df3a6d545855667cf2ad8ee38294f38000;

    function _getDeploymentBlockNonUpgradeableStorage()
        internal
        pure
        returns (DeploymentBlockNonUpgradeableStorage storage $)
    {
        assembly {
            $.slot := DEPLOYMENT_BLOCK_NON_UPGRADEABLE_STORAGE_LOCATION
        }
    }

    // ======================================================================
    // CONSTRUCTOR
    // ======================================================================

    constructor() {
        DeploymentBlockNonUpgradeableStorage
            storage $ = _getDeploymentBlockNonUpgradeableStorage();
        $.deploymentBlock = block.number;
    }

    // ======================================================================
    // IDeploymentBlockV1
    // ======================================================================

    // --- View Functions ---

    function deploymentBlock() public view virtual override returns (uint256) {
        DeploymentBlockNonUpgradeableStorage
            storage $ = _getDeploymentBlockNonUpgradeableStorage();
        return $.deploymentBlock;
    }
}
