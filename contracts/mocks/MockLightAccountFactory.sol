// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

import {ILightAccountFactory} from "../interfaces/ILightAccountFactory.sol";

contract MockLightAccountFactory is ILightAccountFactory {
    mapping(address => mapping(uint256 => address)) private _accountAddresses;

    function setAccountAddress(
        address owner,
        uint256 salt,
        address account
    ) external {
        _accountAddresses[owner][salt] = account;
    }

    function getAddress(
        address owner,
        uint256 salt
    ) external view override returns (address) {
        return _accountAddresses[owner][salt];
    }
}
