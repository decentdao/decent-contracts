// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

/**
 * @title IDecentSablierStreamManagementModuleV1
 * @notice Utility module for managing Sablier payment streams
 * @dev This module provides functionality to manage Sablier V2 streams, particularly
 * for withdrawing funds from streams owned by Hat smart accounts and cancelling
 * streams owned by the Safe. It acts as a temporary module to handle stream operations.
 *
 * Key features:
 * - Withdraw accumulated funds from streams
 * - Cancel active streams
 * - Handle streams owned by Hat accounts (ERC6551)
 * - Execute operations through Safe's module system
 *
 * Workflow:
 * 1. Safe temporarily enables this module
 * 2. Module executes stream management operations
 * 3. For Hat account streams, proxies calls through the account
 * 4. Safe disables the module after operations
 *
 * Use cases:
 * - Withdrawing salary/compensation from streams
 * - Cancelling streams for terminated roles
 * - Managing payment flows for DAO contributors
 * - Handling stream operations in governance proposals
 *
 * Security:
 * - Only operates on streams the Safe has access to
 * - Validates stream status before operations
 * - Temporary module pattern prevents persistent access
 */
interface IDecentSablierStreamManagementModuleV1 {
    // --- State-Changing Functions ---

    /**
     * @notice Withdraws the maximum available amount from a stream
     * @dev This function is designed for streams owned by Hat smart accounts.
     * It proxies the withdrawal call through the Hat account to the Sablier contract.
     * If no funds are available to withdraw, the function returns without reverting.
     *
     * Call flow:
     * 1. Safe (via module) -> Hat Account -> Sablier.withdrawMax()
     *
     * @param sablier_ The Sablier V2 contract address
     * @param recipientHatAccount_ The Hat account that owns the stream
     * @param streamId_ The ID of the stream to withdraw from
     * @param to_ The address to receive the withdrawn funds
     * @custom:security Requires the Safe to have control over the Hat account
     */
    function withdrawMaxFromStream(
        address sablier_,
        address recipientHatAccount_,
        uint256 streamId_,
        address to_
    ) external;

    /**
     * @notice Cancels an active stream
     * @dev This function cancels a stream owned by the calling Safe.
     * Only works for streams in PENDING or STREAMING status.
     * Cancelled streams distribute remaining funds according to Sablier rules.
     * If the stream cannot be cancelled, the function returns without reverting.
     *
     * @param sablier_ The Sablier V2 contract address
     * @param streamId_ The ID of the stream to cancel
     * @custom:security Only the stream sender (Safe) can cancel
     */
    function cancelStream(address sablier_, uint256 streamId_) external;
}
