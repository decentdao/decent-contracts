// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IFreezeVotingAzoriusV1} from "../../interfaces/decent/deployables/IFreezeVotingAzoriusV1.sol";
import {IFreezeVotingBaseV1} from "../../interfaces/decent/deployables/IFreezeVotingBaseV1.sol";
import {IVotingAdapterBaseV1} from "../../interfaces/decent/deployables/IVotingAdapterBaseV1.sol";
import {IModuleAzoriusV1} from "../../interfaces/decent/deployables/IModuleAzoriusV1.sol";
import {IStrategyV1} from "../../interfaces/decent/deployables/IStrategyV1.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IVoterResolverV1} from "../../interfaces/decent/deployables/IVoterResolverV1.sol";
import {VoterResolverV1} from "../account-abstraction/VoterResolverV1.sol";
import {FreezeVotingBaseV1} from "./FreezeVotingBaseV1.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract FreezeVotingAzoriusV1 is
    IFreezeVotingAzoriusV1,
    IVersion,
    FreezeVotingBaseV1,
    VoterResolverV1,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    IModuleAzoriusV1 internal _parentAzorius;
    address internal _freezeProposalStrategy;

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        uint256 freezeVotesThreshold_,
        uint32 freezeProposalPeriod_,
        uint32 freezePeriod_,
        address parentAzorius_,
        address lightAccountFactory_
    ) public virtual override initializer {
        __FreezeVotingBaseV1_init(
            owner_,
            freezeProposalPeriod_,
            freezePeriod_,
            freezeVotesThreshold_
        );
        __VoterResolverV1_init(lightAccountFactory_);
        _parentAzorius = IModuleAzoriusV1(parentAzorius_);
    }

    // ======================================================================
    // IFreezeVotingAzoriusV1
    // ======================================================================

    // --- View Functions ---

    function parentAzorius() public view virtual override returns (address) {
        return address(_parentAzorius);
    }

    function freezeProposalStrategy()
        public
        view
        virtual
        override
        returns (address)
    {
        return _freezeProposalStrategy;
    }

    // --- State-Changing Functions ---

    function castFreezeVote(
        VotingAdapterVoteData[] calldata votingAdaptersToUse_
    ) public virtual override {
        address resolvedVoter = voter(msg.sender);

        if (block.timestamp > _freezeProposalCreated + _freezeProposalPeriod) {
            _initializeFreezeVote();
            _freezeProposalStrategy = _parentAzorius.strategy();
            emit FreezeProposalCreated(resolvedVoter, _freezeProposalStrategy);
        }

        _recordFreezeVote(
            resolvedVoter,
            _getVotes(resolvedVoter, votingAdaptersToUse_)
        );
    }

    // ======================================================================
    // FreezeVotingBaseV1
    // ======================================================================

    // --- State-Changing Functions ---

    function unfreeze() public virtual override onlyOwner {
        _freezeProposalStrategy = address(0);
        super.unfreeze();
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

    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IFreezeVotingAzoriusV1).interfaceId ||
            interfaceId_ == type(IFreezeVotingBaseV1).interfaceId ||
            interfaceId_ == type(IVoterResolverV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            super.supportsInterface(interfaceId_);
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    function _getVotes(
        address voter_,
        VotingAdapterVoteData[] calldata votingAdaptersToUse_
    ) internal virtual returns (uint256) {
        uint256 userVotes = 0;

        for (uint256 i = 0; i < votingAdaptersToUse_.length; ) {
            address adapterAddress = votingAdaptersToUse_[i].votingAdapter;

            if (
                !IStrategyV1(_freezeProposalStrategy).isVotingAdapter(
                    adapterAddress
                )
            ) {
                revert InvalidVotingAdapter();
            }

            userVotes += IVotingAdapterBaseV1(adapterAddress).recordFreezeVote(
                voter_,
                _freezeProposalCreated,
                votingAdaptersToUse_[i].adapterVoteData
            );

            unchecked {
                ++i;
            }
        }

        return userVotes;
    }
}
