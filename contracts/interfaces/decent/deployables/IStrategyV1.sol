// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IStrategyBaseV1} from "./IStrategyBaseV1.sol";

interface IStrategyV1 is IStrategyBaseV1 {
    function updateVotingPeriod(uint32 _newVotingPeriod) external;

    function updateQuorumThreshold(uint256 _newQuorumThreshold) external;

    function updateBasisNumerator(uint256 _newBasisNumerator) external;

    function addTokenAdapter(address _adapter) external;

    function removeTokenAdapter(address _adapter) external;

    function getTokenAdapterCount() external view returns (uint256);

    function isQuorumMet(uint32 _proposalId) external view returns (bool);

    function isBasisMet(uint32 _proposalId) external view returns (bool);

    function vote(
        uint32 _proposalId,
        uint8 _voteType,
        address[] calldata _tokenAdaptersToUse,
        bytes[] calldata _tokenAdapterVoteData
    ) external;
}
