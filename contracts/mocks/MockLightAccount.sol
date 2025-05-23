// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {ILightAccount} from "../interfaces/light-account/ILightAccount.sol";
import {IStrategyV1} from "../interfaces/decent/deployables/IStrategyV1.sol";

contract MockLightAccount is ILightAccount {
    address private _owner;

    constructor(address initialOwner) {
        _owner = initialOwner;
    }

    function owner() external view override returns (address) {
        return _owner;
    }

    function setOwner(address newOwner) external {
        _owner = newOwner;
    }

    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external override {
        // Empty implementation - we only need this for generating calldata or other tests
    }

    // New function to interact with StrategyV1
    function callStrategyVote(
        IStrategyV1 strategy,
        uint32 proposalId,
        uint8 voteType,
        address[] calldata adaptersToUse,
        bytes[] calldata adapterVoteData
    ) external {
        // msg.sender here is the EOA calling MockLightAccount (e.g., relayer)
        // When strategy.vote is called, msg.sender from StrategyV1's perspective will be address(this)
        strategy.vote(proposalId, voteType, adaptersToUse, adapterVoteData);
    }
}
