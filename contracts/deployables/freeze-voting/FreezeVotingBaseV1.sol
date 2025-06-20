// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IFreezeVotingBaseV1} from "../../interfaces/decent/deployables/IFreezeVotingBaseV1.sol";
import {LightAccountValidatorV1} from "../account-abstraction/LightAccountValidatorV1.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

abstract contract FreezeVotingBaseV1 is
    IFreezeVotingBaseV1,
    LightAccountValidatorV1,
    Ownable2StepUpgradeable
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /// @custom:storage-location erc7201:Decent.FreezeVotingBase.main
    struct FreezeVotingBaseStorage {
        uint48 freezeProposalCreated;
        uint256 freezeProposalVoteCount;
        uint32 freezeProposalPeriod;
        uint32 freezePeriod;
        uint256 freezeVotesThreshold;
        uint48 freezeActivated;
    }

    // EIP-7201: keccak256(abi.encode(uint256(keccak256("Decent.FreezeVotingBase.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant FREEZE_VOTING_BASE_STORAGE_LOCATION =
        0x5fcea62682ddc2ee9ccbce9f3a895c9dd644ee53c86fd38cf80a135b0e525500;

    function _getFreezeVotingBaseStorage()
        internal
        pure
        returns (FreezeVotingBaseStorage storage $)
    {
        assembly {
            $.slot := FREEZE_VOTING_BASE_STORAGE_LOCATION
        }
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function __FreezeVotingBaseV1_init(
        address owner_,
        uint32 freezeProposalPeriod_,
        uint32 freezePeriod_,
        uint256 freezeVotesThreshold_,
        address lightAccountFactory_
    ) internal onlyInitializing {
        __Ownable_init(owner_);
        __LightAccountValidatorV1_init(lightAccountFactory_);

        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();
        $.freezeVotesThreshold = freezeVotesThreshold_;
        $.freezeProposalPeriod = freezeProposalPeriod_;
        $.freezePeriod = freezePeriod_;
    }

    // ======================================================================
    // IFreezeVotingBaseV1
    // ======================================================================

    // --- View Functions ---

    function freezeProposalCreated()
        public
        view
        virtual
        override
        returns (uint48)
    {
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();
        return $.freezeProposalCreated;
    }

    function freezeProposalVoteCount()
        public
        view
        virtual
        override
        returns (uint256)
    {
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();
        return $.freezeProposalVoteCount;
    }

    function freezeProposalPeriod()
        public
        view
        virtual
        override
        returns (uint32)
    {
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();
        return $.freezeProposalPeriod;
    }

    function freezePeriod() public view virtual override returns (uint32) {
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();
        return $.freezePeriod;
    }

    function freezeVotesThreshold()
        public
        view
        virtual
        override
        returns (uint256)
    {
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();
        return $.freezeVotesThreshold;
    }

    function freezeActivated() public view virtual override returns (uint48) {
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();
        return $.freezeActivated;
    }

    function isFrozen() public view virtual override returns (bool) {
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();

        return
            $.freezeProposalVoteCount >= $.freezeVotesThreshold &&
            block.timestamp < $.freezeActivated + $.freezePeriod;
    }

    // --- State-Changing Functions ---

    function unfreeze() public virtual override onlyOwner {
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();

        $.freezeProposalCreated = 0;
        $.freezeProposalVoteCount = 0;
        $.freezeActivated = 0;
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    function _initializeFreezeVote() internal virtual {
        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();

        $.freezeProposalCreated = uint48(block.timestamp);
        $.freezeProposalVoteCount = 0;
        $.freezeActivated = 0;
    }

    function _recordFreezeVote(
        address voter_,
        uint256 weightCasted_
    ) internal virtual {
        if (weightCasted_ == 0) revert NoVotes();

        FreezeVotingBaseStorage storage $ = _getFreezeVotingBaseStorage();
        $.freezeProposalVoteCount += weightCasted_;

        if ($.freezeProposalVoteCount >= $.freezeVotesThreshold) {
            $.freezeActivated = uint48(block.timestamp);
        }

        emit FreezeVoteCast(voter_, weightCasted_);
    }
}
