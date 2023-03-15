// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title BaseQuorumPercent - An Azorius BaseStrategy extension contract
 * that enables percent based quorums.
 */
abstract contract BaseQuorumPercent is OwnableUpgradeable {
    
    uint256 public quorumNumerator;
    uint256 public constant QUORUM_DENOMINATOR = 1_000_000;

    event QuorumNumeratorUpdated(uint256 quorumNumerator);

    function quorum(uint256 _blockNumber) public view virtual returns (uint256);

    function updateQuorumNumerator(uint256 _quorumNumerator) public virtual onlyOwner {
        _updateQuorumNumerator(_quorumNumerator); // TODO WHYYYYY
    }

    function _updateQuorumNumerator(uint256 _quorumNumerator) internal virtual {
        require(
            quorumNumerator <= QUORUM_DENOMINATOR,
            "quorumNumerator cannot be greater than quorumDenominator"
        );

        quorumNumerator = _quorumNumerator;

        emit QuorumNumeratorUpdated(_quorumNumerator);
    }
}