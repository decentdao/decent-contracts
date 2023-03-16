// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity =0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @title BaseQuorumPercent - A Azorius strategy extension that enables percent based quorums
abstract contract BaseQuorumPercent is OwnableUpgradeable {
    uint256 public quorumNumerator;
    uint256 public constant quorumDenominator = 1_000_000;

    event QuorumNumeratorUpdated(uint256 newQuorumNumerator);

    error InvalidQuorumNumerator();

    function quorum(uint256 blockNumber) public view virtual returns (uint256);

    function updateQuorumNumerator(
        uint256 newQuorumNumerator
    ) public virtual onlyOwner {
        _updateQuorumNumerator(newQuorumNumerator);
    }

    function _updateQuorumNumerator(
        uint256 newQuorumNumerator
    ) internal virtual {
        if (newQuorumNumerator > quorumDenominator)
            revert InvalidQuorumNumerator();

        quorumNumerator = newQuorumNumerator;

        emit QuorumNumeratorUpdated(newQuorumNumerator);
    }
}
