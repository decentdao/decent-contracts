//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "../FractalUsul.sol";

interface IFractalUsul {
    enum ProposalState {
        ACTIVE,
        CANCELED,
        TIMELOCKED,
        EXECUTED,
        EXECUTABLE,
        UNINITIALIZED
    }

    /// @notice Enables a voting strategy that can vote on proposals, only callable by the owner
    /// @param strategy Address of the strategy to be enabled
    function enableStrategy(address strategy) external;

    /// @notice Disables a voting strategy on the module, only callable by the owner
    /// @param prevStrategy Strategy that pointed to the strategy to be removed in the linked list
    /// @param strategy Strategy to be removed
    function disableStrategy(address prevStrategy, address strategy) external;

    /// @notice This method submits a proposal which includes metadata strings to describe the proposal
    /// @param strategy Address of Voting Strategy, under which proposal submitted
    /// @param data - any additional data, which would be passed to the strategy contract
    /// @param transactions - array of transactions to execute
    /// @param title - proposal title, emitted in ProposalCreated
    /// @param description - proposal description, emitted in ProposalCreated
    /// @param documentationUrl - proposal documentation/discussion URL, emitted in ProposalCreated
    function submitProposal(
        address strategy,
        bytes memory data,
        FractalUsul.Transaction[] calldata transactions,
        string calldata title,
        string calldata description,
        string calldata documentationUrl
    ) external;

    /// @notice Cancels an array of proposals
    /// @param proposalIds Array of proposals to cancel
    function cancelProposals(uint256[] memory proposalIds) external;

    /// @notice Called by the strategy contract when the proposal vote has succeeded
    /// @param proposalId the identifier of the proposal
    /// @param timeLockPeriod the optional delay time
    function timelockProposal(uint256 proposalId, uint256 timeLockPeriod) external;

    /// @notice Executes the specified transaction within a proposal
    /// @notice Transactions must be called in order
    /// @param proposalId the identifier of the proposal
    /// @param target the contract to be called by the avatar
    /// @param value ether value to pass with the call
    /// @param data the data to be executed from the call
    /// @param operation Call or Delegatecall
    function executeProposalByIndex(
        uint256 proposalId,
        address target,
        uint256 value,
        bytes memory data,
        Enum.Operation operation
    ) external;

    /// @notice Executes all the transactions within a proposal
    /// @param proposalId the identifier of the proposal
    /// @param targets the contracts to be called by the avatar
    /// @param values ether values to pass with the calls
    /// @param data the data to be executed from the calls
    /// @param operations Calls or Delegatecalls
    function executeProposalBatch(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory data,
        Enum.Operation[] memory operations
    ) external;

    /// @notice Returns if a strategy is enabled
    /// @param _strategy The address of the strategy to check
    /// @return True if the strategy is enabled
    function isStrategyEnabled(address _strategy) external view returns (bool);

    /// @notice Returns array of strategy contract addresses
    /// @param startAddress Address in the strategy linked list to start with
    /// @param count Maximum number of strategies that should be returned
    /// @return strategiesArray Array of strategy
    /// @return next Next address in the linked list
    function getStrategies(
        address startAddress,
        uint256 count
    ) external view returns (address[] memory strategiesArray, address next);

    /// @notice Returns true if a proposal transaction by index is executed
    /// @param proposalId The ID of the proposal
    /// @param index The index of the transaction within the proposal
    /// @return bool True if the transaction has been executed
    function isTxExecuted(
        uint256 proposalId,
        uint256 index
    ) external view returns (bool);

    /// @notice Gets the state of a proposal
    /// @param proposalId The ID of the proposal
    /// @return ProposalState the uint256 representing of the state of the proposal
    function state(
        uint256 proposalId
    ) external view returns (ProposalState);

    /// @notice Generates the data for the module transaction hash (required for signing)
    /// @param to The target address of the transaction
    /// @param value The Ether value to send with the transaction
    /// @param data The encoded function call data of the transaction
    /// @param operation The operation to use for the transaction
    /// @param nonce The Safe nonce of the transaction
    /// @return bytes The hash transaction data
    function generateTxHashData(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 nonce
    ) external view returns (bytes memory);

    /// @notice Returns the hash of a transaction in a proposal
    /// @param proposalId The ID of the proposal
    /// @param txIndex The index of the transaction within the proposal
    /// @return bytes32 The hash of the specified transaction
    function getProposalTxHash(
        uint256 proposalId,
        uint256 txIndex
    ) external view returns (bytes32);

    /// @notice Returns the keccak256 hash of the specified transaction
    /// @param to The target address of the transaction
    /// @param value The Ether value to send with the transaction
    /// @param data The encoded function call data of the transaction
    /// @param operation The operation to use for the transaction
    /// @return bytes32 The transaction hash
    function getTxHash(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation
    ) external view returns (bytes32);

    /// @notice Gets the transaction hashes associated with a given proposald
    /// @param proposalId The ID of the proposal to get the tx hashes for
    /// @return bytes32[] The array of tx hashes
    function getProposalTxHashes(
        uint256 proposalId
    ) external view returns (bytes32[] memory);

    function getProposal(
        uint256 proposalId
    )
        external
        view
        returns (
            bool canceled,
            uint256 timelockPeriod,
            bytes32[] memory txHashes,
            uint256 executionCounter,
            address strategy
        );
}
