// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import {Enum} from "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import {IAvatar} from "@gnosis.pm/zodiac/contracts/interfaces/IAvatar.sol";
import {ISablier} from "./interfaces/sablier/ISablier.sol";

contract DecentSablier_0_1_0 {
    string public constant NAME = "DecentSablier_0_1_0";

    struct SablierStreamInfo {
        uint256 streamId;
    }

    function processSablierStreams(
        address sablierContract,
        SablierStreamInfo[] calldata streams
    ) public {
        ISablier sablier = ISablier(sablierContract);

        for (uint256 i = 0; i < streams.length; i++) {
            uint256 streamId = streams[i].streamId;

            // Get the current balance available for withdrawal
            uint256 availableBalance = sablier.balanceOf(streamId, msg.sender);

            if (availableBalance > 0) {
                // Proxy the withdrawal call through the Safe
                IAvatar(msg.sender).execTransactionFromModule(
                    sablierContract,
                    0,
                    abi.encodeWithSelector(
                        ISablier.withdrawFromStream.selector,
                        streamId,
                        availableBalance
                    ),
                    Enum.Operation.Call
                );
            }
        }
    }
}
