// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

interface ILightAccount {
    function owner() external view returns (address);

    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external;
}
