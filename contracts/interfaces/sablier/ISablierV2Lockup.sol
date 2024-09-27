// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISablierV2Lockup {
    function getRecipient(
        uint256 streamId
    ) external view returns (address recipient);

    function withdrawableAmountOf(
        uint256 streamId
    ) external view returns (uint128 withdrawableAmount);
}
