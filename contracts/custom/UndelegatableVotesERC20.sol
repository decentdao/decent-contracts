//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import { VotesERC20 } from "../VotesERC20.sol";

/**
 * An extension of [VotesERC20](../VotesERC20.md) that does not allow token delegation.
 * All holder addresses are self delegated, and attempts to redelegate are simply reverted.
 */
contract UndelegatableVotesERC20 is VotesERC20 {

    error NotDelegatable();

    /**
     * Queries to determine what address a token holder is delegate to just returns the 
     * address itself.
     *
     * @param _account the token holder account
     */
    function delegates(address _account) public pure override returns (address) {
        return _account;
    }

    /**
     * Any attempt to delegate a token holder to another address reverts.
     */
    function _delegate(address, address) internal pure override {
        revert NotDelegatable();
    }
}
