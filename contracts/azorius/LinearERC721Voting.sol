// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity =0.8.19;

import { IERC721VotingStrategy } from "./interfaces/IERC721VotingStrategy.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { BaseVotingBasisPercent } from "./BaseVotingBasisPercent.sol";
import { IAzorius } from "./interfaces/IAzorius.sol";
import { BaseStrategy } from "./BaseStrategy.sol";

/**
 * Allows multiple ERC721 tokens to be registered on the strategy as governance tokens, 
 * each with their own voting weight.
 *
 * Since there is no way to snapshot ERC721 holdings, each ERC721 id can vote once, reguardless
 * of where it was when a proposal was created.
 *
 * Also, this uses "quorumThreshold" rather than quorumPercent, because total supply is not knowable
 * within the IERC721 interface.  This is similar to a multisig "total signers" required, rather than
 * a percentage of the tokens.
 */
contract LinearERC721Voting is BaseStrategy, BaseVotingBasisPercent, IERC721VotingStrategy {

    enum VoteType {
        NO, 
        YES,
        ABSTAIN
    }

    struct ProposalVotes {
        uint32 votingStartBlock;
        uint32 votingEndBlock;
        uint256 noVotes;
        uint256 yesVotes;
        uint256 abstainVotes;
        // ERC721 address to NFT id to bool
        mapping(address => mapping(uint256 => bool)) hasVoted;
    }

    address[] public tokenAddresses;
    
    mapping(address => uint256) public tokenWeights;
    
    // proposal id to proposal votes data
    mapping(uint256 => ProposalVotes) public proposalVotes;

    uint32 public votingPeriod;

    // "quorum threshold" is used instead of quorum percent because
    // IERC721 (and thus not all ERC721 tokens) has no totalSupply
    uint256 public quorumThreshold;

    uint256 public proposerThreshold;  

    event VotingPeriodUpdated(uint32 votingPeriod);
    event QuorumThresholdUpdated(uint256 quorumThreshold);
    event ProposerThresholdUpdated(uint256 proposerThreshold);
    event ProposalInitialized(uint32 proposalId, uint32 votingEndBlock);
    event Voted(address voter, uint32 proposalId, uint8 voteType, uint256 weight);
    event GovernanceTokenAdded(address token, uint256 weight);
    event GovernanceTokenRemoved(address token);

    error InvalidParams();
    error InvalidProposal();
    error VotingEnded();
    error AlreadyVoted();
    error InvalidVote();
    error InvalidTokenAddress();
    error NoVotingWeight();
    error TokenAlreadySet();
    error TokenNotSet();

    function setUp(bytes memory initializeParams) public override initializer {
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
            (address, address[], uint256[], address, uint32, uint256, uint256, uint256)
        );

        if (_tokens.length != _weights.length) {
            revert InvalidParams();
        }

        for (uint i = 0; i < _tokens.length;) {
            _addGovernanceToken(_tokens[i], _weights[i]);
            unchecked { ++i; }
        }

        __Ownable_init();
        transferOwnership(_owner);
        _setAzorius(_azoriusModule);
        _updateQuorumThreshold(_quorumThreshold);
        _updateProposerThreshold(_proposerThreshold);
        _updateBasisNumerator(_basisNumerator);
        _updateVotingPeriod(_votingPeriod);

        emit StrategySetUp(_azoriusModule, _owner);
    }

    function addGovernanceToken(address _tokenAddress, uint256 _weight) external onlyOwner {
        _addGovernanceToken(_tokenAddress, _weight);
    }

    function updateVotingPeriod(uint32 _votingPeriod) external onlyOwner {
        _updateVotingPeriod(_votingPeriod);
    }

    function updateQuorumThreshold(uint256 _quorumThreshold) external onlyOwner {
        _updateQuorumThreshold(_quorumThreshold);
    }

    function updateProposerThreshold(uint256 _proposerThreshold) external onlyOwner {
        _updateProposerThreshold(_proposerThreshold);
    }

    function getProposalVotes(uint32 _proposalId) external view
        returns (
            uint256 noVotes,
            uint256 yesVotes,
            uint256 abstainVotes,
            uint32 startBlock,
            uint32 endBlock
        )
    {
        noVotes = proposalVotes[_proposalId].noVotes;
        yesVotes = proposalVotes[_proposalId].yesVotes;
        abstainVotes = proposalVotes[_proposalId].abstainVotes;
        startBlock = proposalVotes[_proposalId].votingStartBlock;
        endBlock = proposalVotes[_proposalId].votingEndBlock;
    }

    // voting requires providing the NFT addresses and ids, as IERC721 does not have a method
    // for determining which NFT ids a particular address holds 
    function vote(uint32 _proposalId, uint8 _support, bytes memory _tokenData) external {
        ( 
            address[] memory _tokenAddresses,
            uint256[] memory _tokenIds  
        ) = abi.decode(_tokenData, (address[], uint256[]));
        if (_tokenAddresses.length != _tokenIds.length) revert InvalidParams();

        _vote(_proposalId, msg.sender, _support, _tokenAddresses, _tokenIds);
    }

    function getTokenWeight(address _tokenAddress) external view override returns (uint256) {
        return tokenWeights[_tokenAddress];
    }

    /**
     * Returns whether an NFT has already voted.
     */
    function hasVoted(uint32 _proposalId, address _tokenAddress, uint256 _tokenId) external view returns (bool) {
        return proposalVotes[_proposalId].hasVoted[_tokenAddress][_tokenId];
    }

    function removeGovernanceToken(address _tokenAddress) external onlyOwner {
        if (tokenWeights[_tokenAddress] == 0) revert TokenNotSet();

        tokenWeights[_tokenAddress] = 0;

        uint256 length = tokenAddresses.length;
        for (uint256 i = 0; i < length;) {
            if (_tokenAddress == tokenAddresses[i]) {
                uint256 last = length - 1;
                tokenAddresses[i] = tokenAddresses[last]; // move the last token into the position to remove
                delete tokenAddresses[last];              // delete the last token
                break;
            }
            unchecked { ++i; }
        }
        
        emit GovernanceTokenRemoved(_tokenAddress);
    }

    function _addGovernanceToken(address _tokenAddress, uint256 _weight) internal {
        if (!IERC721(_tokenAddress).supportsInterface(0x80ac58cd))
            revert InvalidTokenAddress();
        
        if (_weight == 0)
            revert NoVotingWeight();

        if (tokenWeights[_tokenAddress] > 0)
            revert TokenAlreadySet();

        tokenAddresses.push(_tokenAddress);
        tokenWeights[_tokenAddress] = _weight;

        emit GovernanceTokenAdded(_tokenAddress, _weight);
    }

    /** @inheritdoc BaseStrategy*/
    function initializeProposal(bytes memory _data) public override onlyAzorius {
        uint32 proposalId = abi.decode(_data, (uint32));
        uint32 _votingEndBlock = uint32(block.number) + votingPeriod;

        proposalVotes[proposalId].votingEndBlock = _votingEndBlock;
        proposalVotes[proposalId].votingStartBlock = uint32(block.number);

        emit ProposalInitialized(proposalId, _votingEndBlock);
    }

    /** @inheritdoc BaseStrategy*/
    function isPassed(uint32 _proposalId) public view override returns (bool) {
        return (
            block.number > proposalVotes[_proposalId].votingEndBlock && // voting period has ended
            quorumThreshold <= proposalVotes[_proposalId].yesVotes + proposalVotes[_proposalId].abstainVotes && // yes + abstain votes meets the quorum
            meetsBasis(proposalVotes[_proposalId].yesVotes, proposalVotes[_proposalId].noVotes) // yes votes meets the basis
        );
    }

    /** @inheritdoc BaseStrategy*/
    function isProposer(address _address) public view override returns (bool) {
        uint256 totalWeight = 0;
        for (uint i = 0; i < tokenAddresses.length;) {
            address tokenAddress = tokenAddresses[i];
            totalWeight += IERC721(tokenAddress).balanceOf(_address) * tokenWeights[tokenAddress];
            unchecked { ++i; }
        }
        return totalWeight >= proposerThreshold;
    }

    /** @inheritdoc BaseStrategy*/
    function votingEndBlock(uint32 _proposalId) public view override returns (uint32) {
      return proposalVotes[_proposalId].votingEndBlock;
    }

    /** Internal implementation of `updateVotingPeriod`. */
    function _updateVotingPeriod(uint32 _votingPeriod) internal {
        votingPeriod = _votingPeriod;
        emit VotingPeriodUpdated(_votingPeriod);
    }

    /** Internal implementation of `updateQuorumThreshold`. */
    function _updateQuorumThreshold(uint256 _quorumThreshold) internal {
        quorumThreshold = _quorumThreshold;
        emit QuorumThresholdUpdated(quorumThreshold);
    }

    /** Internal implementation of `updateProposerThreshold`. */
    function _updateProposerThreshold(uint256 _proposerThreshold) internal {
        proposerThreshold = _proposerThreshold;
        emit ProposerThresholdUpdated(_proposerThreshold);
    }

    function _vote(
        uint32 _proposalId,
        address _voter,
        uint8 _voteType,
        address[] memory _tokenAddresses,
        uint256[] memory _tokenIds
    ) internal {

        uint256 weight;

        // verifies the voter holds the NFTs and returns the total weight associated with their tokens
        // the frontend will need to determine whether an address can vote on a proposal, as it is possible
        // to vote twice if you get more weight later on
        for (uint256 i = 0; i < _tokenAddresses.length;) {

            address tokenAddress = _tokenAddresses[i];
            uint256 tokenId = _tokenIds[i];

            // ensure the token hasn't voted already, and the voter actually holds the token
            if (
                proposalVotes[_proposalId].hasVoted[tokenAddress][tokenId] == true || 
                _voter != IERC721(tokenAddress).ownerOf(tokenId)
            ) {
                unchecked { ++i; }
                continue;
            }
            
            weight += tokenWeights[tokenAddress];
            proposalVotes[_proposalId].hasVoted[tokenAddress][tokenId] = true;
            unchecked { ++i; }
        }

        if (weight == 0) revert NoVotingWeight();

        ProposalVotes storage proposal = proposalVotes[_proposalId];

        if (proposal.votingEndBlock == 0)
            revert InvalidProposal();

        if (block.number > proposal.votingEndBlock)
            revert VotingEnded();

        if (_voteType == uint8(VoteType.NO)) {
            proposal.noVotes += weight;
        } else if (_voteType == uint8(VoteType.YES)) {
            proposal.yesVotes += weight;
        } else if (_voteType == uint8(VoteType.ABSTAIN)) {
            proposal.abstainVotes += weight;
        } else {
            revert InvalidVote();
        }

        emit Voted(_voter, _proposalId, _voteType, weight);
    }
}
