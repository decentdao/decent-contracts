// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {ITokenAdapterBaseV1} from "./ITokenAdapterBaseV1.sol";

interface ITokenAdapterV1 is ITokenAdapterBaseV1 {
    function weightOf(
        address _voter,
        uint32 _proposalId,
        bytes calldata _adapterVoteData
    ) external view returns (uint256 weight);
}
