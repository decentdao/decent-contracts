//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

interface IERC721VotingStrategy {

    function getTokenWeight(address _tokenAddress) external view returns (uint256);
}
