// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {LockupLinear} from "./LockupLinear.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISablierV2LockupLinear {
    function createWithDurations(
        LockupLinear.CreateWithDurations calldata params
    ) external returns (uint256 streamId);
}
