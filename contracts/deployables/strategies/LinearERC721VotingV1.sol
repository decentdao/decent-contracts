// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

import {Version} from "../Version.sol";
import {IERC721VotingWeightV1, ERC721VotingWeight, ERC721VotingToken} from "../../interfaces/decent/deployables/IERC721VotingWeightV1.sol";
import {IERC721VotingStrategyV1} from "../../interfaces/decent/deployables/IERC721VotingStrategyV1.sol";
import {BaseVotingBasisPercentV1} from "./BaseVotingBasisPercentV1.sol";
import {BaseStrategyV1} from "./BaseStrategyV1.sol";
import {ERC4337VoterSupportV1} from "./ERC4337VoterSupportV1.sol";
import {ERC721VotingWeightSupportV1} from "./ERC721VotingWeightSupportV1.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ProposalVotesV1} from "./ProposalVotesV1.sol";

/**
 * An Azorius strategy that allows multiple ERC721 tokens to be registered as governance tokens,
 * each with their own voting weight.
 *
 * This is slightly different from ERC-20 voting, since there is no way to snapshot ERC721 holdings.
 * Each ERC721 id can vote once, reguardless of what address held it when a proposal was created.
 *
 * Also, this uses "quorumThreshold" rather than LinearERC20Voting's quorumPercent, because the
 * total supply of NFTs is not knowable within the IERC721 interface.  This is similar to a multisig
 * "total signers" required, rather than a percentage of the tokens.
 */
contract LinearERC721VotingV1 is
    BaseStrategyV1,
    BaseVotingBasisPercentV1,
    IERC721VotingStrategyV1,
    ERC4337VoterSupportV1,
    Version,
    IERC721VotingWeightV1,
    ERC721VotingWeightSupportV1
{
    uint16 private constant VERSION = 1;

    /**
     * The voting options for a Proposal.
     */
    enum VoteType {
        NO, // disapproves of executing the Proposal
        YES, // approves of executing the Proposal
        ABSTAIN // neither YES nor NO, i.e. voting "present"
    }

    /** `proposalId` to `ProposalVotes`, the voting state of a Proposal. */
    mapping(uint256 => ProposalVotesV1) public proposalVotes;

    /** The list of ERC-721 tokens that can vote. */
    address[] public tokenAddresses;

    /** ERC-721 address to its voting weight per NFT id.  */
    mapping(address => uint256) public tokenWeights;

    /** Number of blocks a new Proposal can be voted on. */
    uint32 public votingPeriod;

    /**
     * The total number of votes required to achieve quorum.
     * "Quorum threshold" is used instead of a quorum percent because IERC721 has no
     * totalSupply function, so the contract cannot determine this.
     */
    uint256 public quorumThreshold;

    /**
     * The minimum number of voting power required to create a new proposal.
     */
    uint256 public proposerThreshold;

    event VotingPeriodUpdated(uint32 votingPeriod);
    event QuorumThresholdUpdated(uint256 quorumThreshold);
    event ProposerThresholdUpdated(uint256 proposerThreshold);
    event ProposalInitialized(uint32 proposalId, uint48 votingEndTimestamp);
    event Voted(
        address voter,
        uint32 proposalId,
        uint8 voteType,
        address[] tokenAddresses,
        uint256[] tokenIds
    );
    event GovernanceTokenAdded(address token, uint256 weight);
    event GovernanceTokenRemoved(address token);

    error InvalidParams();
    error InvalidProposal();
    error VotingEnded();
    error InvalidVote();
    error InvalidTokenAddress();
    error NoVotingWeight();
    error TokenAlreadySet();
    error TokenNotSet();
    error IdAlreadyVoted(uint256 tokenId);
    error IdNotOwned(uint256 tokenId);

    /**
     * Sets up the contract with its initial parameters.
     *
     * @param initializeParams encoded initialization parameters: `address _owner`,
     * `address[] memory _tokens`, `uint256[] memory _weights`, `address _azoriusModule`,
     * `uint32 _votingPeriod`, `uint256 _quorumThreshold`, `uint256 _proposerThreshold`,
     * `uint256 _basisNumerator`
     */
    function setUp(
        bytes memory initializeParams
    ) public virtual override initializer {
        (
            address _owner,
            address[] memory _tokens,
            uint256[] memory _weights,
            address _azoriusModule,
            uint32 _votingPeriod,
            uint256 _quorumThreshold,
            uint256 _proposerThreshold,
            uint256 _basisNumerator
        ) = abi.decode(
                initializeParams,
                (
                    address,
                    address[],
                    uint256[],
                    address,
                    uint32,
                    uint256,
                    uint256,
                    uint256
                )
            );

        if (_tokens.length != _weights.length) {
            revert InvalidParams();
        }

        for (uint i = 0; i < _tokens.length; ) {
            _addGovernanceToken(_tokens[i], _weights[i]);
            unchecked {
                ++i;
            }
        }

        __Ownable_init(_owner);
        _setAzorius(_azoriusModule);
        _updateQuorumThreshold(_quorumThreshold);
        _updateProposerThreshold(_proposerThreshold);
        _updateBasisNumerator(_basisNumerator);
        _updateVotingPeriod(_votingPeriod);

        emit StrategySetUp(_azoriusModule, _owner);
    }

    /**
     * Adds a new ERC-721 token as a governance token, along with its associated weight.
     *
     * @param _tokenAddress the address of the ERC-721 token
     * @param _weight the number of votes each NFT id is worth
     */
    function addGovernanceToken(
        address _tokenAddress,
        uint256 _weight
    ) external virtual onlyOwner {
        _addGovernanceToken(_tokenAddress, _weight);
    }

    /**
     * Updates the voting time period for new Proposals.
     *
     * @param _votingPeriod voting time period (in blocks)
     */
    function updateVotingPeriod(
        uint32 _votingPeriod
    ) external virtual onlyOwner {
        _updateVotingPeriod(_votingPeriod);
    }

    /**
     * Updates the quorum required for future Proposals.
     *
     * @param _quorumThreshold total voting weight required to achieve quorum
     */
    function updateQuorumThreshold(
        uint256 _quorumThreshold
    ) external virtual onlyOwner {
        _updateQuorumThreshold(_quorumThreshold);
    }

    /**
     * Updates the voting weight required to submit new Proposals.
     *
     * @param _proposerThreshold required voting weight
     */
    function updateProposerThreshold(
        uint256 _proposerThreshold
    ) external virtual onlyOwner {
        _updateProposerThreshold(_proposerThreshold);
    }

    /**
     * Returns whole list of governance tokens addresses
     */
    function getAllTokenAddresses()
        external
        view
        virtual
        returns (address[] memory)
    {
        return tokenAddresses;
    }

    /**
     * Returns the current state of the specified Proposal.
     *
     * @param _proposalId id of the Proposal
     * @return noVotes current count of "NO" votes
     * @return yesVotes current count of "YES" votes
     * @return abstainVotes current count of "ABSTAIN" votes
     * @return startTimestamp timestamp voting starts
     * @return endTimestamp timestamp voting ends
     */
    function getProposalVotes(
        uint32 _proposalId
    )
        external
        view
        virtual
        returns (
            uint256 noVotes,
            uint256 yesVotes,
            uint256 abstainVotes,
            uint48 startTimestamp,
            uint48 endTimestamp
        )
    {
        noVotes = proposalVotes[_proposalId].noVotes;
        yesVotes = proposalVotes[_proposalId].yesVotes;
        abstainVotes = proposalVotes[_proposalId].abstainVotes;
        startTimestamp = proposalVotes[_proposalId].votingStartTimestamp;
        endTimestamp = proposalVotes[_proposalId].votingEndTimestamp;
    }

    /**
     * Submits a vote on an existing Proposal.
     *
     * @param _proposalId id of the Proposal to vote on
     * @param _voteType Proposal support as defined in VoteType (NO, YES, ABSTAIN)
     * @param _tokenAddresses list of ERC-721 addresses that correspond to ids in _tokenIds
     * @param _tokenIds list of unique token ids that correspond to their ERC-721 address in _tokenAddresses
     */
    function vote(
        uint32 _proposalId,
        uint8 _voteType,
        address[] memory _tokenAddresses,
        uint256[] memory _tokenIds
    ) external virtual {
        if (_tokenAddresses.length != _tokenIds.length) revert InvalidParams();
        _vote(
            _proposalId,
            _voter(msg.sender),
            _voteType,
            _tokenAddresses,
            _tokenIds
        );
    }

    /** @inheritdoc IERC721VotingStrategyV1*/
    function getTokenWeight(
        address _tokenAddress
    ) external view virtual override returns (uint256) {
        return tokenWeights[_tokenAddress];
    }

    /**
     * Returns whether an NFT id has already voted.
     *
     * @param _proposalId the id of the Proposal
     * @param _tokenAddress the ERC-721 contract address
     * @param _tokenId the unique id of the NFT
     */
    function hasVoted(
        uint32 _proposalId,
        address _tokenAddress,
        uint256 _tokenId
    ) external view virtual returns (bool) {
        return proposalVotes[_proposalId].hasVoted[_tokenAddress][_tokenId];
    }

    /**
     * Removes the given ERC-721 token address from the list of governance tokens.
     *
     * @param _tokenAddress the ERC-721 token to remove
     */
    function removeGovernanceToken(
        address _tokenAddress
    ) external virtual onlyOwner {
        if (tokenWeights[_tokenAddress] == 0) revert TokenNotSet();

        tokenWeights[_tokenAddress] = 0;

        uint256 length = tokenAddresses.length;
        for (uint256 i = 0; i < length; ) {
            if (_tokenAddress == tokenAddresses[i]) {
                uint256 last = length - 1;
                tokenAddresses[i] = tokenAddresses[last]; // move the last token into the position to remove
                delete tokenAddresses[last]; // delete the last token
                break;
            }
            unchecked {
                ++i;
            }
        }

        emit GovernanceTokenRemoved(_tokenAddress);
    }

    /** @inheritdoc BaseStrategyV1*/
    function initializeProposal(
        bytes memory _data
    ) public virtual override onlyAzorius {
        uint32 proposalId = abi.decode(_data, (uint32));
        uint48 _votingEndTimestamp = uint48(block.timestamp) + votingPeriod;

        proposalVotes[proposalId].votingEndTimestamp = _votingEndTimestamp;
        proposalVotes[proposalId].votingStartTimestamp = uint48(
            block.timestamp
        );

        emit ProposalInitialized(proposalId, _votingEndTimestamp);
    }

    /** @inheritdoc BaseStrategyV1*/
    function isPassed(
        uint32 _proposalId
    ) public view virtual override returns (bool) {
        return (block.timestamp >
            proposalVotes[_proposalId].votingEndTimestamp && // voting period has ended
            quorumThreshold <=
            proposalVotes[_proposalId].yesVotes +
                proposalVotes[_proposalId].abstainVotes && // yes + abstain votes meets the quorum
            meetsBasis(
                proposalVotes[_proposalId].yesVotes,
                proposalVotes[_proposalId].noVotes
            )); // yes votes meets the basis
    }

    /** @inheritdoc BaseStrategyV1*/
    function isProposer(
        address _address
    ) public view virtual override returns (bool) {
        uint256 totalWeight = 0;
        for (uint i = 0; i < tokenAddresses.length; ) {
            address tokenAddress = tokenAddresses[i];
            totalWeight +=
                IERC721(tokenAddress).balanceOf(_address) *
                tokenWeights[tokenAddress];
            unchecked {
                ++i;
            }
        }
        return totalWeight >= proposerThreshold;
    }

    /** @inheritdoc BaseStrategyV1*/
    function votingEndTimestamp(
        uint32 _proposalId
    ) public view virtual override returns (uint48) {
        return proposalVotes[_proposalId].votingEndTimestamp;
    }

    /** Internal implementation of `addGovernanceToken` */
    function _addGovernanceToken(
        address _tokenAddress,
        uint256 _weight
    ) internal virtual {
        if (!IERC721(_tokenAddress).supportsInterface(0x80ac58cd))
            revert InvalidTokenAddress();

        if (_weight == 0) revert NoVotingWeight();

        if (tokenWeights[_tokenAddress] > 0) revert TokenAlreadySet();

        tokenAddresses.push(_tokenAddress);
        tokenWeights[_tokenAddress] = _weight;

        emit GovernanceTokenAdded(_tokenAddress, _weight);
    }

    /** Internal implementation of `updateVotingPeriod`. */
    function _updateVotingPeriod(uint32 _votingPeriod) internal virtual {
        votingPeriod = _votingPeriod;
        emit VotingPeriodUpdated(_votingPeriod);
    }

    /** Internal implementation of `updateQuorumThreshold`. */
    function _updateQuorumThreshold(uint256 _quorumThreshold) internal virtual {
        quorumThreshold = _quorumThreshold;
        emit QuorumThresholdUpdated(quorumThreshold);
    }

    /** Internal implementation of `updateProposerThreshold`. */
    function _updateProposerThreshold(
        uint256 _proposerThreshold
    ) internal virtual {
        proposerThreshold = _proposerThreshold;
        emit ProposerThresholdUpdated(_proposerThreshold);
    }

    /**
     * Internal function for casting a vote on a Proposal.
     *
     * @param _proposalId id of the Proposal
     * @param _voter address casting the vote
     * @param _voteType vote support, as defined in VoteType
     * @param _tokenAddresses list of ERC-721 addresses that correspond to ids in _tokenIds
     * @param _tokenIds list of unique token ids that correspond to their ERC-721 address in _tokenAddresses
     */
    function _vote(
        uint32 _proposalId,
        address _voter,
        uint8 _voteType,
        address[] memory _tokenAddresses,
        uint256[] memory _tokenIds
    ) internal virtual {
        uint256 weight;

        // verifies the voter holds the NFTs and returns the total weight associated with their tokens
        // the frontend will need to determine whether an address can vote on a proposal, as it is possible
        // to vote twice if you get more weight later on
        for (uint256 i = 0; i < _tokenAddresses.length; ) {
            address tokenAddress = _tokenAddresses[i];
            uint256 tokenId = _tokenIds[i];

            if (_voter != IERC721(tokenAddress).ownerOf(tokenId)) {
                revert IdNotOwned(tokenId);
            }

            if (
                proposalVotes[_proposalId].hasVoted[tokenAddress][tokenId] ==
                true
            ) {
                revert IdAlreadyVoted(tokenId);
            }

            weight += tokenWeights[tokenAddress];
            proposalVotes[_proposalId].hasVoted[tokenAddress][tokenId] = true;
            unchecked {
                ++i;
            }
        }

        if (weight == 0) revert NoVotingWeight();

        ProposalVotesV1 storage proposal = proposalVotes[_proposalId];

        if (proposal.votingEndTimestamp == 0) revert InvalidProposal();

        if (block.timestamp > proposal.votingEndTimestamp) revert VotingEnded();

        if (_voteType == uint8(VoteType.NO)) {
            proposal.noVotes += weight;
        } else if (_voteType == uint8(VoteType.YES)) {
            proposal.yesVotes += weight;
        } else if (_voteType == uint8(VoteType.ABSTAIN)) {
            proposal.abstainVotes += weight;
        } else {
            revert InvalidVote();
        }

        emit Voted(_voter, _proposalId, _voteType, _tokenAddresses, _tokenIds);
    }

    /**
     * Implementation of version
     */
    function getVersion() public view virtual override returns (uint16) {
        return VERSION;
    }

    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        virtual
        override(BaseStrategyV1, BaseVotingBasisPercentV1, Version)
        returns (bool)
    {
        return
            interfaceId == type(IERC721VotingStrategyV1).interfaceId ||
            interfaceId == type(ERC4337VoterSupportV1).interfaceId ||
            interfaceId == type(ERC721VotingWeightSupportV1).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    /** @inheritdoc IERC721VotingWeightV1*/
    function getCurrentVotingWeight(
        address _voter,
        address[] calldata _tokenAddresses,
        uint256[] calldata _tokenIds
    ) external view override returns (uint256) {
        return
            _getCurrentVotingWeight(
                _voter,
                tokenWeights,
                _tokenAddresses,
                _tokenIds
            );
    }

    /** @inheritdoc IERC721VotingWeightV1*/
    function getVotingWeight(
        address _voter,
        uint32 _proposalId,
        address[] calldata _tokenAddresses,
        uint256[] calldata _tokenIds
    ) public view override returns (ERC721VotingWeight memory) {
        return
            _getVotingWeight(
                _voter,
                _proposalId,
                tokenWeights,
                proposalVotes,
                _tokenAddresses,
                _tokenIds
            );
    }
}
