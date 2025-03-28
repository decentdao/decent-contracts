// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

interface IVersion {
    function getVersion() external view returns (uint16);
}
