// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import {LockupLinear2} from "../sablier/LockupLinear2.sol";

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
    ) external view returns (LockupLinear2.Stream memory);

    function cancel(uint256 streamId) external;

    function statusOf(
        uint256 streamId
    ) external view returns (LockupLinear2.Status status);
}
