//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Usul was previously named "Seele" and SekerDAO was TokenWalk
// that's where this naming differences are coming from
import "@tokenwalk/seele/contracts/Usul.sol";
import "@gnosis.pm/zodiac/contracts/core/Module.sol";

contract FractalUsul is Usul {
  struct Transaction {
    address to;
    uint256 value;
    bytes data;
    Enum.Operation operation;
  }

  event ProposalMetadataCreated(
    uint256 proposalId, 
    Transaction[] transactions,
    string title,
    string description, 
    string documentationUrl
  );

  constructor(
    address _owner,
    address _avatar,
    address _target,
    address[] memory _strategies
  ) Usul(_owner, _avatar, _target, _strategies) {}

  /// @dev This method is used instead of Usul.submitProposal. Essentially - it just implements same behavior
  /// but then - it also emits metadata of the proposal in ProposalMetadataCreated event.
  function submitProposalWithMetaData(
        address strategy,
        bytes memory data,
        Transaction[] calldata transactions,
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
      proposals[totalProposalCount].strategy = strategy;
      totalProposalCount++;
      IStrategy(strategy).receiveProposal(
          abi.encode(totalProposalCount - 1, txHashes, data)
      );
      emit ProposalCreated(strategy, totalProposalCount - 1, msg.sender);
      emit ProposalMetadataCreated(
        totalProposalCount - 1, 
        transactions, 
        title, 
        description, 
        documentationUrl
      );
  }

  /// @notice Gets the transaction hashes associated with a given proposald
  /// @param proposalId The ID of the proposal to get the tx hashes for
  /// @return bytes32[] The array of tx hashes
  function getProposalTxHashes(uint256 proposalId) external view returns (bytes32[] memory) {
    return proposals[proposalId].txHashes;
  }
}