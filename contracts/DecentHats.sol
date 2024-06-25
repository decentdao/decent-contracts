//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import { Enum } from "@gnosis.pm/zodiac/contracts/core/Module.sol";
import { IAvatar } from "@gnosis.pm/zodiac/contracts/interfaces/IAvatar.sol";
import { IHats } from "./interfaces/hats/IHats.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";

contract DecentHats {
    IHats public hats;
    address public keyValuePairs;

    constructor(IHats _hats, address _keyValuePairs) {
        hats = _hats;
        keyValuePairs = _keyValuePairs;
    }

    function createAndDeclareTree(string memory _details, string memory _imageURI) public returns (bool success) {
        uint256 topHatId = hats.mintTopHat(msg.sender, _details, _imageURI);

        string[] memory keys = new string[](1);
        keys[0] = "hatsTreeId";

        string[] memory values = new string[](1);
        values[0] = Strings.toString(topHatId);

        success = IAvatar(msg.sender).execTransactionFromModule(
            keyValuePairs,
            0,
            abi.encodeWithSignature("updateValues(string[],string[])", keys, values),
            Enum.Operation.Call
        );

        return success;
    }
}
