//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

/**
 * Interface of functions required for ERC-721 freeze voting associated with an ERC-721
 * voting strategy.
 */
interface IERC721VotingStrategy {

    /**
     * Returns the current token weight for the given ERC-721 token address.
     *
     * @param _tokenAddress the ERC-721 token address
     */
    function getTokenWeight(address _tokenAddress) external view returns (uint256);
}
