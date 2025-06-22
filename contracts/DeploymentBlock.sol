// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IDeploymentBlock} from "./interfaces/decent/IDeploymentBlock.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title DeploymentBlock
 * @author Decent Labs
 * @notice Abstract implementation of deployment block tracking for upgradeable contracts
 * @dev This abstract contract implements IDeploymentBlock, providing a standard
 * way to record when upgradeable contracts are deployed.
 *
 * Implementation details:
 * - Uses EIP-7201 namespaced storage pattern for upgradeability
 * - Records block number during initialization
 * - Deployment block is immutable once set
 * - Designed for UUPS and transparent proxy patterns
 * - Must be inherited by upgradeable contracts
 *
 * Usage:
 * - Call __DeploymentBlock_init() in the inheriting contract's initializer
 * - The deployment block is automatically set to the current block
 * - Query deploymentBlock() to get the recorded value
 *
 * Security considerations:
 * - Can only be set once during initialization
 * - Prevents reinitialization attacks
 * - Provides reliable deployment block number
 *
 * @custom:security-contact security@decentlabs.io
 */
abstract contract DeploymentBlock is Initializable, IDeploymentBlock {
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /**
     * @notice Main storage struct for DeploymentBlock following EIP-7201
     * @dev Stores the block number when the contract was deployed
     * @custom:storage-location erc7201:Decent.DeploymentBlock.main
     */
    struct DeploymentBlockStorage {
        /** @notice The block number when this contract was deployed */
        uint256 deploymentBlock;
    }

    /**
     * @dev Storage slot for DeploymentBlockStorage calculated using EIP-7201 formula:
     * keccak256(abi.encode(uint256(keccak256("Decent.DeploymentBlock.main")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 internal constant DEPLOYMENT_BLOCK_STORAGE_LOCATION =
        0x07af5ac754c2e5f80e47cd633175198c53fef8f38c1a295a987ff54fb077b600;

    /**
     * @dev Returns the storage struct for DeploymentBlock
     * Following the EIP-7201 namespaced storage pattern to avoid storage collisions
     */
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

    /**
     * @notice Initializes the deployment block tracking
     * @dev Must be called by inheriting contracts in their initializer.
     * Records the current block number as the deployment block.
     * Can only be called once due to the check for existing value.
     * @custom:throws DeploymentBlockAlreadySet if already initialized
     */
    function __DeploymentBlock_init() internal onlyInitializing {
        DeploymentBlockStorage storage $ = _getDeploymentBlockStorage();
        if ($.deploymentBlock != 0) {
            revert DeploymentBlockAlreadySet();
        }

        $.deploymentBlock = block.number;
    }

    // ======================================================================
    // IDeploymentBlock
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc IDeploymentBlock
     */
    function deploymentBlock() public view virtual override returns (uint256) {
        DeploymentBlockStorage storage $ = _getDeploymentBlockStorage();
        return $.deploymentBlock;
    }
}
