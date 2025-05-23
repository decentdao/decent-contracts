// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IStrategyBaseV1} from "./IStrategyBaseV1.sol";

interface IStrategyV1 is IStrategyBaseV1 {
    function updateVotingPeriod(uint32 _newVotingPeriod) external;

    function updateQuorumThreshold(uint256 _newQuorumThreshold) external;

    function updateBasisNumerator(uint256 _newBasisNumerator) external;

    function addAdapter(address _adapter) external;

    function removeAdapter(address _adapter) external;

    function getTokenAdapterCount() external view returns (uint256);
}
