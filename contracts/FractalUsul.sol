//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

// Usul was previously named "Seele" and SekerDAO was TokenWalk
// that's where this naming differences are coming from
import "@tokenwalk/seele/contracts/Usul.sol";

abstract contract FractalUsul is Usul {
  event ProposalMetadataCreated(uint256 proposalId, string title, string description);

  /// @dev This method is used instead of Usul.submitProposal. Essentially - it just implements same behavior
  /// but then - it also emits metadata of the proposal in ProposalMetadataCreated event.
  function submitProposalWithMetaData(
        bytes32[] memory txHashes,
        address strategy,
        bytes memory data,
        string calldata title,
        string calldata description
  ) external {
        require(
            isStrategyEnabled(strategy),
            "voting strategy is not enabled for proposal"
        );
        require(txHashes.length > 0, "proposal must contain transactions");
        proposals[totalProposalCount].txHashes = txHashes;
        proposals[totalProposalCount].strategy = strategy;
        totalProposalCount++;
        IStrategy(strategy).receiveProposal(
            abi.encode(totalProposalCount - 1, txHashes, data)
        );
        emit ProposalCreated(strategy, totalProposalCount - 1, msg.sender);
        emit ProposalMetadataCreated(totalProposalCount - 1, title, description);
  }
}