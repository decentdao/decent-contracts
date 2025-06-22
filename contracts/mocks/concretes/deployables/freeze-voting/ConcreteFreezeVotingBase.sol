// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {FreezeVotingBase} from "../../../../deployables/freeze-voting/FreezeVotingBase.sol";

contract ConcreteFreezeVotingBase is FreezeVotingBase {
    function initialize(
        address owner_,
        uint256 freezeVotesThreshold_,
        uint32 freezeProposalPeriod_,
        uint32 freezePeriod_
    ) public initializer {
        __Ownable_init(owner_);
        FreezeVotingBaseStorage storage $base = _getFreezeVotingBaseStorage();
        $base.freezeVotesThreshold = freezeVotesThreshold_;
        $base.freezeProposalPeriod = freezeProposalPeriod_;
        $base.freezePeriod = freezePeriod_;
    }

    function castFreezeVote() external {
        // If no freeze proposal exists yet, create one
        FreezeVotingBaseStorage storage $base = _getFreezeVotingBaseStorage();
        if ($base.freezeProposalCreated == 0) {
            _initializeFreezeVote();
        }

        // Check if proposal period has expired
        require(
            block.timestamp <=
                $base.freezeProposalCreated + $base.freezeProposalPeriod,
            "Freeze proposal period expired"
        );

        _recordFreezeVote(msg.sender, 1);
    }
}
