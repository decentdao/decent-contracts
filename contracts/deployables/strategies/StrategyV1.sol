// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IStrategyV1} from "../../interfaces/decent/deployables/IStrategyV1.sol";
import {IVotingAdapterBaseV1} from "../../interfaces/decent/deployables/IVotingAdapterBaseV1.sol";
import {IProposerAdapterBaseV1} from "../../interfaces/decent/deployables/IProposerAdapterBaseV1.sol";
import {IVoterResolverV1} from "../../interfaces/decent/deployables/IVoterResolverV1.sol";
import {ISmartAccountValidationV1} from "../../interfaces/decent/deployables/ISmartAccountValidationV1.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {VoterResolverV1} from "../account-abstraction/VoterResolverV1.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract StrategyV1 is
    IStrategyV1,
    IVersion,
    Initializable,
    VoterResolverV1,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    uint256 public constant BASIS_DENOMINATOR = 1_000_000;

    address internal _strategyAdmin;
    uint32 internal _votingPeriod;
    uint256 internal _quorumThreshold;
    uint256 internal _basisNumerator;
    mapping(uint32 proposalId => ProposalVotingDetails proposalVotingDetails)
        internal _proposalVotingDetails;
    address[] internal _votingAdapters;
    address[] internal _proposerAdapters;
    mapping(address votingAdapter => bool isVotingAdapter)
        internal _isVotingAdapter;
    mapping(address proposerAdapter => bool isProposerAdapter)
        internal _isProposerAdapter;
    mapping(address freezeVoterContract => bool isAuthorizedFreezeVoter)
        internal _authorizedFreezeVotersMapping;
    address[] internal _authorizedFreezeVotersArray;
    mapping(uint32 proposalId => bool voteCastedAfterVotingPeriodEnded)
        internal _voteCastedAfterVotingPeriodEnded;

    // ======================================================================
    // MODIFIERS
    // ======================================================================

    modifier onlyStrategyAdmin() {
        if (msg.sender != _strategyAdmin) revert InvalidStrategyAdmin();
        _;
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address strategyAdmin_,
        uint32 votingPeriod_,
        uint256 quorumThreshold_,
        uint256 basisNumerator_,
        address[] calldata votingAdapters_,
        address[] calldata proposerAdapters_,
        address lightAccountFactory_
    ) public virtual override initializer {
        if (votingAdapters_.length == 0) {
            revert NoVotingAdapters();
        }

        if (proposerAdapters_.length == 0) {
            revert NoProposerAdapters();
        }

        if (
            basisNumerator_ >= BASIS_DENOMINATOR ||
            basisNumerator_ < BASIS_DENOMINATOR / 2
        ) revert InvalidBasisNumerator();

        __VoterResolverV1_init(lightAccountFactory_);
        _strategyAdmin = strategyAdmin_;
        _votingPeriod = votingPeriod_;
        _quorumThreshold = quorumThreshold_;
        _basisNumerator = basisNumerator_;
        _votingAdapters = votingAdapters_;
        _proposerAdapters = proposerAdapters_;

        for (uint256 i = 0; i < votingAdapters_.length; ) {
            _isVotingAdapter[votingAdapters_[i]] = true;
            unchecked {
                ++i;
            }
        }
        for (uint256 i = 0; i < proposerAdapters_.length; ) {
            _isProposerAdapter[proposerAdapters_[i]] = true;
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
        return _strategyAdmin;
    }

    function votingPeriod() public view virtual override returns (uint32) {
        return _votingPeriod;
    }

    function quorumThreshold() public view virtual override returns (uint256) {
        return _quorumThreshold;
    }

    function basisNumerator() public view virtual override returns (uint256) {
        return _basisNumerator;
    }

    function proposalVotingDetails(
        uint32 proposalId
    ) public view virtual override returns (ProposalVotingDetails memory) {
        return _proposalVotingDetails[proposalId];
    }

    function votingAdapters()
        public
        view
        virtual
        override
        returns (address[] memory)
    {
        return _votingAdapters;
    }

    function isVotingAdapter(
        address votingAdapter_
    ) public view virtual override returns (bool) {
        return _isVotingAdapter[votingAdapter_];
    }

    function isProposerAdapter(
        address proposerAdapter_
    ) public view virtual override returns (bool) {
        return _isProposerAdapter[proposerAdapter_];
    }

    function proposerAdapters()
        public
        view
        virtual
        override
        returns (address[] memory)
    {
        return _proposerAdapters;
    }

    function voteCastedAfterVotingPeriodEnded(
        uint32 proposalId_
    ) public view virtual override returns (bool) {
        return _voteCastedAfterVotingPeriodEnded[proposalId_];
    }

    function isQuorumMet(
        uint32 proposalId_
    ) public view virtual override returns (bool) {
        ProposalVotingDetails storage proposal = _proposalVotingDetails[
            proposalId_
        ];

        if (proposal.votingEndTimestamp == 0) {
            revert ProposalNotInitialized();
        }

        uint256 totalVotesForQuorum = proposal.yesVotes + proposal.abstainVotes;
        return totalVotesForQuorum >= _quorumThreshold;
    }

    function isBasisMet(
        uint32 _proposalId
    ) public view virtual override returns (bool) {
        ProposalVotingDetails storage proposal = _proposalVotingDetails[
            _proposalId
        ];

        if (proposal.votingEndTimestamp == 0) {
            revert ProposalNotInitialized();
        }

        return
            (proposal.yesVotes * BASIS_DENOMINATOR) >
            ((proposal.yesVotes + proposal.noVotes) * _basisNumerator);
    }

    function isPassed(
        uint32 _proposalId
    ) public view virtual override returns (bool) {
        ProposalVotingDetails storage proposal = _proposalVotingDetails[
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
        if (!_isProposerAdapter[proposerAdapter_]) {
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
        ProposalVotingDetails storage details = _proposalVotingDetails[
            proposalId_
        ];
        if (details.votingEndTimestamp == 0) revert ProposalNotInitialized();
        return (details.votingStartTimestamp, details.votingEndTimestamp);
    }

    function getVotingStartBlock(
        uint32 proposalId_
    ) public view virtual override returns (uint32) {
        ProposalVotingDetails storage details = _proposalVotingDetails[
            proposalId_
        ];
        if (details.votingEndTimestamp == 0) revert ProposalNotInitialized();
        return details.votingStartBlock;
    }

    function isAuthorizedFreezeVoter(
        address freezeVoterContract_
    ) public view virtual override returns (bool) {
        return _authorizedFreezeVotersMapping[freezeVoterContract_];
    }

    function authorizedFreezeVoters()
        public
        view
        virtual
        override
        returns (address[] memory)
    {
        return _authorizedFreezeVotersArray;
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

        // get the proposal start and end timestamps to determine if the proposal exists
        ProposalVotingDetails storage details = _proposalVotingDetails[
            proposalId_
        ];

        // Check if proposal exists (will have non-zero endTimestamp if it exists)
        if (details.votingEndTimestamp == 0) {
            return false;
        }

        // Check if voting period has ended
        if (_voteCastedAfterVotingPeriodEnded[proposalId_]) {
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
            if (!_isVotingAdapter[votingAdapter]) {
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
        ProposalVotingDetails storage proposal = _proposalVotingDetails[
            proposalId_
        ];
        proposal.votingStartTimestamp = uint48(block.timestamp);
        proposal.votingEndTimestamp = uint48(block.timestamp + _votingPeriod);
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

    function vote(
        uint32 proposalId_,
        uint8 voteType_,
        VotingAdapterVoteData[] calldata votingAdaptersData
    ) public virtual override {
        if (votingAdaptersData.length == 0) {
            revert NoVotingAdapters();
        }

        address resolvedVoter = voter(msg.sender);
        ProposalVotingDetails storage proposal = _proposalVotingDetails[
            proposalId_
        ];

        if (proposal.votingEndTimestamp == 0) {
            revert ProposalNotInitialized();
        }

        if (block.timestamp > proposal.votingEndTimestamp) {
            if (!_voteCastedAfterVotingPeriodEnded[proposalId_]) {
                _voteCastedAfterVotingPeriodEnded[proposalId_] = true;
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

            if (!_isVotingAdapter[votingAdapter]) {
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
        if (!_authorizedFreezeVotersMapping[freezeVoterContract_]) {
            _authorizedFreezeVotersArray.push(freezeVoterContract_);
        }
        _authorizedFreezeVotersMapping[freezeVoterContract_] = true;
        emit FreezeVoterAuthorizationChanged(freezeVoterContract_, true);
    }

    function removeAuthorizedFreezeVoter(
        address freezeVoterContract_
    ) public virtual override onlyStrategyAdmin {
        if (freezeVoterContract_ == address(0)) revert InvalidAddress();
        if (_authorizedFreezeVotersMapping[freezeVoterContract_]) {
            for (uint256 i = 0; i < _authorizedFreezeVotersArray.length; ) {
                if (_authorizedFreezeVotersArray[i] == freezeVoterContract_) {
                    _authorizedFreezeVotersArray[
                        i
                    ] = _authorizedFreezeVotersArray[
                        _authorizedFreezeVotersArray.length - 1
                    ];
                    _authorizedFreezeVotersArray.pop();
                    break;
                }
                unchecked {
                    ++i;
                }
            }
        }
        _authorizedFreezeVotersMapping[freezeVoterContract_] = false;
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
            interfaceId_ == type(IVoterResolverV1).interfaceId ||
            interfaceId_ == type(ISmartAccountValidationV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
