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
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ModuleProxyFactory} from "@gnosis.pm/zodiac/contracts/factory/ModuleProxyFactory.sol";

contract DecentHats_0_2_0 {
    string public constant NAME = "DecentHats_0_2_0";

    struct SablierStreamParams {
        ISablierV2LockupLinear sablier;
        address sender;
        address asset;
        LockupLinear.Timestamps timestamps;
        LockupLinear.Broker broker;
        uint128 totalAmount;
        bool cancelable;
        bool transferable;
    }

    struct TermedParams {
        uint128 termEndDateTs;
        address[] nominatedWearers;
    }

    struct Hat {
        address wearer;
        string details;
        string imageURI;
        SablierStreamParams[] sablierParams;
        TermedParams[] termedParams;
        uint32 maxSupply;
        bool isMutable;
        bool isTermed;
    }

    struct CreateTreeParams {
        IHats hatsProtocol;
        IERC6551Registry registry;
        IHatsModuleFactory hatsModuleFactory;
        ModuleProxyFactory moduleProxyFactory;
        address decentAutonomousAdminMasterCopy;
        address hatsAccountImplementation;
        address keyValuePairs;
        address hatsElectionEligibilityImplementation;
        Hat adminHat;
        Hat[] hats;
        string topHatDetails;
        string topHatImageURI;
    }

    /* /////////////////////////////////////////////////////////////////////////////
                        EXTERNAL FUNCTIONS
    ///////////////////////////////////////////////////////////////////////////// */
    function createAndDeclareTree(CreateTreeParams calldata params) public {
        bytes32 salt = _getSalt();

        (uint256 topHatId, address topHatAccount) = _createTopHatAndAccount(
            params.hatsProtocol,
            params.topHatDetails,
            params.topHatImageURI,
            params.registry,
            params.hatsAccountImplementation,
            salt
        );

        _updateKeyValuePairs(params.keyValuePairs, topHatId);

        (uint256 adminHatId, ) = _createAdminHatAndAccount(
            params.hatsProtocol,
            params.registry,
            params.moduleProxyFactory,
            params.decentAutonomousAdminMasterCopy,
            params.hatsAccountImplementation,
            topHatAccount,
            topHatId,
            params.adminHat,
            salt
        );

        for (uint256 i = 0; i < params.hats.length; ) {
            (uint256 hatId, ) = _createHatAndAccountAndMintAndStreams(
                params.hatsProtocol,
                params.registry,
                topHatAccount,
                params.hatsAccountImplementation,
                adminHatId,
                params.hats[i],
                salt
            );

            if (params.hats[i].isTermed) {
                // Create election module and set as eligiblity, elect, and start next term
                _createElectionModuleAndExecuteFirstTerm(
                    params.hatsProtocol,
                    params.hatsModuleFactory,
                    params.hatsElectionEligibilityImplementation,
                    hatId,
                    topHatId,
                    params.hats[i].termedParams[0],
                    uint256(keccak256(abi.encode(salt, hatId)))
                );
            }

            unchecked {
                ++i;
            }
        }

        params.hatsProtocol.transferHat(topHatId, address(this), msg.sender);
    }

    /* /////////////////////////////////////////////////////////////////////////////
                        INTERAL FUNCTIONS
    ///////////////////////////////////////////////////////////////////////////// */

    function _getSalt() internal view returns (bytes32 salt) {
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

    function _updateKeyValuePairs(
        address _keyValuePairs,
        uint256 topHatId
    ) internal {
        string[] memory keys = new string[](2);
        string[] memory values = new string[](2);
        keys[0] = "topHatId";
        values[0] = Strings.toString(topHatId);
        keys[1] = "decentHatsAddress";
        values[1] = Strings.toHexString(address(this));

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

    function _createHat(
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

    function _createAccount(
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

    function _createTopHatAndAccount(
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

        topHatAccount = _createAccount(
            _registry,
            _hatsAccountImplementation,
            salt,
            address(_hatsProtocol),
            topHatId
        );
    }

    function _createHatAndAccountAndMintAndStreams(
        IHats hatsProtocol,
        IERC6551Registry registry,
        address topHatAccount,
        address hatsAccountImplementation,
        uint256 adminHatId,
        Hat calldata hat,
        bytes32 salt
    ) internal returns (uint256 hatId, address accountAddress) {
        hatId = _createHat(hatsProtocol, adminHatId, hat, topHatAccount);

        accountAddress = _createAccount(
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

    function _createAdminHatAndAccount(
        IHats hatsProtocol,
        IERC6551Registry registry,
        ModuleProxyFactory moduleProxyFactory,
        address decentAutonomousAdminMasterCopy,
        address hatsAccountImplementation,
        address topHatAccount,
        uint256 topHatId,
        Hat calldata hat,
        bytes32 salt
    ) internal returns (uint256 adminHatId, address accountAddress) {
        adminHatId = _createHat(hatsProtocol, topHatId, hat, topHatAccount);

        accountAddress = _createAccount(
            registry,
            hatsAccountImplementation,
            salt,
            address(hatsProtocol),
            adminHatId
        );

        hatsProtocol.mintHat(
            adminHatId,
            moduleProxyFactory.deployModule(
                decentAutonomousAdminMasterCopy,
                abi.encodeWithSignature("setUp()"),
                uint256(keccak256(abi.encodePacked(salt, adminHatId)))
            )
        );
    }

    function _getCreationCode(
        uint256 _adminHatId
    ) internal pure returns (bytes memory) {
        bytes memory bytecode = type(DecentAutonomousAdmin).creationCode;
        bytes memory constructorArgs = abi.encode(_adminHatId);
        return abi.encodePacked(bytecode, constructorArgs);
    }

    function _createElectionModuleAndExecuteFirstTerm(
        IHats hatsProtocol,
        IHatsModuleFactory hatsModuleFactory,
        address hatsElectionEligibilityImplementation,
        uint256 hatId,
        uint256 topHatId,
        TermedParams calldata termedParams,
        uint256 saltNonce
    ) internal returns (address) {
        address electionModuleAddress = hatsModuleFactory.createHatsModule(
            hatsElectionEligibilityImplementation,
            hatId,
            abi.encode(topHatId, uint256(0)),
            abi.encode(termedParams.termEndDateTs),
            saltNonce
        );
        hatsProtocol.changeHatEligibility(hatId, electionModuleAddress);

        IHatsElectionEligibility(electionModuleAddress).elect(
            termedParams.termEndDateTs,
            termedParams.nominatedWearers
        );

        return electionModuleAddress;
    }
}
