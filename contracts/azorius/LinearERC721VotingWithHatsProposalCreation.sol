// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import {LinearERC721VotingExtensible} from "./LinearERC721VotingExtensible.sol";
import {HatsProposalCreationWhitelist} from "./HatsProposalCreationWhitelist.sol";
import {IHats} from "../interfaces/hats/IHats.sol";

/**
 * An [Azorius](./Azorius.md) [BaseStrategy](./BaseStrategy.md) implementation that
 * enables linear (i.e. 1 to 1) ERC721 based token voting, with proposal creation
 * restricted to users wearing whitelisted Hats.
 */
contract LinearERC721VotingWithHatsProposalCreation is
    HatsProposalCreationWhitelist,
    LinearERC721VotingExtensible
{
    /**
     * Sets up the contract with its initial parameters.
     *
     * @param initializeParams encoded initialization parameters: `address _owner`,
     * `address[] memory _tokens`, `uint256[] memory _weights`, `address _azoriusModule`,
     * `uint32 _votingPeriod`, `uint256 _quorumThreshold`, `uint256 _basisNumerator`,
     * `address _hatsContract`, `uint256[] _initialWhitelistedHats`
     */
    function setUp(
        bytes memory initializeParams
    )
        public
        override(HatsProposalCreationWhitelist, LinearERC721VotingExtensible)
    {
        (
            address _owner,
            address[] memory _tokens,
            uint256[] memory _weights,
            address _azoriusModule,
            uint32 _votingPeriod,
            uint256 _quorumThreshold,
            uint256 _basisNumerator,
            address _hatsContract,
            uint256[] memory _initialWhitelistedHats
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
                    address,
                    uint256[]
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
                0, // _proposerThreshold is zero because we only care about the hat check
                _basisNumerator
            )
        );

        HatsProposalCreationWhitelist.setUp(
            abi.encode(_hatsContract, _initialWhitelistedHats)
        );
    }

    /** @inheritdoc HatsProposalCreationWhitelist*/
    function isProposer(
        address _address
    )
        public
        view
        override(HatsProposalCreationWhitelist, LinearERC721VotingExtensible)
        returns (bool)
    {
        return HatsProposalCreationWhitelist.isProposer(_address);
    }
}
