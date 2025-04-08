// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

import {LinearERC721VotingV1} from "./LinearERC721VotingV1.sol";
import {LinearERC721VotingExtensible} from "./LinearERC721VotingExtensible.sol";
import {HatsProposalCreationWhitelistV1} from "./HatsProposalCreationWhitelistV1.sol";

/**
 * An [Azorius](./Azorius.md) [BaseStrategy](./BaseStrategy.md) implementation that
 * enables linear (i.e. 1 to 1) ERC721 based token voting, with proposal creation
 * restricted to users wearing whitelisted Hats.
 */
contract LinearERC721VotingWithHatsProposalCreationV1 is
    LinearERC721VotingV1,
    HatsProposalCreationWhitelistV1
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
     * `address _hatsContract`, `uint256[] _initialWhitelistedHats`, `address _lightAccountFactory`
     */
    function setUp(
        bytes memory initializeParams
    ) public override(LinearERC721VotingV1, HatsProposalCreationWhitelistV1) {
        (
            address _owner,
            address[] memory _tokens,
            uint256[] memory _weights,
            address _azoriusModule,
            uint32 _votingPeriod,
            uint256 _quorumThreshold,
            uint256 _basisNumerator,
            address _hatsContract,
            uint256[] memory _initialWhitelistedHats,
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
                    address,
                    uint256[],
                    address
                )
            );

        LinearERC721VotingV1.setUp(
            abi.encode(
                _owner,
                _tokens,
                _weights,
                _azoriusModule,
                _votingPeriod,
                _quorumThreshold,
                0, // _proposerThreshold is zero because we only care about the hat check
                _basisNumerator,
                _lightAccountFactory
            )
        );

        HatsProposalCreationWhitelistV1.setUp(
            abi.encode(_hatsContract, _initialWhitelistedHats)
        );
    }

    /** @inheritdoc HatsProposalCreationWhitelistV1*/
    function isProposer(
        address _address
    )
        public
        view
        virtual
        override(HatsProposalCreationWhitelistV1, LinearERC721VotingExtensible)
        returns (bool)
    {
        return HatsProposalCreationWhitelistV1.isProposer(_address);
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
        override(HatsProposalCreationWhitelistV1, LinearERC721VotingV1)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
