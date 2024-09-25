// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import {IHats} from "../interfaces/hats/IHats.sol";

contract MockHats is IHats {
    uint256 public count = 0;

    function mintTopHat(
        address,
        string memory,
        string memory
    ) external returns (uint256 topHatId) {
        topHatId = count;
        count++;
    }

    function createHat(
        uint256,
        string calldata,
        uint32,
        address,
        address,
        bool,
        string calldata
    ) external returns (uint256 newHatId) {
        newHatId = count;
        count++;
    }

    function mintHat(uint256, address) external pure returns (bool success) {
        success = true;
    }

    function transferHat(uint256, address, address) external {}

    function getHatEligibilityModule(
        uint256 _hatId
    ) external view returns (address eligibility) {}

    function isWearerOfHat(
        address _user,
        uint256 _hatId
    ) external view returns (bool isWearer) {}
}
