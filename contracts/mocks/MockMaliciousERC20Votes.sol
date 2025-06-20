// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {MockERC20Votes} from "./MockERC20Votes.sol";

contract MockMaliciousERC20Votes is MockERC20Votes {
    function delegate(address delegatee) public override {
        super.transfer(delegatee, super.balanceOf(msg.sender));
        super.delegate(delegatee);
    }
}
