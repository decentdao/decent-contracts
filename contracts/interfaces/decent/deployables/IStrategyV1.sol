// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

interface IStrategyV1 {
    // --- Errors ---

    error InvalidProposerAdapter();
    error NoVotingAdapters();
    error NoProposerAdapters();
    error InvalidBasisNumerator();
    error InvalidStrategyAdmin();
    error ProposalNotActive();
    error NoVotingAdapterVotingWeight(address votingAdapter);
    error InvalidVoteType();
    error ProposalNotInitialized();
    error InvalidVotingAdapter(address votingAdapter);
    error InvalidAddress();

    // --- Structs ---

    struct ProposalVotingDetails {
        uint48 votingStartTimestamp;
        uint48 votingEndTimestamp;
        uint32 votingStartBlock;
        uint256 yesVotes;
        uint256 noVotes;
        uint256 abstainVotes;
    }

    struct VotingAdapterVoteData {
        address votingAdapter;
        bytes adapterVoteData;
    }

    // --- Enums ---

    enum VoteType {
        NO,
        YES,
        ABSTAIN
    }

    // --- Events ---

    event Voted(
        address indexed voter,
        uint32 indexed proposalId,
        VoteType voteType,
        uint256 totalWeightCastedInTx
    );
    event ProposalInitialized(
        uint32 indexed proposalId,
        uint48 votingStartTimestamp,
        uint48 votingEndTimestamp,
        uint32 votingStartBlock
    );
    event FreezeVoterAuthorizationChanged(
        address indexed freezeVoterContract,
        bool isAuthorized
    );
    event VotingPeriodEnded(uint32 indexed proposalId);

    // --- Initializer Functions ---

    function initialize(
        uint32 votingPeriod_,
        uint256 quorumThreshold_,
        uint256 basisNumerator_,
        address[] calldata proposerAdapters_,
        address lightAccountFactory_
    ) external;

    function initialize2(
        address strategyAdmin_,
        address[] calldata votingAdapters_
    ) external;

    // --- View Functions ---

    function isProposer(
        address address_,
        address proposerAdapter_,
        bytes calldata proposerAdapterData_
    ) external view returns (bool isProposer);

    function isPassed(uint32 proposalId_) external view returns (bool isPassed);

    function getVotingTimestamps(
        uint32 proposalId_
    ) external view returns (uint48 startTime, uint48 endTime);

    function getVotingStartBlock(
        uint32 proposalId_
    ) external view returns (uint32 votingStartBlock);

    function isVotingAdapter(
        address votingAdapter_
    ) external view returns (bool isVotingAdapter);

    function isProposerAdapter(
        address proposerAdapter_
    ) external view returns (bool isProposerAdapter);

    function strategyAdmin() external view returns (address strategyAdmin);

    function votingPeriod() external view returns (uint32 votingPeriod);

    function quorumThreshold() external view returns (uint256 quorumThreshold);

    function basisNumerator() external view returns (uint256 basisNumerator);

    function proposalVotingDetails(
        uint32 proposalId_
    )
        external
        view
        returns (ProposalVotingDetails memory proposalVotingDetails);

    function votingAdapters()
        external
        view
        returns (address[] memory votingAdapters);

    function proposerAdapters()
        external
        view
        returns (address[] memory proposerAdapters);

    function isQuorumMet(
        uint32 proposalId_
    ) external view returns (bool isQuorumMet);

    function isBasisMet(
        uint32 proposalId_
    ) external view returns (bool isBasisMet);

    function isAuthorizedFreezeVoter(
        address freezeVoterContract_
    ) external view returns (bool isAuthorizedFreezeVoter);

    function authorizedFreezeVoters()
        external
        view
        returns (address[] memory authorizedFreezeVoters);

    function voteCastedAfterVotingPeriodEnded(
        uint32 proposalId_
    ) external view returns (bool voteCastedAfterVotingPeriodEnded);

    function validStrategyVote(
        address voter_,
        uint32 proposalId_,
        uint8 voteType_,
        VotingAdapterVoteData[] calldata votingAdaptersData_
    ) external view returns (bool isValid);

    // --- State-Changing Functions ---

    function initializeProposal(uint32 proposalId_) external;

    function castVote(
        uint32 proposalId_,
        uint8 voteType_,
        VotingAdapterVoteData[] calldata votingAdaptersData_,
        uint256 lightAccountIndex_
    ) external;

    function addAuthorizedFreezeVoter(address freezeVoterContract_) external;

    function removeAuthorizedFreezeVoter(address freezeVoterContract_) external;
}
