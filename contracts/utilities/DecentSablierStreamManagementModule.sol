// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IDecentSablierStreamManagementModule} from "../interfaces/decent/utilities/IDecentSablierStreamManagementModule.sol";
import {Lockup} from "../interfaces/sablier/types/DataTypes.sol";
import {ISablierV2Lockup} from "../interfaces/sablier/ISablierV2Lockup.sol";
import {IERC6551Executable} from "../interfaces/erc6551/IERC6551Executable.sol";
import {Enum} from "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import {IAvatar} from "@gnosis-guild/zodiac/contracts/interfaces/IAvatar.sol";

contract DecentSablierStreamManagementModule is
    IDecentSablierStreamManagementModule
{
    // ======================================================================
    // IDecentSablierStreamManagementModule
    // ======================================================================

    // --- State-Changing Functions ---

    function withdrawMaxFromStream(
        address sablier_,
        address recipientHatAccount_,
        uint256 streamId_,
        address to_
    ) public virtual override {
        // Check if there are funds to withdraw
        if (ISablierV2Lockup(sablier_).withdrawableAmountOf(streamId_) == 0) {
            return;
        }

        // Proxy the Sablier withdrawMax call through IAvatar (Safe)
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
                    0
                )
            ),
            Enum.Operation.Call
        );
    }

    function cancelStream(
        address sablier_,
        uint256 streamId_
    ) public virtual override {
        // Check if the stream can be cancelled
        Lockup.Status streamStatus = ISablierV2Lockup(sablier_).statusOf(
            streamId_
        );
        if (
            streamStatus != Lockup.Status.PENDING &&
            streamStatus != Lockup.Status.STREAMING
        ) {
            return;
        }

        IAvatar(msg.sender).execTransactionFromModule(
            sablier_,
            0,
            abi.encodeCall(ISablierV2Lockup.cancel, (streamId_)),
            Enum.Operation.Call
        );
    }
}
