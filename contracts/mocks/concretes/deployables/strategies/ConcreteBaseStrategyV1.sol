// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {BaseStrategyV1} from "../../../../deployables/strategies/BaseStrategyV1.sol";
import {ClockMode} from "../../../../interfaces/decent/ClockMode.sol";
import {ClockModeLib} from "../../../../libs/ClockModeLib.sol";

/**
 * A concrete implementation of BaseStrategyV1 for testing purposes.
 */
contract ConcreteBaseStrategyV1 is BaseStrategyV1 {
    uint32 public constant CONCRETE_VOTING_PERIOD_SECONDS = 100;
    uint32 public constant CONCRETE_VOTING_PERIOD_BLOCKS = 10;

    ClockMode private currentClockMode;

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
        currentClockMode = ClockMode.Timestamp; // Default clock mode
        emit StrategySetUp(_proposalInitializer, _owner);
    }

    function setClockMode(ClockMode _newMode) external {
        currentClockMode = _newMode;
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

    function getClockMode() public view override returns (ClockMode) {
        return currentClockMode;
    }

    function getProposalVotingPeriodPoints(
        uint32
    ) public view override returns (uint256 startPoint, uint256 endPoint) {
        ClockMode mode = getClockMode();
        uint256 currentPoint = ClockModeLib.getCurrentPoint(mode);

        if (mode == ClockMode.Timestamp) {
            startPoint = currentPoint;
            endPoint = currentPoint + CONCRETE_VOTING_PERIOD_SECONDS;
        } else {
            startPoint = currentPoint;
            endPoint = currentPoint + CONCRETE_VOTING_PERIOD_BLOCKS;
        }
        return (startPoint, endPoint);
    }
}
