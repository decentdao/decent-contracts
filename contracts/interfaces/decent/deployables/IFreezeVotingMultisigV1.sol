// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

interface IFreezeVotingMultisigV1 {
    // --- Events ---

    event FreezeProposalCreated(address indexed creator);

    // --- Initializer Functions ---

    function initialize(
        address owner_,
        uint256 freezeVotesThreshold_,
        uint32 freezeProposalPeriod_,
        uint32 freezePeriod_,
        address parentSafe_,
        address lightAccountFactory
    ) external;

    // --- View Functions ---

    function parentSafe() external view returns (address parentSafe);

    function accountHasFreezeVoted(
        uint48 freezeProposalCreated_,
        address account_
    ) external view returns (bool accountHasFreezeVoted);

    // --- State-Changing Functions ---

    function castFreezeVote(uint256 lightAccountIndex_) external;
}
