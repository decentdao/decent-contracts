// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

interface IDecentPaymasterV1 {
    function setFunctionValidator(
        address contractAddress,
        bytes4 selector,
        address validator
    ) external;

    function removeFunctionValidator(
        address contractAddress,
        bytes4 selector
    ) external;

    function getFunctionValidator(
        address contractAddress,
        bytes4 selector
    ) external view returns (address);
}
