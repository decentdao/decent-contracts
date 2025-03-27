// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

interface IDecentPaymasterV1 {
    function whitelistFunctions(
        address contractAddress,
        bytes4[] calldata selectors,
        bool[] calldata approved
    ) external;

    function isFunctionWhitelisted(
        address contractAddress,
        bytes4 selector
    ) external view returns (bool);
}
