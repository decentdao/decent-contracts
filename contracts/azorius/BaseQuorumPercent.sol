// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity =0.8.19;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * An Azorius extension contract that enables percent based quorums.
 * Intended to be implemented by [BaseStrategy](./BaseStrategy.md) implementations.
 */
abstract contract BaseQuorumPercent is OwnableUpgradeable {
    
    /** The numerator to use when calculating quorum (adjustable). */
    uint256 public quorumNumerator;

    /** The denominator to use when calculating quorum (1,000,000). */
    uint256 public constant QUORUM_DENOMINATOR = 1_000_000;

    /** Ensures the numerator cannot be larger than the denominator. */
    error InvalidQuorumNumerator();

    event QuorumNumeratorUpdated(uint256 quorumNumerator);

    /**
     * Calculates the number of votes needed to achieve quorum at a specific block number.
     *
     * Because token supply is not necessarily static, it is required to calculate
     * quorum based on the supply at the time of a Proposal's creation.
     *
     * @param _blockNumber block number to calculate quorum at
     * @return uint256 the number of votes needed for quorum
     */
    function quorum(uint256 _blockNumber) public view virtual returns (uint256);

    /** 
     * Updates the quorum required for future Proposals.
     *
     * @param _quorumNumerator numerator to use when calculating quorum (over 1,000,000)
     */
    function updateQuorumNumerator(uint256 _quorumNumerator) public virtual onlyOwner {
        _updateQuorumNumerator(_quorumNumerator);
    }

    /** Internal implementation of `updateQuorumNumerator`. */
    function _updateQuorumNumerator(uint256 _quorumNumerator) internal virtual {
        if (_quorumNumerator > QUORUM_DENOMINATOR)
            revert InvalidQuorumNumerator();

        quorumNumerator = _quorumNumerator;

        emit QuorumNumeratorUpdated(_quorumNumerator);
    }
}
