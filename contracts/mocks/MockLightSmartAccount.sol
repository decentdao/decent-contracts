// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

contract MockLightSmartAccount {
    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external {
        // Empty implementation - we only need this for generating calldata
    }
}
