// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import {Enum} from "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import {IAvatar} from "@gnosis.pm/zodiac/contracts/interfaces/IAvatar.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC6551Registry} from "./interfaces/IERC6551Registry.sol";
import {IHats} from "./interfaces/hats/IHats.sol";
import {ISablierV2LockupLinear} from "./interfaces/sablier/ISablierV2LockupLinear.sol";
import {LockupLinear} from "./interfaces/sablier/LockupLinear.sol";
import {DecentAutonomousAdmin} from "./DecentAutonomousAdmin.sol";
import {IHatsModuleFactory} from "./interfaces/IHatModuleFactory.sol";
import {IHatsElectionEligibility} from "./interfaces/hats/IHatsElectionEligibility.sol";

contract DecentHats_0_1_0 {
    string public constant NAME = "DecentHats_0_1_0";

    struct SablierStreamParams {
        ISablierV2LockupLinear sablier;
        address sender;
        uint128 totalAmount;
        address asset;
        bool cancelable;
        bool transferable;
        LockupLinear.Timestamps timestamps;
        LockupLinear.Broker broker;
    }

    struct TermedParams {
        uint128 termEndDateTs;
        address[] nominatedWearers;
    }

    struct Hat {
        uint32 maxSupply;
        string details;
        string imageURI;
        bool isMutable;
        address wearer;
        bool isTermed;
        SablierStreamParams[] sablierParams; // Optional Sablier stream parameters
        TermedParams termedParams; // Optional termed parameters
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
        IHatsModuleFactory hatsModuleFactory;
        address hatsElectionEligibilityImplementation;
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
                // ? @todo should be this be dead HATS address?
                topHatAccount,
                topHatAccount,
                _hat.isMutable,
                _hat.imageURI
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

    function createTopHatAndAccount(
        IHats _hatsProtocol,
        string memory _topHatDetails,
        string memory _topHatImageURI,
        IERC6551Registry _registry,
        address _hatsAccountImplementation,
        bytes32 salt
    ) internal returns (uint256 topHatId, address topHatAccount) {
        topHatId = _hatsProtocol.mintTopHat(
            address(this),
            _topHatDetails,
            _topHatImageURI
        );

        topHatAccount = createAccount(
            _registry,
            _hatsAccountImplementation,
            salt,
            address(_hatsProtocol),
            topHatId
        );
    }

    function createHatAndAccountAndMintAndStreams(
        IHats hatsProtocol,
        uint256 adminHatId,
        Hat calldata hat,
        address topHatAccount,
        IERC6551Registry registry,
        address hatsAccountImplementation,
        bytes32 salt,
        IHatsModuleFactory hatsModuleFactory,
        address hatsElectionEligibilityImplementation,
        uint256 topHatId
    ) internal returns (uint256 hatId, address accountAddress) {
        hatId = createHat(hatsProtocol, adminHatId, hat, topHatAccount);

        if (hat.isTermed) {
            // Create election module and set as eligiblity, elect, and start next term
            createElectionModuleAndExecuteFirstTerm(
                hatsProtocol,
                hatsModuleFactory,
                hatsElectionEligibilityImplementation,
                hatId,
                hat.termedParams.termEndDateTs,
                hat.termedParams.nominatedWearers,
                abi.encodePacked(topHatId),
                uint256(salt)
            );
        }

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

        for (uint256 i = 0; i < hat.sablierParams.length; ) {
            SablierStreamParams memory sablierParams = hat.sablierParams[i];

            // Approve tokens for Sablier
            IAvatar(msg.sender).execTransactionFromModule(
                sablierParams.asset,
                0,
                abi.encodeWithSignature(
                    "approve(address,uint256)",
                    address(sablierParams.sablier),
                    sablierParams.totalAmount
                ),
                Enum.Operation.Call
            );

            LockupLinear.CreateWithTimestamps memory params = LockupLinear
                .CreateWithTimestamps({
                    sender: sablierParams.sender,
                    recipient: accountAddress,
                    totalAmount: sablierParams.totalAmount,
                    asset: IERC20(sablierParams.asset),
                    cancelable: sablierParams.cancelable,
                    transferable: sablierParams.transferable,
                    timestamps: sablierParams.timestamps,
                    broker: sablierParams.broker
                });

            // Proxy the Sablier call through IAvatar
            IAvatar(msg.sender).execTransactionFromModule(
                address(sablierParams.sablier),
                0,
                abi.encodeWithSignature(
                    "createWithTimestamps((address,address,uint128,address,bool,bool,(uint40,uint40,uint40),(address,uint256)))",
                    params
                ),
                Enum.Operation.Call
            );

            unchecked {
                ++i;
            }
        }
    }

    function createAdminHatAndAccount(
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

        hatsProtocol.mintHat(
            hatId,
            address(new DecentAutonomousAdmin("0_0_1", adminHatId))
        );
    }

    function createElectionModuleAndExecuteFirstTerm(
        IHats hatsProtocol,
        IHatsModuleFactory hatsModuleFactory,
        address hatsElectionEligibilityImplementation,
        uint256 hatId,
        uint128 termEndDateTs,
        address[] memory nominatedWearer,
        bytes memory otherImmutableArgs,
        uint256 saltNonce
    ) internal returns (address) {
        address electionModuleAddress = hatsModuleFactory.createHatsModule(
            hatsElectionEligibilityImplementation,
            hatId,
            otherImmutableArgs,
            abi.encode(termEndDateTs),
            saltNonce
        );
        hatsProtocol.changeHatEligibility(hatId, electionModuleAddress);

        IHatsElectionEligibility(electionModuleAddress).elect(
            termEndDateTs,
            nominatedWearer
        );
        IHatsElectionEligibility(electionModuleAddress).startNextTerm();
        return electionModuleAddress;
    }

    function createAndDeclareTree(CreateTreeParams calldata params) public {
        bytes32 salt = getSalt();

        (uint256 topHatId, address topHatAccount) = createTopHatAndAccount(
            params.hatsProtocol,
            params.topHatDetails,
            params.topHatImageURI,
            params.registry,
            params.hatsAccountImplementation,
            salt
        );

        updateKeyValuePairs(params.keyValuePairs, topHatId);

        (uint256 adminHatId, ) = createAdminHatAndAccount(
            params.hatsProtocol,
            topHatId,
            params.adminHat,
            topHatAccount,
            params.registry,
            params.hatsAccountImplementation,
            salt
        );

        for (uint256 i = 0; i < params.hats.length; ) {
            createHatAndAccountAndMintAndStreams(
                params.hatsProtocol,
                adminHatId,
                params.hats[i],
                topHatAccount,
                params.registry,
                params.hatsAccountImplementation,
                salt,
                params.hatsModuleFactory,
                params.hatsElectionEligibilityImplementation,
                topHatId
            );

            unchecked {
                ++i;
            }
        }

        params.hatsProtocol.transferHat(topHatId, address(this), msg.sender);
    }
}
