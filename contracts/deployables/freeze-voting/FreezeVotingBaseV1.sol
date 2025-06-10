// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IFreezeVotingBaseV1} from "../../interfaces/decent/deployables/IFreezeVotingBaseV1.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

abstract contract FreezeVotingBaseV1 is
    IFreezeVotingBaseV1,
    Ownable2StepUpgradeable
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    uint48 internal _freezeProposalCreated;
    uint256 internal _freezeProposalVoteCount;
    uint32 internal _freezeProposalPeriod;
    uint32 internal _freezePeriod;
    uint256 internal _freezeVotesThreshold;
    uint48 internal _freezeActivated;

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
        uint256 freezeVotesThreshold_
    ) internal onlyInitializing {
        __Ownable_init(owner_);
        _freezeVotesThreshold = freezeVotesThreshold_;
        _freezeProposalPeriod = freezeProposalPeriod_;
        _freezePeriod = freezePeriod_;
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
        return _freezeProposalCreated;
    }

    function freezeProposalVoteCount()
        public
        view
        virtual
        override
        returns (uint256)
    {
        return _freezeProposalVoteCount;
    }

    function freezeProposalPeriod()
        public
        view
        virtual
        override
        returns (uint32)
    {
        return _freezeProposalPeriod;
    }

    function freezePeriod() public view virtual override returns (uint32) {
        return _freezePeriod;
    }

    function freezeVotesThreshold()
        public
        view
        virtual
        override
        returns (uint256)
    {
        return _freezeVotesThreshold;
    }

    function freezeActivated() public view virtual override returns (uint48) {
        return _freezeActivated;
    }

    function isFrozen() public view virtual override returns (bool) {
        return
            _freezeProposalVoteCount >= _freezeVotesThreshold &&
            block.timestamp < _freezeActivated + _freezePeriod;
    }

    // --- State-Changing Functions ---

    function unfreeze() public virtual override onlyOwner {
        _freezeProposalCreated = 0;
        _freezeProposalVoteCount = 0;
        _freezeActivated = 0;
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    function _initializeFreezeVote() internal virtual {
        _freezeProposalCreated = uint48(block.timestamp);
        _freezeProposalVoteCount = 0;
        _freezeActivated = 0;
    }

    function _recordFreezeVote(
        address voter_,
        uint256 weightCasted_
    ) internal virtual {
        if (weightCasted_ == 0) revert NoVotes();

        _freezeProposalVoteCount += weightCasted_;

        if (_freezeProposalVoteCount >= _freezeVotesThreshold) {
            _freezeActivated = uint48(block.timestamp);
        }

        emit FreezeVoteCast(voter_, weightCasted_);
    }
}
