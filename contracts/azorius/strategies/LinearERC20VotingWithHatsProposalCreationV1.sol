// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.19;

import {LinearERC20VotingV1} from "./LinearERC20VotingV1.sol";
import {LinearERC20VotingExtensible} from "./LinearERC20VotingExtensible.sol";
import {HatsProposalCreationWhitelistV1} from "./HatsProposalCreationWhitelistV1.sol";

/**
 * An [Azorius](./Azorius.md) [BaseStrategy](./BaseStrategy.md) implementation that
 * enables linear (i.e. 1 to 1) ERC20 based token voting, with proposal creation
 * restricted to users wearing whitelisted Hats.
 */
contract LinearERC20VotingWithHatsProposalCreationV1 is
    LinearERC20VotingV1,
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
     * `address _governanceToken`, `address _azoriusModule`, `uint32 _votingPeriod`,
     * `uint256 _quorumNumerator`, `uint256 _basisNumerator`, `address _hatsContract`,
     * `uint256[] _initialWhitelistedHats`, `address _lightAccountFactory`
     */
    function setUp(
        bytes memory initializeParams
    ) public override(LinearERC20VotingV1, HatsProposalCreationWhitelistV1) {
        (
            address _owner,
            address _governanceToken,
            address _azoriusModule,
            uint32 _votingPeriod,
            uint256 _quorumNumerator,
            uint256 _basisNumerator,
            address _hatsContract,
            uint256[] memory _initialWhitelistedHats,
            address _lightAccountFactory
        ) = abi.decode(
                initializeParams,
                (
                    address,
                    address,
                    address,
                    uint32,
                    uint256,
                    uint256,
                    address,
                    uint256[],
                    address
                )
            );

        LinearERC20VotingV1.setUp(
            abi.encode(
                _owner,
                _governanceToken,
                _azoriusModule,
                _votingPeriod,
                0, // requiredProposerWeight is zero because we only care about the hat check
                _quorumNumerator,
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
        override(HatsProposalCreationWhitelistV1, LinearERC20VotingExtensible)
        returns (bool)
    {
        return HatsProposalCreationWhitelistV1.isProposer(_address);
    }

    function getVersion() public view virtual override returns (uint16) {
        return VERSION;
    }

    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        virtual
        override(LinearERC20VotingV1, HatsProposalCreationWhitelistV1)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
