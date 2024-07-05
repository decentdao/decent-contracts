//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import {Enum} from "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import {IAvatar} from "@gnosis.pm/zodiac/contracts/interfaces/IAvatar.sol";
import {IHats} from "./interfaces/hats/IHats.sol";
import {IERC6551Registry} from "./interfaces/IERC6551Registry.sol";
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
    IERC6551Registry public registry;
    address public hatsAccountImplementation;

    bytes32 public constant SALT = keccak256("DecentHats");

    constructor(
        IHats _hats,
        address _keyValuePairs,
        IERC6551Registry _registry,
        address _hatsAccountImplementation
    ) {
        hats = _hats;
        keyValuePairs = _keyValuePairs;
        registry = _registry;
        hatsAccountImplementation = _hatsAccountImplementation;
    }

    function createAndDeclareTree(
        string memory _topHatDetails,
        string memory _topHatImageURI,
        Hat calldata _adminHat,
        Hat[] calldata _hats
    ) public {
        uint256 topHatId = hats.mintTopHat(
            address(this),
            _topHatDetails,
            _topHatImageURI
        );
        registry.createAccount(
            hatsAccountImplementation,
            SALT,
            block.chainid,
            address(hats),
            topHatId
        );

        string[] memory keys = new string[](1);
        keys[0] = "topHatId";

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
        registry.createAccount(
            hatsAccountImplementation,
            SALT,
            block.chainid,
            address(hats),
            adminHatId
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
            registry.createAccount(
                hatsAccountImplementation,
                SALT,
                block.chainid,
                address(hats),
                hatId
            );

            if (hat.wearer != address(0)) {
                hats.mintHat(hatId, hat.wearer);
            }

            unchecked {
                ++i;
            }
        }

        hats.transferHat(topHatId, address(this), msg.sender);
    }
}
