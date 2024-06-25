// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import { IHats } from "../interfaces/hats/IHats.sol";

contract MockHats is IHats {
    uint256 count = 0;

    function mintTopHat(address, string memory, string memory) external returns (uint256 topHatId) {
        topHatId = count;
        count++;
    }
}
