// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IDeploymentBlockV1} from "./interfaces/decent/IDeploymentBlockV1.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

abstract contract DeploymentBlockV1 is Initializable, IDeploymentBlockV1 {
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /// @custom:storage-location erc7201:Decent.DeploymentBlock.main
    struct DeploymentBlockStorage {
        uint256 deploymentBlock;
    }

    // EIP-7201: keccak256(abi.encode(uint256(keccak256("Decent.DeploymentBlock.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant DEPLOYMENT_BLOCK_STORAGE_LOCATION =
        0x07af5ac754c2e5f80e47cd633175198c53fef8f38c1a295a987ff54fb077b600;

    function _getDeploymentBlockStorage()
        internal
        pure
        returns (DeploymentBlockStorage storage $)
    {
        assembly {
            $.slot := DEPLOYMENT_BLOCK_STORAGE_LOCATION
        }
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    function __DeploymentBlockV1_init() internal onlyInitializing {
        DeploymentBlockStorage storage $ = _getDeploymentBlockStorage();
        if ($.deploymentBlock != 0) {
            revert DeploymentBlockAlreadySet();
        }

        $.deploymentBlock = block.number;
    }

    // ======================================================================
    // IDeploymentBlockV1
    // ======================================================================

    // --- View Functions ---

    function deploymentBlock() public view virtual override returns (uint256) {
        DeploymentBlockStorage storage $ = _getDeploymentBlockStorage();
        return $.deploymentBlock;
    }
}
