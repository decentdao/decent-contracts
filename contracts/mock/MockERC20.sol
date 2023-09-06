// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {

    constructor() ERC20("Mock ERC20", "MERC20") {}

    function mint(address _owner, uint256 _amount) external {
        _mint(_owner, _amount);
    }
}