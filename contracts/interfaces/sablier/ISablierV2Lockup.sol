// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import {LockupLinear} from "../sablier/LockupLinear.sol";

interface ISablierV2Lockup {
    function withdrawableAmountOf(
        uint256 streamId
    ) external view returns (uint128 withdrawableAmount);

    function isCancelable(uint256 streamId) external view returns (bool result);

    function withdrawMax(
        uint256 streamId,
        address to
    ) external returns (uint128 withdrawnAmount);

    function getStream(
        uint256 streamId
    ) external view returns (LockupLinear.Stream memory);

    function cancel(uint256 streamId) external;

    function statusOf(
        uint256 streamId
    ) external view returns (LockupLinear.Status status);
}
