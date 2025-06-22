// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {VotingAdapterBase} from "../../../../../deployables/strategies/adapters/voting/VotingAdapterBase.sol";
import {IStrategyV1} from "../../../../../interfaces/decent/deployables/IStrategyV1.sol";

contract ConcreteVotingAdapterBase is VotingAdapterBase {
    constructor() {
        _disableInitializers();
    }

    function initialize(address strategy_) external initializer {
        __VotingAdapterBase_init(strategy_);
    }

    // Implement IBaseVotingAdapterV1 functions
    function recordVote(
        address /*_voter*/,
        uint32 /*_proposalId*/,
        bytes calldata /*_votingAdapterVoteData*/
    ) external virtual override onlyStrategy returns (uint256 weightCasted) {
        return 123; // Dummy weight
    }

    function weightOf(
        address /*_voter*/,
        uint32 /*_proposalId*/,
        bytes calldata /*_votingAdapterVoteData*/
    ) external view virtual override returns (uint256 weight) {
        return 456; // Dummy weight
    }

    function recordFreezeVote(
        address, // voter
        uint48, // freezeProposalSnapshotAndId
        bytes calldata // adapterVoteData
    )
        external
        virtual
        override
        onlyAuthorizedFreezeVoter
        returns (uint256 weightCasted)
    {
        emit FreezeVoteRecorded(msg.sender, 0, 789, bytes("")); // Dummy emission
        return 789; // Dummy weight for freeze vote
    }

    function validVotingAdapterVote(
        address lightAccountOwner,
        uint32 proposalId,
        bytes calldata votingAdapterVoteData
    ) external view override returns (bool, uint256) {}
}
