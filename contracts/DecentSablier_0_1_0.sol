// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import {Enum} from "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import {IAvatar} from "@gnosis.pm/zodiac/contracts/interfaces/IAvatar.sol";
import {ISablierV2LockupLinear} from "./interfaces/sablier/ISablierV2LockupLinear.sol";

contract DecentSablierStreamManagement {
    string public constant NAME = "DecentSablierStreamManagement";

    function withdrawMaxFromStream(
        ISablierV2LockupLinear sablier,
        HatsAccount1ofNAbi smartAccount,
        uint256 streamId,
        address to,
    ) public {
        // Check if there are funds to withdraw
        uint128 withdrawableAmount = sablier.withdrawableAmountOf(streamId);
        if (withdrawableAmount == 0) {
            return;
        }

        // Proxy the Sablier withdrawMax call through IAvatar (Safe)
        IAvatar(msg.sender).execTransactionFromModule(
            address(smartAccount),
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

    function cancelStream(ISablierV2LockupLinear sablier, uint256 streamId) public {
        // Check if the stream is still active
        if (!sablier.isCancelable(streamId)) {
            return;
        }

        IAvatar(msg.sender).execTransactionFromModule(
            address(sablier),
            0,
            abi.encodeWithSignature(
                "cancel(uint256)",
                streamId,
            ),
            Enum.Operation.Call
        );
    }
}
