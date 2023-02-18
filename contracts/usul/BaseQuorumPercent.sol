// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @title BaseQuorumPercent - A Usul strategy extension that enables percent based quorums
abstract contract BaseQuorumPercent is OwnableUpgradeable {
    uint256 public quorumNumerator;
    uint256 public constant QUORUM_DENOMINATOR = 1_000_000;

    event QuorumNumeratorUpdated(uint256 newQuorumNumerator);

    function quorum(uint256 _blockNumber) public view virtual returns (uint256);

    function updateQuorumNumerator(
        uint256 _newQuorumNumerator
    ) public virtual onlyOwner {
        _updateQuorumNumerator(_newQuorumNumerator);
    }

    function _updateQuorumNumerator(
        uint256 _newQuorumNumerator
    ) internal virtual {
        require(
            _newQuorumNumerator <= QUORUM_DENOMINATOR,
            "numerator > denominator"
        );

        quorumNumerator = _newQuorumNumerator;

        emit QuorumNumeratorUpdated(_newQuorumNumerator);
    }
}
