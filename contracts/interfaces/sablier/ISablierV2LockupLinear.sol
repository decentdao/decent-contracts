// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {LockupLinear} from "./LockupLinear.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISablierV2LockupLinear {
    function createWithTimestamps(
        LockupLinear.CreateWithTimestamps calldata params
    ) external returns (uint256 streamId);

        /// @notice Emitted when assets are withdrawn from a stream.
    /// @param streamId The ID of the stream.
    /// @param to The address that has received the withdrawn assets.
    /// @param asset The contract address of the ERC-20 asset to be distributed.
    /// @param amount The amount of assets withdrawn, denoted in units of the asset's decimals.
    event WithdrawFromLockupStream(uint256 indexed streamId, address indexed to, IERC20 indexed asset, uint128 amount);

    /// @notice Withdraws the maximum withdrawable amount from the stream to the provided address `to`.
    ///
    /// @dev Emits a {Transfer}, {WithdrawFromLockupStream}, and {MetadataUpdate} event.
    ///
    /// Notes:
    /// - Refer to the notes in {withdraw}.
    ///
    /// Requirements:
    /// - Refer to the requirements in {withdraw}.
    ///
    /// @param streamId The ID of the stream to withdraw from.
    /// @param to The address receiving the withdrawn assets.
    /// @return withdrawnAmount The amount withdrawn, denoted in units of the asset's decimals.
    function withdrawMax(
        uint256 streamId,
        address to
    ) external returns (uint128 withdrawnAmount);

    /// @notice Calculates the amount that the recipient can withdraw from the stream, denoted in units of the asset's
    /// decimals.
    /// @dev Reverts if `streamId` references a null stream.
    /// @param streamId The stream ID for the query.
    function withdrawableAmountOf(uint256 streamId) external view returns (uint128 withdrawableAmount);
}
