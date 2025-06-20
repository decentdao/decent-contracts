// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IFreezeVotingAzoriusV1} from "../../interfaces/decent/deployables/IFreezeVotingAzoriusV1.sol";
import {IFreezeVotingBaseV1} from "../../interfaces/decent/deployables/IFreezeVotingBaseV1.sol";
import {IVotingAdapterBaseV1} from "../../interfaces/decent/deployables/IVotingAdapterBaseV1.sol";
import {IModuleAzoriusV1} from "../../interfaces/decent/deployables/IModuleAzoriusV1.sol";
import {IStrategyV1} from "../../interfaces/decent/deployables/IStrategyV1.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {ILightAccountValidatorV1} from "../../interfaces/decent/deployables/ILightAccountValidatorV1.sol";
import {IDeploymentBlockV1} from "../../interfaces/decent/IDeploymentBlockV1.sol";
import {FreezeVotingBaseV1} from "./FreezeVotingBaseV1.sol";
import {DeploymentBlockV1} from "../../DeploymentBlockV1.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract FreezeVotingAzoriusV1 is
    IFreezeVotingAzoriusV1,
    IVersion,
    FreezeVotingBaseV1,
    DeploymentBlockV1,
    ERC165
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /// @custom:storage-location erc7201:Decent.FreezeVotingAzorius.main
    struct FreezeVotingAzoriusStorage {
        IModuleAzoriusV1 parentAzorius;
        address freezeProposalStrategy;
    }

    // EIP-7201: keccak256(abi.encode(uint256(keccak256("Decent.FreezeVotingAzorius.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant FREEZE_VOTING_AZORIUS_STORAGE_LOCATION =
        0x9d1b207d938f3e5b6e54413a914efe44171cda038c387334c00ec1729143ba00;

    function _getFreezeVotingAzoriusStorage()
        internal
        pure
        returns (FreezeVotingAzoriusStorage storage $)
    {
        assembly {
            $.slot := FREEZE_VOTING_AZORIUS_STORAGE_LOCATION
        }
    }

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
            freezeVotesThreshold_,
            lightAccountFactory_
        );
        __DeploymentBlockV1_init();

        FreezeVotingAzoriusStorage storage $ = _getFreezeVotingAzoriusStorage();
        $.parentAzorius = IModuleAzoriusV1(parentAzorius_);
    }

    // ======================================================================
    // IFreezeVotingAzoriusV1
    // ======================================================================

    // --- View Functions ---

    function parentAzorius() public view virtual override returns (address) {
        FreezeVotingAzoriusStorage storage $ = _getFreezeVotingAzoriusStorage();
        return address($.parentAzorius);
    }

    function freezeProposalStrategy()
        public
        view
        virtual
        override
        returns (address)
    {
        FreezeVotingAzoriusStorage storage $ = _getFreezeVotingAzoriusStorage();
        return $.freezeProposalStrategy;
    }

    // --- State-Changing Functions ---

    function castFreezeVote(
        VotingAdapterVoteData[] calldata votingAdaptersToUse_,
        uint256 lightAccountIndex_
    ) public virtual override {
        address resolvedVoter = potentialLightAccountResolvedOwner(
            msg.sender,
            lightAccountIndex_
        );

        FreezeVotingBaseStorage storage $base = _getFreezeVotingBaseStorage();
        FreezeVotingAzoriusStorage storage $ = _getFreezeVotingAzoriusStorage();

        if (
            block.timestamp >
            $base.freezeProposalCreated + $base.freezeProposalPeriod
        ) {
            _initializeFreezeVote();
            $.freezeProposalStrategy = $.parentAzorius.strategy();
            emit FreezeProposalCreated(resolvedVoter, $.freezeProposalStrategy);
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
        FreezeVotingAzoriusStorage storage $ = _getFreezeVotingAzoriusStorage();
        $.freezeProposalStrategy = address(0);
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
            interfaceId_ == type(ILightAccountValidatorV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
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

        FreezeVotingAzoriusStorage storage $ = _getFreezeVotingAzoriusStorage();

        for (uint256 i = 0; i < votingAdaptersToUse_.length; ) {
            address adapterAddress = votingAdaptersToUse_[i].votingAdapter;

            if (
                !IStrategyV1($.freezeProposalStrategy).isVotingAdapter(
                    adapterAddress
                )
            ) {
                revert InvalidVotingAdapter();
            }

            FreezeVotingBaseStorage
                storage $base = _getFreezeVotingBaseStorage();

            userVotes += IVotingAdapterBaseV1(adapterAddress).recordFreezeVote(
                voter_,
                $base.freezeProposalCreated,
                votingAdaptersToUse_[i].adapterVoteData
            );

            unchecked {
                ++i;
            }
        }

        return userVotes;
    }
}
