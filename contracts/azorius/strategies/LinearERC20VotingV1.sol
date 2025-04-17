// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

import {Version} from "../../Version.sol";
import {ERC4337VoterSupportV1} from "./ERC4337VoterSupportV1.sol";
import {LinearERC20VotingExtensible} from "./LinearERC20VotingExtensible.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/**
 * An [Azorius](./Azorius.md) [BaseStrategy](./BaseStrategy.md) implementation that
 * enables linear (i.e. 1 to 1) token voting. Each token delegated to a given address
 * in an `ERC20Votes` token equals 1 vote for a Proposal.
 */
contract LinearERC20VotingV1 is
    LinearERC20VotingExtensible,
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
     * `address _governanceToken`, `address _azoriusModule`, `uint32 _votingPeriod`,
     * `uint256 _quorumNumerator`, `uint256 _basisNumerator`, `address _lightAccountFactory`
     */
    function setUp(bytes memory initializeParams) public virtual override {
        (
            address _owner,
            IVotes _governanceToken,
            address _azoriusModule,
            uint32 _votingPeriod,
            uint256 _requiredProposerWeight,
            uint256 _quorumNumerator,
            uint256 _basisNumerator,
            address _lightAccountFactory
        ) = abi.decode(
                initializeParams,
                (
                    address,
                    IVotes,
                    address,
                    uint32,
                    uint256,
                    uint256,
                    uint256,
                    address
                )
            );

        LinearERC20VotingExtensible.setUp(
            abi.encode(
                _owner,
                _governanceToken,
                _azoriusModule,
                _votingPeriod,
                _requiredProposerWeight,
                _quorumNumerator,
                _basisNumerator
            )
        );

        __ERC4337VoterSupportV1_init(_lightAccountFactory);
    }

    /**
     * Casts votes for a Proposal, equal to the caller's token delegation.
     *
     * @param _proposalId id of the Proposal to vote on
     * @param _voteType Proposal support as defined in VoteType (NO, YES, ABSTAIN)
     */
    function vote(
        uint32 _proposalId,
        uint8 _voteType
    ) external virtual override {
        address voter = _voter(msg.sender);
        _vote(
            _proposalId,
            voter,
            _voteType,
            getVotingWeight(voter, _proposalId)
        );
    }

    /** @inheritdoc LinearERC20VotingExtensible*/
    function _vote(
        uint32 _proposalId,
        address _voter,
        uint8 _voteType,
        uint256 _weight
    ) internal virtual override {
        if (proposalVotes[_proposalId].votingEndBlock == 0)
            revert InvalidProposal();
        if (block.number > proposalVotes[_proposalId].votingEndBlock) {
            if (!_votingPeriodEnded[_proposalId]) {
                _votingPeriodEnded[_proposalId] = true;
                emit VotingPeriodEnded(
                    _proposalId,
                    proposalVotes[_proposalId].votingEndBlock,
                    block.number
                );
                return;
            }
            revert VotingEnded();
        }
        if (proposalVotes[_proposalId].hasVoted[_voter]) revert AlreadyVoted();

        proposalVotes[_proposalId].hasVoted[_voter] = true;

        if (_voteType == uint8(VoteType.NO)) {
            proposalVotes[_proposalId].noVotes += _weight;
        } else if (_voteType == uint8(VoteType.YES)) {
            proposalVotes[_proposalId].yesVotes += _weight;
        } else if (_voteType == uint8(VoteType.ABSTAIN)) {
            proposalVotes[_proposalId].abstainVotes += _weight;
        } else {
            revert InvalidVote();
        }

        emit Voted(_voter, _proposalId, _voteType, _weight);
    }

    function getProposalPeriod(
        uint32 _proposalId
    ) public view virtual returns (uint32, uint32) {
        return (
            proposalVotes[_proposalId].votingStartBlock,
            proposalVotes[_proposalId].votingEndBlock
        );
    }

    function getVersion() public view virtual override returns (uint16) {
        return VERSION;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(Version, ERC165) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
