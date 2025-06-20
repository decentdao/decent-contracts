// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

interface IFreezeVotingAzoriusV1 {
    // --- Errors ---

    error InvalidVotingAdapter();

    // --- Structs ---

    struct VotingAdapterVoteData {
        address votingAdapter;
        bytes adapterVoteData;
    }

    // --- Events ---

    event FreezeProposalCreated(
        address indexed proposer,
        address indexed strategy
    );

    // --- Initializer Functions ---

    function initialize(
        address owner_,
        uint256 freezeVotesThreshold_,
        uint32 freezeProposalPeriod_,
        uint32 freezePeriod_,
        address parentAzorius_,
        address lightAccountFactory_
    ) external;

    // --- View Functions ---

    function parentAzorius() external view returns (address parentAzorius);

    function freezeProposalStrategy()
        external
        view
        returns (address freezeProposalStrategy);

    // --- State-Changing Functions ---

    function castFreezeVote(
        VotingAdapterVoteData[] calldata votingAdaptersToUse_,
        uint256 lightAccountIndex_
    ) external;
}
