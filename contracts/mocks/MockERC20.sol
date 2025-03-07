// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("MockERC20", "MCK") {}

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}
