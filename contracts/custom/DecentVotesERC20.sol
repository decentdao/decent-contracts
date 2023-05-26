//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import { VotesERC20 } from "../VotesERC20.sol";

contract DecentVotesERC20 is VotesERC20 {

    error NotDelegatable();

    function delegates(address account) public view override returns (address) {
        return account;
    }

    function _delegate(address, address) internal override {
        revert NotDelegatable();
    }
}
