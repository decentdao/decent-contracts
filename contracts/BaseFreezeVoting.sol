//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@gnosis.pm/zodiac/contracts/factory/FactoryFriendly.sol";
import "./interfaces/IBaseFreezeVoting.sol";

abstract contract BaseFreezeVoting is FactoryFriendly, IBaseFreezeVoting {
    uint256 public freezeVotesThreshold; // Number of freeze votes required to activate a freeze
    uint256 public freezeProposalCreatedBlock; // Block number the freeze proposal was created at
    uint256 public freezeProposalVoteCount; // Number of accrued freeze votes
    uint256 public freezeProposalPeriod; // Number of blocks a freeze proposal has to succeed
    uint256 public freezePeriod; // Number of blocks a freeze lasts, from time of freeze proposal creation
    mapping(address => mapping(uint256 => bool)) public userHasFreezeVoted;

    event FreezeVoteCast(address indexed voter, uint256 votesCast);
    event FreezeProposalCreated(address indexed creator);
    event FreezeVotesThresholdUpdated(uint256 freezeVotesThreshold);
    event FreezePeriodUpdated(uint256 freezePeriod);
    event FreezeProposalPeriodUpdated(uint256 freezeProposalPeriod);

    /// @notice Allows user to cast a freeze vote, creating a freeze proposal if necessary
    function castFreezeVote() external virtual;

    /// @notice Unfreezes the DAO, only callable by the owner
    function unfreeze() external onlyOwner {
        freezeProposalCreatedBlock = 0;
        freezeProposalVoteCount = 0;
    }

    /// @notice Updates the freeze votes threshold, only callable by the owner
    /// @param _freezeVotesThreshold Number of freeze votes required to activate a freeze
    function updateFreezeVotesThreshold(
        uint256 _freezeVotesThreshold
    ) external onlyOwner {
        _updateFreezeVotesThreshold(_freezeVotesThreshold);
    }

    /// @notice Updates the freeze proposal period, only callable by the owner
    /// @param _freezeProposalPeriod The number of blocks a freeze proposal has to succeed
    function updateFreezeProposalPeriod(
        uint256 _freezeProposalPeriod
    ) external onlyOwner {
        _updateFreezeProposalPeriod(_freezeProposalPeriod);
    }

    /// @notice Updates the freeze period, only callable by the owner
    /// @param _freezePeriod The number of blocks a freeze lasts, from time of freeze proposal creation
    function updateFreezePeriod(uint256 _freezePeriod) external onlyOwner {
        _updateFreezePeriod(_freezePeriod);
    }

    /// @notice Updates the freeze votes threshold
    /// @param _freezeVotesThreshold Number of freeze votes required to activate a freeze
    function _updateFreezeVotesThreshold(
        uint256 _freezeVotesThreshold
    ) internal {
        freezeVotesThreshold = _freezeVotesThreshold;

        emit FreezeVotesThresholdUpdated(_freezeVotesThreshold);
    }

    /// @notice Updates the freeze proposal period
    /// @param _freezeProposalPeriod The number of blocks a freeze proposal has to succeed
    function _updateFreezeProposalPeriod(
        uint256 _freezeProposalPeriod
    ) internal {
        freezeProposalPeriod = _freezeProposalPeriod;

        emit FreezeProposalPeriodUpdated(_freezeProposalPeriod);
    }

    /// @notice Updates the freeze period
    /// @param _freezePeriod The number of blocks a freeze lasts, from time of freeze proposal creation
    function _updateFreezePeriod(uint256 _freezePeriod) internal {
        freezePeriod = _freezePeriod;

        emit FreezePeriodUpdated(_freezePeriod);
    }

    /// @notice Returns true if the DAO is currently frozen, false otherwise
    /// @return bool Indicates whether the DAO is currently frozen
    function isFrozen() external view returns (bool) {
        if (
            freezeProposalVoteCount >= freezeVotesThreshold &&
            block.number < freezeProposalCreatedBlock + freezePeriod
        ) {
            return true;
        }

        return false;
    }
}
