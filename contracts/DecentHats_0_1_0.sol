// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import {Enum} from "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import {IAvatar} from "@gnosis.pm/zodiac/contracts/interfaces/IAvatar.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IERC6551Registry} from "./interfaces/IERC6551Registry.sol";
import {IHats} from "./interfaces/hats/IHats.sol";

contract DecentHats_0_1_0 {
    string public constant NAME = "DecentHats_0_1_0";

    struct Hat {
        uint32 maxSupply;
        string details;
        string imageURI;
        bool isMutable;
        address wearer;
    }

    struct CreateTreeParams {
        IHats hatsProtocol;
        address hatsAccountImplementation;
        IERC6551Registry registry;
        address keyValuePairs;
        string topHatDetails;
        string topHatImageURI;
        Hat adminHat;
        Hat[] hats;
    }

    function getSalt() internal view returns (bytes32 salt) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }

        bytes memory concatenatedSaltInput = abi.encodePacked(
            NAME,
            chainId,
            address(this)
        );

        salt = keccak256(concatenatedSaltInput);
    }

    function createTopHat(
        IHats _hatsProtocol,
        string memory _topHatDetails,
        string memory _topHatImageURI
    ) internal returns (uint256) {
        return
            _hatsProtocol.mintTopHat(
                address(this),
                _topHatDetails,
                _topHatImageURI
            );
    }

    function createAccount(
        IERC6551Registry _registry,
        address _hatsAccountImplementation,
        bytes32 salt,
        address protocolAddress,
        uint256 hatId
    ) internal returns (address) {
        return
            _registry.createAccount(
                _hatsAccountImplementation,
                salt,
                block.chainid,
                protocolAddress,
                hatId
            );
    }

    function updateKeyValuePairs(
        address _keyValuePairs,
        uint256 topHatId
    ) internal {
        string[] memory keys = new string[](1);
        string[] memory values = new string[](1);
        keys[0] = "topHatId";
        values[0] = Strings.toString(topHatId);

        IAvatar(msg.sender).execTransactionFromModule(
            _keyValuePairs,
            0,
            abi.encodeWithSignature(
                "updateValues(string[],string[])",
                keys,
                values
            ),
            Enum.Operation.Call
        );
    }

    function createHat(
        IHats _hatsProtocol,
        uint256 adminHatId,
        Hat memory _hat,
        address topHatAccount
    ) internal returns (uint256) {
        return
            _hatsProtocol.createHat(
                adminHatId,
                _hat.details,
                _hat.maxSupply,
                topHatAccount,
                topHatAccount,
                _hat.isMutable,
                _hat.imageURI
            );
    }

    function createHatAccountMint(
        IHats hatsProtocol,
        uint256 adminHatId,
        Hat calldata hat,
        address topHatAccount,
        IERC6551Registry registry,
        address hatsAccountImplementation,
        bytes32 salt
    ) internal returns (uint256 hatId, address accountAddress) {
        hatId = createHat(hatsProtocol, adminHatId, hat, topHatAccount);

        accountAddress = createAccount(
            registry,
            hatsAccountImplementation,
            salt,
            address(hatsProtocol),
            hatId
        );

        if (hat.wearer != address(0)) {
            hatsProtocol.mintHat(hatId, hat.wearer);
        }
    }

    function handleHats(
        IHats _hatsProtocol,
        IERC6551Registry _registry,
        address _hatsAccountImplementation,
        bytes32 salt,
        address topHatAccount,
        uint256 adminHatId,
        Hat[] calldata _hats
    ) internal {
        for (uint256 i = 0; i < _hats.length; ) {
            createHatAccountMint(
                _hatsProtocol,
                adminHatId,
                _hats[i],
                topHatAccount,
                _registry,
                _hatsAccountImplementation,
                salt
            );

            unchecked {
                ++i;
            }
        }
    }

    function createAndDeclareTree(CreateTreeParams calldata params) public {
        bytes32 salt = getSalt();
        uint256 topHatId = createTopHat(
            params.hatsProtocol,
            params.topHatDetails,
            params.topHatImageURI
        );
        address topHatAccount = createAccount(
            params.registry,
            params.hatsAccountImplementation,
            salt,
            address(params.hatsProtocol),
            topHatId
        );

        updateKeyValuePairs(params.keyValuePairs, topHatId);

        (uint256 adminHatId, ) = createHatAccountMint(
            params.hatsProtocol,
            topHatId,
            params.adminHat,
            topHatAccount,
            params.registry,
            params.hatsAccountImplementation,
            salt
        );

        handleHats(
            params.hatsProtocol,
            params.registry,
            params.hatsAccountImplementation,
            salt,
            topHatAccount,
            adminHatId,
            params.hats
        );

        params.hatsProtocol.transferHat(topHatId, address(this), msg.sender);
    }
}
