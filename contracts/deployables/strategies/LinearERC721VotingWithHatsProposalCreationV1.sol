// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {LinearERC721VotingV1} from "./LinearERC721VotingV1.sol";
import {HatsProposalCreationWhitelistV1} from "./HatsProposalCreationWhitelistV1.sol";

/**
 * An [Azorius](./Azorius.md) [BaseStrategy](./BaseStrategy.md) implementation that
 * enables linear (i.e. 1 to 1) ERC721 based token voting, with proposal creation
 * restricted to users wearing whitelisted Hats.
 */
contract LinearERC721VotingWithHatsProposalCreationV1 is
    HatsProposalCreationWhitelistV1,
    LinearERC721VotingV1
{
    uint16 private constant VERSION = 1;

    struct LinearERC721VotingParams {
        address[] tokens;
        uint256[] weights;
        address azoriusModule;
        uint32 votingPeriod;
        uint256 quorumThreshold;
        uint256 basisNumerator;
        address lightAccountFactory;
    }

    struct HatsProposalCreationWhitelistParams {
        address hatsContract;
        uint256[] initialWhitelistedHats;
    }

    /**
     * @dev Constructor that disables initializers
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * Initializes the contract with its initial parameters.
     *
     * @param _owner The owner of the contract
     * @param _linearVotingParams Parameters for LinearERC721VotingV1 initialization
     * @param _hatsParams Parameters for HatsProposalCreationWhitelistV1 initialization
     */
    function initialize(
        address _owner,
        LinearERC721VotingParams memory _linearVotingParams,
        HatsProposalCreationWhitelistParams memory _hatsParams
    ) public initializer {
        // Initialize LinearERC721VotingV1
        LinearERC721VotingV1.initialize(
            _owner,
            _linearVotingParams.tokens,
            _linearVotingParams.weights,
            _linearVotingParams.azoriusModule,
            _linearVotingParams.votingPeriod,
            _linearVotingParams.quorumThreshold,
            0, // _proposerThreshold is zero because we only care about the hat check
            _linearVotingParams.basisNumerator,
            _linearVotingParams.lightAccountFactory
        );

        // Initialize HatsProposalCreationWhitelistV1
        HatsProposalCreationWhitelistV1.initialize(
            _owner,
            _hatsParams.hatsContract,
            _hatsParams.initialWhitelistedHats
        );
    }

    /**
     * @dev Function that authorizes an upgrade to a new implementation.
     * @param newImplementation The address of the new implementation
     */
    function _authorizeUpgrade(
        address newImplementation
    )
        internal
        virtual
        override(HatsProposalCreationWhitelistV1, LinearERC721VotingV1)
        onlyOwner
    {}

    function isProposer(
        address _address
    ) public view virtual override returns (bool) {
        return isWearingWhitelistedHat(_address);
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
