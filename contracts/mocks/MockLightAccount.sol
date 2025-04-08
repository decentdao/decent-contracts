// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

import {ILightAccount} from "../interfaces/ILightAccount.sol";

contract MockLightAccount is ILightAccount {
    address private _owner;

    constructor(address initialOwner) {
        _owner = initialOwner;
    }

    function owner() external view returns (address) {
        return _owner;
    }

    function setOwner(address newOwner) external {
        _owner = newOwner;
    }

    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external {
        // Empty implementation - we only need this for generating calldata
    }
}
