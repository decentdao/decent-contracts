// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import {IHats} from "../interfaces/hats/IHats.sol";

contract MockHats is IHats {
    uint256 public count = 0;

    // Mapping to track which addresses wear which hats
    mapping(uint256 => mapping(address => bool)) private hatWearers;

    function mintTopHat(
        address _wearer,
        string memory,
        string memory
    ) external returns (uint256 topHatId) {
        topHatId = count;
        hatWearers[topHatId][_wearer] = true;
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

    function mintHat(
        uint256 _hatId,
        address _wearer
    ) external returns (bool success) {
        hatWearers[_hatId][_wearer] = true;
        success = true;
    }

    function transferHat(uint256 _hatId, address _from, address _to) external {
        hatWearers[_hatId][_from] = false;
        hatWearers[_hatId][_to] = true;
    }

    function isWearerOfHat(
        address _user,
        uint256 _hatId
    ) external view returns (bool) {
        return hatWearers[_hatId][_user];
    }
}
