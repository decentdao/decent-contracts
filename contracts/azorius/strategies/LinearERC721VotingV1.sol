// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

import {IERC721VotingStrategy} from "../interfaces/IERC721VotingStrategy.sol";
import {Version} from "../../Version.sol";
import {ERC4337VoterSupportV1} from "./ERC4337VoterSupportV1.sol";
import {LinearERC721VotingExtensible} from "./LinearERC721VotingExtensible.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

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
    LinearERC721VotingExtensible,
    ERC165,
    ERC4337VoterSupportV1,
    Version
{
    uint16 private constant VERSION = 1;

    /**
     * @dev Constructor that disables initializers
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * Sets up the contract with its initial parameters.
     *
     * @param initializeParams encoded initialization parameters: `address _owner`,
     * `address[] memory _tokens`, `uint256[] memory _weights`, `address _azoriusModule`,
     * `uint32 _votingPeriod`, `uint256 _quorumThreshold`, `uint256 _basisNumerator`,
     * `address _lightAccountFactory`
     */
    function setUp(bytes memory initializeParams) public virtual override {
        (
            address _owner,
            address[] memory _tokens,
            uint256[] memory _weights,
            address _azoriusModule,
            uint32 _votingPeriod,
            uint256 _quorumThreshold,
            uint256 _proposerThreshold,
            uint256 _basisNumerator,
            address _lightAccountFactory
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
                    uint256,
                    address
                )
            );

        LinearERC721VotingExtensible.setUp(
            abi.encode(
                _owner,
                _tokens,
                _weights,
                _azoriusModule,
                _votingPeriod,
                _quorumThreshold,
                _proposerThreshold,
                _basisNumerator
            )
        );

        __ERC4337VoterSupportV1_init(_lightAccountFactory);
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
    ) external virtual override {
        if (_tokenAddresses.length != _tokenIds.length) revert InvalidParams();
        _vote(
            _proposalId,
            _voter(msg.sender),
            _voteType,
            _tokenAddresses,
            _tokenIds
        );
    }

    /** @inheritdoc LinearERC721VotingExtensible*/
    function _vote(
        uint32 _proposalId,
        address _voter,
        uint8 _voteType,
        address[] memory _tokenAddresses,
        uint256[] memory _tokenIds
    ) internal virtual override {
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

        ProposalVotes storage proposal = proposalVotes[_proposalId];

        if (proposal.votingEndBlock == 0) revert InvalidProposal();

        if (block.number > proposal.votingEndBlock) {
            if (!_votingPeriodEnded[_proposalId]) {
                _votingPeriodEnded[_proposalId] = true;
                emit VotingPeriodEnded(
                    _proposalId,
                    proposal.votingEndBlock,
                    block.number
                );
                return;
            }
            revert VotingEnded();
        }

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

    function getVersion() public view virtual override returns (uint16) {
        return VERSION;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(Version, ERC165) returns (bool) {
        return
            interfaceId == type(IERC721VotingStrategy).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
