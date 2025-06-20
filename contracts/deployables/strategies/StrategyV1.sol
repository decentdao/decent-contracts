// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IStrategyV1} from "../../interfaces/decent/deployables/IStrategyV1.sol";
import {IVotingAdapterBaseV1} from "../../interfaces/decent/deployables/IVotingAdapterBaseV1.sol";
import {IProposerAdapterBaseV1} from "../../interfaces/decent/deployables/IProposerAdapterBaseV1.sol";
import {ILightAccountValidatorV1} from "../../interfaces/decent/deployables/ILightAccountValidatorV1.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlockV1} from "../../interfaces/decent/IDeploymentBlockV1.sol";
import {LightAccountValidatorV1} from "../account-abstraction/LightAccountValidatorV1.sol";
import {DeploymentBlockV1} from "../../DeploymentBlockV1.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract StrategyV1 is
    IStrategyV1,
    IVersion,
    DeploymentBlockV1,
    LightAccountValidatorV1,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /// @custom:storage-location erc7201:Decent.Strategy.main
    struct StrategyStorage {
        address strategyAdmin;
        uint32 votingPeriod;
        uint256 quorumThreshold;
        uint256 basisNumerator;
        mapping(uint32 proposalId => ProposalVotingDetails proposalVotingDetails) proposalVotingDetails;
        address[] votingAdapters;
        address[] proposerAdapters;
        mapping(address votingAdapter => bool isVotingAdapter) isVotingAdapter;
        mapping(address proposerAdapter => bool isProposerAdapter) isProposerAdapter;
        mapping(address freezeVoterContract => bool isAuthorizedFreezeVoter) authorizedFreezeVotersMapping;
        address[] authorizedFreezeVotersArray;
        mapping(uint32 proposalId => bool voteCastedAfterVotingPeriodEnded) voteCastedAfterVotingPeriodEnded;
    }

    // EIP-7201: keccak256(abi.encode(uint256(keccak256("Decent.Strategy.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant STRATEGY_STORAGE_LOCATION =
        0x95295deadfd7c71125b4fbd75b5d49605029b50806f286522633fd9c072a4700;

    function _getStrategyStorage()
        internal
        pure
        returns (StrategyStorage storage $)
    {
        assembly {
            $.slot := STRATEGY_STORAGE_LOCATION
        }
    }

    uint256 public constant BASIS_DENOMINATOR = 1_000_000;

    // ======================================================================
    // MODIFIERS
    // ======================================================================

    modifier onlyStrategyAdmin() {
        StrategyStorage storage $ = _getStrategyStorage();
        if (msg.sender != $.strategyAdmin) revert InvalidStrategyAdmin();
        _;
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function initialize(
        uint32 votingPeriod_,
        uint256 quorumThreshold_,
        uint256 basisNumerator_,
        address[] calldata proposerAdapters_,
        address lightAccountFactory_
    ) public virtual override initializer {
        if (proposerAdapters_.length == 0) {
            revert NoProposerAdapters();
        }

        if (
            basisNumerator_ >= BASIS_DENOMINATOR ||
            basisNumerator_ < BASIS_DENOMINATOR / 2
        ) revert InvalidBasisNumerator();

        __LightAccountValidatorV1_init(lightAccountFactory_);
        __DeploymentBlockV1_init();

        StrategyStorage storage $ = _getStrategyStorage();
        $.votingPeriod = votingPeriod_;
        $.quorumThreshold = quorumThreshold_;
        $.basisNumerator = basisNumerator_;
        $.proposerAdapters = proposerAdapters_;

        for (uint256 i = 0; i < proposerAdapters_.length; ) {
            $.isProposerAdapter[proposerAdapters_[i]] = true;
            unchecked {
                ++i;
            }
        }
    }

    function initialize2(
        address strategyAdmin_,
        address[] calldata votingAdapters_
    ) public virtual override reinitializer(2) {
        if (votingAdapters_.length == 0) {
            revert NoVotingAdapters();
        }

        StrategyStorage storage $ = _getStrategyStorage();

        $.strategyAdmin = strategyAdmin_;
        $.votingAdapters = votingAdapters_;

        for (uint256 i = 0; i < votingAdapters_.length; ) {
            $.isVotingAdapter[votingAdapters_[i]] = true;
            unchecked {
                ++i;
            }
        }
    }

    // ======================================================================
    // IStrategyV1
    // ======================================================================

    // --- View Functions ---

    function strategyAdmin() public view virtual override returns (address) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.strategyAdmin;
    }

    function votingPeriod() public view virtual override returns (uint32) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.votingPeriod;
    }

    function quorumThreshold() public view virtual override returns (uint256) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.quorumThreshold;
    }

    function basisNumerator() public view virtual override returns (uint256) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.basisNumerator;
    }

    function proposalVotingDetails(
        uint32 proposalId
    ) public view virtual override returns (ProposalVotingDetails memory) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.proposalVotingDetails[proposalId];
    }

    function votingAdapters()
        public
        view
        virtual
        override
        returns (address[] memory)
    {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.votingAdapters;
    }

    function isVotingAdapter(
        address votingAdapter_
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.isVotingAdapter[votingAdapter_];
    }

    function isProposerAdapter(
        address proposerAdapter_
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.isProposerAdapter[proposerAdapter_];
    }

    function proposerAdapters()
        public
        view
        virtual
        override
        returns (address[] memory)
    {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.proposerAdapters;
    }

    function voteCastedAfterVotingPeriodEnded(
        uint32 proposalId_
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.voteCastedAfterVotingPeriodEnded[proposalId_];
    }

    function isQuorumMet(
        uint32 proposalId_
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        ProposalVotingDetails storage proposal = $.proposalVotingDetails[
            proposalId_
        ];

        if (proposal.votingEndTimestamp == 0) {
            revert ProposalNotInitialized();
        }

        uint256 totalVotesForQuorum = proposal.yesVotes + proposal.abstainVotes;
        return totalVotesForQuorum >= $.quorumThreshold;
    }

    function isBasisMet(
        uint32 _proposalId
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        ProposalVotingDetails storage proposal = $.proposalVotingDetails[
            _proposalId
        ];

        if (proposal.votingEndTimestamp == 0) {
            revert ProposalNotInitialized();
        }

        return
            (proposal.yesVotes * BASIS_DENOMINATOR) >
            ((proposal.yesVotes + proposal.noVotes) * $.basisNumerator);
    }

    function isPassed(
        uint32 _proposalId
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        ProposalVotingDetails storage proposal = $.proposalVotingDetails[
            _proposalId
        ];

        if (proposal.votingEndTimestamp == 0) {
            revert ProposalNotInitialized();
        }

        if (block.timestamp <= proposal.votingEndTimestamp) {
            return false;
        }

        return isQuorumMet(_proposalId) && isBasisMet(_proposalId);
    }

    function isProposer(
        address address_,
        address proposerAdapter_,
        bytes calldata proposerAdapterData_
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        if (!$.isProposerAdapter[proposerAdapter_]) {
            revert InvalidProposerAdapter();
        }

        return
            IProposerAdapterBaseV1(proposerAdapter_).isProposer(
                address_,
                proposerAdapterData_
            );
    }

    function getVotingTimestamps(
        uint32 proposalId_
    ) public view virtual override returns (uint48, uint48) {
        StrategyStorage storage $ = _getStrategyStorage();
        ProposalVotingDetails storage details = $.proposalVotingDetails[
            proposalId_
        ];
        if (details.votingEndTimestamp == 0) revert ProposalNotInitialized();
        return (details.votingStartTimestamp, details.votingEndTimestamp);
    }

    function getVotingStartBlock(
        uint32 proposalId_
    ) public view virtual override returns (uint32) {
        StrategyStorage storage $ = _getStrategyStorage();
        ProposalVotingDetails storage details = $.proposalVotingDetails[
            proposalId_
        ];
        if (details.votingEndTimestamp == 0) revert ProposalNotInitialized();
        return details.votingStartBlock;
    }

    function isAuthorizedFreezeVoter(
        address freezeVoterContract_
    ) public view virtual override returns (bool) {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.authorizedFreezeVotersMapping[freezeVoterContract_];
    }

    function authorizedFreezeVoters()
        public
        view
        virtual
        override
        returns (address[] memory)
    {
        StrategyStorage storage $ = _getStrategyStorage();
        return $.authorizedFreezeVotersArray;
    }

    function validStrategyVote(
        address voter_,
        uint32 proposalId_,
        uint8 voteType_,
        VotingAdapterVoteData[] calldata votingAdaptersData_
    ) public view virtual override returns (bool) {
        if (votingAdaptersData_.length == 0) {
            return false;
        }

        StrategyStorage storage $ = _getStrategyStorage();

        // get the proposal start and end timestamps to determine if the proposal exists
        ProposalVotingDetails storage details = $.proposalVotingDetails[
            proposalId_
        ];

        // Check if proposal exists (will have non-zero endTimestamp if it exists)
        if (details.votingEndTimestamp == 0) {
            return false;
        }

        // Check if voting period has ended
        if ($.voteCastedAfterVotingPeriodEnded[proposalId_]) {
            return false;
        }

        // Check if vote type is valid (NO=0, YES=1, ABSTAIN=2)
        if (voteType_ > 2) {
            return false;
        }

        uint256 totalVotingWeight = 0;

        // loop through the voting adapters and check if the vote is valid
        for (uint256 i = 0; i < votingAdaptersData_.length; ) {
            VotingAdapterVoteData
                memory votingAdapterVoteData = votingAdaptersData_[i];
            address votingAdapter = votingAdapterVoteData.votingAdapter;

            // check if the voting adapter is attached to this strategy
            if (!$.isVotingAdapter[votingAdapter]) {
                return false;
            }

            // validVotingAdapterVote should NEVER return (true, 0)
            (bool isValid, uint256 votingWeight) = IVotingAdapterBaseV1(
                votingAdapter
            ).validVotingAdapterVote(
                    voter_,
                    proposalId_,
                    votingAdapterVoteData.adapterVoteData
                );

            if (!isValid) {
                return false;
            }

            totalVotingWeight += votingWeight;

            unchecked {
                ++i;
            }
        }

        return totalVotingWeight > 0;
    }

    // --- State-Changing Functions ---

    function initializeProposal(
        uint32 proposalId_
    ) public virtual override onlyStrategyAdmin {
        StrategyStorage storage $ = _getStrategyStorage();
        ProposalVotingDetails storage proposal = $.proposalVotingDetails[
            proposalId_
        ];
        proposal.votingStartTimestamp = uint48(block.timestamp);
        proposal.votingEndTimestamp = uint48(block.timestamp + $.votingPeriod);
        proposal.votingStartBlock = uint32(block.number);
        proposal.yesVotes = 0;
        proposal.noVotes = 0;
        proposal.abstainVotes = 0;

        emit ProposalInitialized(
            proposalId_,
            proposal.votingStartTimestamp,
            proposal.votingEndTimestamp,
            proposal.votingStartBlock
        );
    }

    function castVote(
        uint32 proposalId_,
        uint8 voteType_,
        VotingAdapterVoteData[] calldata votingAdaptersData,
        uint256 lightAccountIndex_
    ) public virtual override {
        if (votingAdaptersData.length == 0) {
            revert NoVotingAdapters();
        }

        address resolvedVoter = potentialLightAccountResolvedOwner(
            msg.sender,
            lightAccountIndex_
        );

        StrategyStorage storage $ = _getStrategyStorage();
        ProposalVotingDetails storage proposal = $.proposalVotingDetails[
            proposalId_
        ];

        if (proposal.votingEndTimestamp == 0) {
            revert ProposalNotInitialized();
        }

        if (block.timestamp > proposal.votingEndTimestamp) {
            if (!$.voteCastedAfterVotingPeriodEnded[proposalId_]) {
                $.voteCastedAfterVotingPeriodEnded[proposalId_] = true;
                emit VotingPeriodEnded(proposalId_);
                return;
            }
            revert ProposalNotActive();
        }

        uint256 totalWeightForThisVoteTransaction = 0;

        for (uint256 i = 0; i < votingAdaptersData.length; ) {
            VotingAdapterVoteData
                memory votingAdapterVoteData = votingAdaptersData[i];
            address votingAdapter = votingAdapterVoteData.votingAdapter;

            if (!$.isVotingAdapter[votingAdapter]) {
                revert InvalidVotingAdapter(votingAdapter);
            }

            uint256 votingWeight = IVotingAdapterBaseV1(votingAdapter)
                .recordVote(
                    resolvedVoter,
                    proposalId_,
                    votingAdapterVoteData.adapterVoteData
                );

            if (votingWeight == 0) {
                revert NoVotingAdapterVotingWeight(votingAdapter);
            }

            totalWeightForThisVoteTransaction += votingWeight;

            unchecked {
                ++i;
            }
        }

        if (voteType_ == uint8(VoteType.YES)) {
            proposal.yesVotes += totalWeightForThisVoteTransaction;
        } else if (voteType_ == uint8(VoteType.NO)) {
            proposal.noVotes += totalWeightForThisVoteTransaction;
        } else if (voteType_ == uint8(VoteType.ABSTAIN)) {
            proposal.abstainVotes += totalWeightForThisVoteTransaction;
        } else {
            revert InvalidVoteType();
        }

        emit Voted(
            resolvedVoter,
            proposalId_,
            VoteType(voteType_),
            totalWeightForThisVoteTransaction
        );
    }

    function addAuthorizedFreezeVoter(
        address freezeVoterContract_
    ) public virtual override onlyStrategyAdmin {
        if (freezeVoterContract_ == address(0)) revert InvalidAddress();

        StrategyStorage storage $ = _getStrategyStorage();

        if (!$.authorizedFreezeVotersMapping[freezeVoterContract_]) {
            $.authorizedFreezeVotersArray.push(freezeVoterContract_);
        }
        $.authorizedFreezeVotersMapping[freezeVoterContract_] = true;

        emit FreezeVoterAuthorizationChanged(freezeVoterContract_, true);
    }

    function removeAuthorizedFreezeVoter(
        address freezeVoterContract_
    ) public virtual override onlyStrategyAdmin {
        if (freezeVoterContract_ == address(0)) revert InvalidAddress();

        StrategyStorage storage $ = _getStrategyStorage();

        if ($.authorizedFreezeVotersMapping[freezeVoterContract_]) {
            for (uint256 i = 0; i < $.authorizedFreezeVotersArray.length; ) {
                if ($.authorizedFreezeVotersArray[i] == freezeVoterContract_) {
                    $.authorizedFreezeVotersArray[i] = $
                        .authorizedFreezeVotersArray[
                            $.authorizedFreezeVotersArray.length - 1
                        ];
                    $.authorizedFreezeVotersArray.pop();
                    break;
                }
                unchecked {
                    ++i;
                }
            }
        }

        $.authorizedFreezeVotersMapping[freezeVoterContract_] = false;

        emit FreezeVoterAuthorizationChanged(freezeVoterContract_, false);
    }

    // ======================================================================
    // IVersion
    // ======================================================================

    // --- Pure Functions ---

    function version() public pure virtual override returns (uint16) {
        return 1;
    }

    // ======================================================================
    // ERC165
    // ======================================================================

    // --- View Functions ---

    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IStrategyV1).interfaceId ||
            interfaceId_ == type(ILightAccountValidatorV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
