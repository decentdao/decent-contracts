// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {ITokenAdapterV1} from "../../../interfaces/decent/deployables/ITokenAdapterV1.sol";
import {ITokenAdapterBaseV1} from "../../../interfaces/decent/deployables/ITokenAdapterBaseV1.sol";
import {IStrategyBaseV1} from "../../../interfaces/decent/deployables/IStrategyBaseV1.sol";
import {Version} from "../../Version.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract ERC721TokenAdapterV1 is
    ITokenAdapterV1,
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ERC165,
    Version
{
    IERC721 public token;
    IStrategyBaseV1 public strategy;
    uint256 public weightPerNft;

    mapping(uint32 => mapping(uint256 => bool)) public nftUsedForVote;

    uint16 public constant VERSION = 1;

    event TokenAdapterParametersUpdated(uint256 newWeightPerNft);

    error InvalidTokenAddress();
    error InvalidStrategyAddress();
    error InvalidWeightPerNft();

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _initialOwner,
        address _token,
        address _strategy,
        uint256 _weightPerNft
    ) external virtual initializer {
        __Ownable_init(_initialOwner);
        __UUPSUpgradeable_init();

        if (_token == address(0)) revert InvalidTokenAddress();
        if (_strategy == address(0)) revert InvalidStrategyAddress();

        token = IERC721(_token);
        strategy = IStrategyBaseV1(_strategy);

        _updateWeightPerNft(_weightPerNft);

        emit TokenAdapterParametersUpdated(weightPerNft);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal virtual override onlyOwner {}

    function updateWeightPerNft(
        uint256 _newWeightPerNft
    ) external virtual onlyOwner {
        _updateWeightPerNft(_newWeightPerNft);
        emit TokenAdapterParametersUpdated(weightPerNft);
    }

    function _updateWeightPerNft(uint256 _newWeightPerNft) internal virtual {
        if (_newWeightPerNft == 0) revert InvalidWeightPerNft();
        weightPerNft = _newWeightPerNft;
    }

    function _getValidUnvotedTokenIdsAndWeight(
        address _voter,
        uint32 _proposalId,
        bytes calldata _adapterVoteData
    )
        internal
        view
        virtual
        returns (
            uint256[] memory validTokenIdsForThisCall,
            uint256 totalCalculatedWeight
        )
    {
        uint256[] memory tokenIds = abi.decode(_adapterVoteData, (uint256[]));

        if (tokenIds.length == 0) {
            return (new uint256[](0), 0);
        }

        uint256[] memory tempValidTokenIds = new uint256[](tokenIds.length);
        uint256 validCount = 0;

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            if (token.ownerOf(tokenId) != _voter) {
                continue;
            }

            if (nftUsedForVote[_proposalId][tokenId]) {
                continue;
            }

            bool alreadyProcessedInThisCall = false;
            for (uint256 j = 0; j < validCount; j++) {
                if (tempValidTokenIds[j] == tokenId) {
                    alreadyProcessedInThisCall = true;
                    break;
                }
            }

            if (!alreadyProcessedInThisCall) {
                tempValidTokenIds[validCount] = tokenId;
                validCount++;
                totalCalculatedWeight += weightPerNft;
            }
        }

        validTokenIdsForThisCall = new uint256[](validCount);
        for (uint256 i = 0; i < validCount; i++) {
            validTokenIdsForThisCall[i] = tempValidTokenIds[i];
        }
    }

    function weightOf(
        address _voter,
        uint32 _proposalId,
        bytes calldata _adapterVoteData
    ) external view virtual override returns (uint256 weight) {
        (, uint256 totalCalculatedWeight) = _getValidUnvotedTokenIdsAndWeight(
            _voter,
            _proposalId,
            _adapterVoteData
        );
        weight = totalCalculatedWeight;
    }

    function recordVote(
        address _voter,
        uint32 _proposalId,
        bytes calldata _adapterVoteData
    ) external virtual override returns (uint256 weightCasted) {
        (
            uint256[] memory validTokenIdsToRecord,
            uint256 totalCalculatedWeight
        ) = _getValidUnvotedTokenIdsAndWeight(
                _voter,
                _proposalId,
                _adapterVoteData
            );

        for (uint256 i = 0; i < validTokenIdsToRecord.length; i++) {
            nftUsedForVote[_proposalId][validTokenIdsToRecord[i]] = true;
        }
        weightCasted = totalCalculatedWeight;

        emit VoteRecorded(_voter, _proposalId, weightCasted, _adapterVoteData);
    }

    function getVersion() public pure virtual override returns (uint16) {
        return VERSION;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(ERC165, Version) returns (bool) {
        return
            interfaceId == type(ITokenAdapterV1).interfaceId ||
            interfaceId == type(ITokenAdapterBaseV1).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
