// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

interface IDecentPaymasterV1 {
    function setStrategyFunctionApproval(
        address strategy,
        bytes4[] calldata selectors,
        bool[] calldata approved
    ) external;

    function isFunctionApproved(
        address strategy,
        bytes4 selector
    ) external view returns (bool);
}
