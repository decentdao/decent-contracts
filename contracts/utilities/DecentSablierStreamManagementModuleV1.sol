// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IDecentSablierStreamManagementModuleV1} from "../interfaces/decent/utilities/IDecentSablierStreamManagementModuleV1.sol";
import {Lockup} from "../interfaces/sablier/types/DataTypes.sol";
import {ISablierV2Lockup} from "../interfaces/sablier/ISablierV2Lockup.sol";
import {IERC6551Executable} from "../interfaces/erc6551/IERC6551Executable.sol";
import {Enum} from "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import {IAvatar} from "@gnosis-guild/zodiac/contracts/interfaces/IAvatar.sol";

/**
 * @title DecentSablierStreamManagementModuleV1
 * @author Decent Labs
 * @notice Implementation of Sablier stream management utilities
 * @dev This contract implements IDecentSablierStreamManagementModuleV1, providing
 * stream management functionality for DAOs using Sablier V2.
 *
 * Implementation details:
 * - Temporarily attached as Safe module during execution
 * - Handles withdrawals from Hat account-owned streams
 * - Manages stream cancellations for Safe-owned streams
 * - Uses non-reverting patterns for robustness
 * - Non-upgradeable utility contract
 *
 * Stream ownership patterns:
 * - Termed roles: streams owned by individual wearers
 * - Untermed roles: streams owned by Hat ERC6551 accounts
 * - DAO treasury: streams owned by the Safe directly
 *
 * Security considerations:
 * - Must be enabled as module before execution
 * - Should be disabled immediately after use
 * - Only operates on streams accessible to the Safe
 * - Validates stream status before operations
 *
 * @custom:security-contact security@decentlabs.io
 */
contract DecentSablierStreamManagementModuleV1 is
    IDecentSablierStreamManagementModuleV1
{
    // ======================================================================
    // IDecentSablierStreamManagementModuleV1
    // ======================================================================

    // --- State-Changing Functions ---

    /**
     * @inheritdoc IDecentSablierStreamManagementModuleV1
     * @dev Executes a nested call: Safe -> Hat Account -> Sablier.
     * Returns silently if no funds are available to withdraw, preventing
     * proposal failures due to timing issues.
     */
    function withdrawMaxFromStream(
        address sablier_,
        address recipientHatAccount_,
        uint256 streamId_,
        address to_
    ) public virtual override {
        // Check if there are funds to withdraw
        // This prevents reverts when stream has no withdrawable amount
        if (ISablierV2Lockup(sablier_).withdrawableAmountOf(streamId_) == 0) {
            return;
        }

        // Execute nested call through Hat account
        // Safe -> recipientHatAccount.execute() -> sablier.withdrawMax()
        IAvatar(msg.sender).execTransactionFromModule(
            recipientHatAccount_,
            0,
            abi.encodeCall(
                IERC6551Executable.execute,
                (
                    sablier_,
                    0,
                    abi.encodeCall(
                        ISablierV2Lockup.withdrawMax,
                        (streamId_, to_)
                    ),
                    0 // operation type
                )
            ),
            Enum.Operation.Call
        );
    }

    /**
     * @inheritdoc IDecentSablierStreamManagementModuleV1
     * @dev Only cancels streams in PENDING or STREAMING status.
     * Returns silently for other statuses to prevent proposal failures.
     * The Safe must be the stream sender to cancel.
     */
    function cancelStream(
        address sablier_,
        uint256 streamId_
    ) public virtual override {
        // Verify stream is cancellable
        // Only PENDING and STREAMING statuses can be cancelled
        Lockup.Status streamStatus = ISablierV2Lockup(sablier_).statusOf(
            streamId_
        );
        if (
            streamStatus != Lockup.Status.PENDING &&
            streamStatus != Lockup.Status.STREAMING
        ) {
            return;
        }

        // Cancel the stream
        // This will distribute funds according to Sablier's rules
        IAvatar(msg.sender).execTransactionFromModule(
            sablier_,
            0,
            abi.encodeCall(ISablierV2Lockup.cancel, (streamId_)),
            Enum.Operation.Call
        );
    }
}
