// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IFreezeVotingBase} from "../interfaces/decent/deployables/IFreezeVotingBase.sol";

contract MockFreezeVoting is IFreezeVotingBase {
    bool private _isFrozen;
    uint256 private _freezeVotesThreshold;
    uint32 private _freezeProposalPeriod;
    uint32 private _freezePeriod;

    function setIsFrozen(bool frozen) external {
        _isFrozen = frozen;
    }

    function isFrozen() external view returns (bool) {
        return _isFrozen;
    }

    function castFreezeVote() external {
        emit FreezeVoteCast(msg.sender);
    }

    function unfreeze() external {
        _isFrozen = false;
        emit DAOUnfrozen(msg.sender);
    }

    // Mock events for testing
    event FreezeVoteCast(address indexed voter);
    event DAOUnfrozen(address indexed unfreezer);

    function freezeProposalCreated() external view override returns (uint48) {}

    function freezePeriod() external view override returns (uint32) {}

    function freezeVotesThreshold() external view override returns (uint256) {}

    function freezeProposalPeriod() external view override returns (uint32) {}

    function freezeProposalVoteCount()
        external
        view
        override
        returns (uint256)
    {}

    function freezeActivated() external view override returns (uint48) {}
}
