//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import { IERC721VotingStrategy } from "./azorius/interfaces/IERC721VotingStrategy.sol";
import { BaseFreezeVoting, IBaseFreezeVoting } from "./BaseFreezeVoting.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * A [BaseFreezeVoting](./BaseFreezeVoting.md) implementation which handles 
 * freezes on ERC721 based token voting DAOs.
 */
contract ERC721FreezeVoting is BaseFreezeVoting {

    /** A reference to the voting strategy of the parent DAO. */
    IERC721VotingStrategy public strategy;

    /**
     * Mapping of block the freeze vote was started on, to the token address, to token id,
     * to whether that token has been used to vote already.
     */
    mapping(uint256 => mapping(address => mapping(uint256 => bool))) public idHasFreezeVoted;

    event ERC721FreezeVotingSetUp(address indexed owner, address indexed strategy);

    error NoVotes();
    error NotSupported();
    error UnequalArrays();

    /**
     * Initialize function, will be triggered when a new instance is deployed.
     *
     * @param initializeParams encoded initialization parameters.
     */
    function setUp(bytes memory initializeParams) public override initializer {
        (
            address _owner,
            uint256 _freezeVotesThreshold,
            uint32 _freezeProposalPeriod,
            uint32 _freezePeriod,
            address _strategy
        ) = abi.decode(
                initializeParams,
                (address, uint256, uint32, uint32, address)
            );

        __Ownable_init();
        _transferOwnership(_owner);
        _updateFreezeVotesThreshold(_freezeVotesThreshold);
        _updateFreezeProposalPeriod(_freezeProposalPeriod);
        _updateFreezePeriod(_freezePeriod);
        freezePeriod = _freezePeriod;
        strategy = IERC721VotingStrategy(_strategy);

        emit ERC721FreezeVotingSetUp(_owner, _strategy);
    }

    function castFreezeVote() external override pure { revert NotSupported(); }

    function castFreezeVote(address[] memory _tokenAddresses, uint256[] memory _tokenIds) external {
        if (_tokenAddresses.length != _tokenIds.length) revert UnequalArrays();

        if (block.number > freezeProposalCreatedBlock + freezeProposalPeriod) {
            // create a new freeze proposal
            freezeProposalCreatedBlock = uint32(block.number);
            freezeProposalVoteCount = 0;
            emit FreezeProposalCreated(msg.sender);
        }

        uint256 userVotes = _getVotesAndUpdateHasVoted(_tokenAddresses, _tokenIds, msg.sender);
        if (userVotes == 0) revert NoVotes();

        freezeProposalVoteCount += userVotes;     

        emit FreezeVoteCast(msg.sender, userVotes);
    }

    function _getVotesAndUpdateHasVoted(
        address[] memory _tokenAddresses,
        uint256[] memory _tokenIds,
        address _voter
    ) internal returns (uint256) {

        uint256 votes = 0;

        for (uint256 i = 0; i < _tokenAddresses.length; i++) {

            address tokenAddress = _tokenAddresses[i];
            uint256 tokenId = _tokenIds[i];

            if (_voter != IERC721(tokenAddress).ownerOf(tokenId))
                continue;

            if (idHasFreezeVoted[freezeProposalCreatedBlock][tokenAddress][tokenId])
                continue;
            
            votes += strategy.getTokenWeight(tokenAddress);

            idHasFreezeVoted[freezeProposalCreatedBlock][tokenAddress][tokenId] = true;
        }

        return votes;
    }
}
