//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

// Usul was previously named "Seele" and SekerDAO was TokenWalk
// that's where this naming differences are coming from
import "@tokenwalk/seele/contracts/Usul.sol";

abstract contract FractalUsul is Usul {
  struct Transaction {
    address to;
    uint256 value;
    bytes data;
    Enum.Operation operation;
  }
  
  struct Proposal {
    bool canceled;
    uint256 timeLockPeriod; // queue period for safety
    bytes32[] txHashes;
    Transaction[] transactions;
    uint256 executionCounter;
    address strategy; // the module that is allowed to vote on this
  }

  event ProposalMetadataCreated(
    uint256 proposalId, 
    string title, 
    string description, 
    string documentationUrl
  );

  // mapping of proposal id to proposal
  mapping(uint256 => Proposal) public override proposals;

  /// @dev This method is used instead of Usul.submitProposal. Essentially - it just implements same behavior
  /// but then - it also emits metadata of the proposal in ProposalMetadataCreated event.
  function submitProposalWithMetaData(
        Transaction[] memory transactions,
        address strategy,
        bytes memory data,
        string calldata title,
        string calldata description,
        string calldata documentationUrl
  ) external {
      require(
          isStrategyEnabled(strategy),
          "voting strategy is not enabled for proposal"
      );
      require(transactions.length > 0, "proposal must contain transactions");
      bytes32[] memory txHashes;

      for (uint256 i = 0; i < transactions.length; i++) {
        Transaction memory currentTx = transactions[i];
        bytes32 txHash = getTransactionHash(
          currentTx.to, 
          currentTx.value,
          currentTx.data, 
          currentTx.operation
        );

        txHashes[i] = txHash;
      }

      proposals[totalProposalCount].txHashes = txHashes;
      proposals[totalProposalCount].transactions = transactions;
      proposals[totalProposalCount].strategy = strategy;
      totalProposalCount++;
      IStrategy(strategy).receiveProposal(
          abi.encode(totalProposalCount - 1, transactions, data)
      );
      emit ProposalCreated(strategy, totalProposalCount - 1, msg.sender);
      emit ProposalMetadataCreated(totalProposalCount - 1, title, description, documentationUrl);
  }
}