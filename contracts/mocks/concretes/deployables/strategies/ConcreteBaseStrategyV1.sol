// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {BaseStrategyV1} from "../../../../deployables/strategies/BaseStrategyV1.sol";

/**
 * A concrete implementation of BaseStrategyV1 for testing purposes.
 */
contract ConcreteBaseStrategyV1 is BaseStrategyV1 {
    /**
     * Sets up the concrete strategy contract.
     * @param _owner The owner of the contract
     * @param _proposalInitializer Address that is allowed to initialize Proposals
     */
    function initialize(
        address _owner,
        address _proposalInitializer
    ) public override initializer {
        BaseStrategyV1.initialize(_owner, _proposalInitializer);
        emit StrategySetUp(_proposalInitializer, _owner);
    }

    function concreteOnlyProposalInitializerFunction()
        external
        onlyProposalInitializer
    {}

    function initializeProposal(
        bytes memory
    ) external override onlyProposalInitializer {}

    function isPassed(uint32) external pure override returns (bool) {
        return true;
    }

    function isProposer(address) external pure override returns (bool) {
        return true;
    }

    function getVotingTimestamps(
        uint32
    ) public view override returns (uint48 startTime, uint48 endTime) {
        return (uint48(block.timestamp), uint48(block.timestamp) + 100);
    }
}
