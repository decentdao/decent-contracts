// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity =0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * An Azorius extension contract that enables percent based voting basis calculations.
 *
 * Intended to be implemented by BaseStrategy implementations, this allows for voting strategies
 * to dictate any basis strategy for passing a Proposal between >50% (simple majority) to 100%.
 *
 * See https://en.wikipedia.org/wiki/Voting#Voting_basis.
 * See https://en.wikipedia.org/wiki/Supermajority.
 */
abstract contract BaseVotingBasisPercent is OwnableUpgradeable {
    
    uint256 public basisNumerator;
    uint256 public constant BASIS_DENOMINATOR = 1_000_000;

    error InvalidBasisNumerator();

    event BasisNumeratorUpdated(uint256 basisNumerator);

    function basis() public view virtual returns (uint256) {
        return basisNumerator / BASIS_DENOMINATOR;
    }

    function updateBasisNumerator(uint256 _basisNumerator) public virtual onlyOwner {
        _updateBasisNumerator(_basisNumerator);
    }

    function _updateBasisNumerator(uint256 _basisNumerator) internal virtual {
        if (_basisNumerator > BASIS_DENOMINATOR)
            revert InvalidBasisNumerator();

        basisNumerator = _basisNumerator;

        emit BasisNumeratorUpdated(_basisNumerator);
    }
}
