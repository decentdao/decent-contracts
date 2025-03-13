// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

/**
 * struct of voting weight for ERC721
 */
struct ERC721VotingToken {
    address tokenAddress;
    uint256 tokenId;
}

struct ERC721VotingWeight {
    uint256 weight;
    ERC721VotingToken[] tokens;
}

/**
 * Interface of functions for retrieving voting weights
 */
interface IERC721VotingWeightV1 {
    /**
     * Returns voting weight if a proposal is done right now
     * Will be used to gate access to draft proposals and comments
     */
    function getCurrentVotingWeight(
        address _voter,
        address[] calldata _tokenAddresses,
        uint256[] calldata _tokenIds
    ) external view returns (uint256);

    /**
     * Returns unused voting tokens for a proposal
     * FE should use the result value for the tokenAddresses and tokenIds for the vote() function
     */
    function getVotingWeight(
        address _voter,
        uint32 _proposalId,
        address[] calldata _tokenAddresses,
        uint256[] calldata _tokenIds
    ) external view returns (ERC721VotingWeight memory);
}
