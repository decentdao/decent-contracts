// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IERC721VotingWeightV1, ERC721VotingToken, ERC721VotingWeight} from "../../interfaces/decent/deployables/IERC721VotingWeightV1.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ProposalVotesV1} from "./ProposalVotesV1.sol";

abstract contract ERC721VotingWeightSupportV1 {
    function _getCurrentVotingWeight(
        address _address,
        mapping(address => uint256) storage _tokenWeights,
        address[] memory _tokenAddresses,
        uint256[] memory _tokenIds
    ) internal view returns (uint256) {
        uint256 weight;

        for (uint256 i = 0; i < _tokenAddresses.length; ) {
            address tokenAddress = _tokenAddresses[i];
            uint256 tokenId = _tokenIds[i];

            require(
                _address == IERC721(tokenAddress).ownerOf(tokenId),
                "Not owned"
            );
            weight += _tokenWeights[tokenAddress];
            unchecked {
                ++i;
            }
        }
        return weight;
    }

    function _getVotingWeight(
        address _address,
        uint32 _proposalId,
        mapping(address => uint256) storage _tokenWeights,
        mapping(uint256 => ProposalVotesV1) storage _proposalVotes,
        address[] memory _tokenAddresses,
        uint256[] memory _tokenIds
    ) internal view returns (ERC721VotingWeight memory) {
        ERC721VotingToken[] memory tokens = new ERC721VotingToken[](
            _tokenAddresses.length
        );
        uint256 weight;
        uint32 count;

        for (uint32 i = 0; i < _tokenAddresses.length; ) {
            address tokenAddress = _tokenAddresses[i];
            uint256 tokenId = _tokenIds[i];

            require(
                _address == IERC721(tokenAddress).ownerOf(tokenId),
                "Not owned"
            );

            if (
                _proposalVotes[_proposalId].hasVoted[tokenAddress][tokenId] !=
                true
            ) {
                weight += _tokenWeights[tokenAddress];
                ERC721VotingToken memory token;
                token.tokenAddress = tokenAddress;
                token.tokenId = tokenId;
                tokens[count] = token;
                count++;
            }
            unchecked {
                ++i;
            }
        }

        ERC721VotingWeight memory result;
        result.weight = weight;
        if (count == _tokenAddresses.length) {
            result.tokens = tokens;
        } else {
            // Condense the result array
            ERC721VotingToken[] memory unvoted = new ERC721VotingToken[](count);
            for (uint32 i = 0; i < count; i++) {
                unvoted[i] = tokens[i];
            }
            result.tokens = unvoted;
        }

        return result;
    }
}
