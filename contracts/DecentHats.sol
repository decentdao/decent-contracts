//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import {Enum} from "@gnosis.pm/zodiac/contracts/core/Module.sol";
import {IAvatar} from "@gnosis.pm/zodiac/contracts/interfaces/IAvatar.sol";
import {IHats} from "./interfaces/hats/IHats.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

contract DecentHats {
    struct Hat {
        address eligibility;
        uint32 maxSupply;
        address toggle;
        string details;
        string imageURI;
        bool isMutable;
        address wearer;
    }

    IHats public hats;
    address public keyValuePairs;

    constructor(IHats _hats, address _keyValuePairs) {
        hats = _hats;
        keyValuePairs = _keyValuePairs;
    }

    function createAndDeclareTree(
        string memory _topHatDetails,
        string memory _topHatImageURI,
        Hat calldata _adminHat,
        Hat[] calldata _hats
    ) public {
        uint256 topHatId = hats.mintTopHat(
            msg.sender,
            _topHatDetails,
            _topHatImageURI
        );

        string[] memory keys = new string[](1);
        keys[0] = "hatsTreeId";

        string[] memory values = new string[](1);
        values[0] = Strings.toString(topHatId);

        IAvatar(msg.sender).execTransactionFromModule(
            keyValuePairs,
            0,
            abi.encodeWithSignature(
                "updateValues(string[],string[])",
                keys,
                values
            ),
            Enum.Operation.Call
        );

        uint256 adminHatId = hats.createHat(
            topHatId,
            _adminHat.details,
            _adminHat.maxSupply,
            _adminHat.eligibility,
            _adminHat.toggle,
            _adminHat.isMutable,
            _adminHat.imageURI
        );

        if (_adminHat.wearer != address(0)) {
            hats.mintHat(adminHatId, _adminHat.wearer);
        }

        for (uint256 i = 0; i < _hats.length; ) {
            Hat memory hat = _hats[i];
            uint256 hatId = hats.createHat(
                adminHatId,
                hat.details,
                hat.maxSupply,
                hat.eligibility,
                hat.toggle,
                hat.isMutable,
                hat.imageURI
            );

            if (hat.wearer != address(0)) {
                hats.mintHat(hatId, hat.wearer);
            }

            unchecked {
                ++i;
            }
        }
    }
}
