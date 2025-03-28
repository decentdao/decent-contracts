// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

import {IOwnershipV1} from "../interfaces/IOwnershipV1.sol";

/**
 * A mock contract implementing IOwnershipV1 for testing purposes.
 */
contract MockOwnership is IOwnershipV1 {
    address private _owner;

    constructor(address initialOwner) {
        _owner = initialOwner;
    }

    /**
     * Returns the owner of this contract.
     */
    function owner() external view override returns (address) {
        return _owner;
    }

    /**
     * Updates the owner address for testing.
     */
    function setOwner(address newOwner) external {
        _owner = newOwner;
    }
}
