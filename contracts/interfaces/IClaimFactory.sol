//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IClaimFactory {
    event SubsidiaryCreated(address indexed subsidiaryAddress);

    /// @dev Creates a module
    /// @param creator The address creating the module
    /// @param data The array of bytes used to create the module
    /// @return address[] Array of the created module addresses
    function create(address creator, bytes[] calldata data) external returns (address[] memory);
}