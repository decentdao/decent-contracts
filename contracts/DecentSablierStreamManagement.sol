// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Enum} from "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import {IAvatar} from "@gnosis.pm/zodiac/contracts/interfaces/IAvatar.sol";
import {ISablierV2Lockup} from "./interfaces/sablier/full/ISablierV2Lockup.sol";
import {Lockup} from "./interfaces/sablier/full/types/DataTypes.sol";

contract DecentSablierStreamManagement {
    string public constant NAME = "DecentSablierStreamManagement";

    function withdrawMaxFromStream(
        ISablierV2Lockup sablier,
        address recipientHatAccount,
        uint256 streamId,
        address to
    ) public {
        // Check if there are funds to withdraw
        uint128 withdrawableAmount = sablier.withdrawableAmountOf(streamId);
        if (withdrawableAmount == 0) {
            return;
        }

        // Proxy the Sablier withdrawMax call through IAvatar (Safe)
        IAvatar(msg.sender).execTransactionFromModule(
            recipientHatAccount,
            0,
            abi.encodeWithSignature(
                "execute(address,uint256,bytes,uint8)",
                address(sablier),
                0,
                abi.encodeWithSignature(
                    "withdrawMax(uint256,address)",
                    streamId,
                    to
                ),
                0
            ),
            Enum.Operation.Call
        );
    }

    function cancelStream(ISablierV2Lockup sablier, uint256 streamId) public {
        // Check if the stream can be cancelled
        Lockup.Status streamStatus = sablier.statusOf(streamId);
        if (
            streamStatus != Lockup.Status.PENDING &&
            streamStatus != Lockup.Status.STREAMING
        ) {
            return;
        }

        IAvatar(msg.sender).execTransactionFromModule(
            address(sablier),
            0,
            abi.encodeWithSignature("cancel(uint256)", streamId),
            Enum.Operation.Call
        );
    }
}
