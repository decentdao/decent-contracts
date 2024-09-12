// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockERC721 is ERC721 {

    uint256 private tokenIds = 0;

    constructor() ERC721("Mock NFT", "MNFT") {}

    function mint(address _owner) external {
        _mint(_owner, tokenIds++);
    }
}