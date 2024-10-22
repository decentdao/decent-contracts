// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MockHatsElectionEligibility {
    uint128 private _currentTermEnd;
    uint128 private _nextTermEnd;
    mapping(uint128 => bool) private _electionStatus;

    event ElectionOpened(uint128 nextTermEnd);
    event ElectionCompleted(uint128 termEnd, address[] winners);
    event NewTermStarted(uint128 termEnd);

    // Mock function to simulate starting the next term
    function startNextTerm() external {
        _currentTermEnd = _nextTermEnd;
        _nextTermEnd = 0;

        emit NewTermStarted(_currentTermEnd);
    }

    function currentTermEnd() external view returns (uint128) {
        return _currentTermEnd;
    }

    function electionStatus(uint128 termEnd) external view returns (bool) {
        return _electionStatus[termEnd];
    }

    // Functions to set the mock data for testing
    function setCurrentTermEnd(uint128 termEnd) external {
        _currentTermEnd = termEnd;
    }

    function setNextTermEnd(uint128 termEnd) external {
        _nextTermEnd = termEnd;
    }

    function setElectionStatus(uint128 termEnd, bool status) external {
        _electionStatus[termEnd] = status;
    }
}
