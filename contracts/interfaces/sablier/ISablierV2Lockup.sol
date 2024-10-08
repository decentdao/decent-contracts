// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISablierV2Lockup {
    function withdrawableAmountOf(
        uint256 streamId
    ) external view returns (uint128 withdrawableAmount);

    function isCancelable(uint256 streamId) external view returns (bool result);

    function withdrawMax(
        uint256 streamId,
        address to
    ) external returns (uint128 withdrawnAmount);

    function cancel(uint256 streamId) external;
}
