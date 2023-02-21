//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "../FractalUsul.sol";

interface IFractalUsul {
    enum ProposalState {
        ACTIVE,
        TIMELOCKED,
        EXECUTABLE,
        EXECUTED,
        FAILED
    }

    /// @notice Enables a voting strategy that can vote on proposals, only callable by the owner
    /// @param _strategy Address of the strategy to be enabled
    function enableStrategy(address _strategy) external;

    /// @notice Disables a voting strategy on the module, only callable by the owner
    /// @param _prevStrategy Strategy that pointed to the strategy to be removed in the linked list
    /// @param _strategy Strategy to be removed
    function disableStrategy(address _prevStrategy, address _strategy) external;

    /// @notice Updates the timelock period - time between queuing and when a proposal can be executed
    /// @param _newTimelockPeriod The new timelock period in seconds
    function updateTimelockPeriod(
        uint256 _newTimelockPeriod
    ) external;

    /// @notice This method submits a proposal which includes metadata strings to describe the proposal
    /// @param _strategy Address of the voting strategy which the proposal will be submitted to
    /// @param _data Additional data which will be passed to the strategy contract
    /// @param _transactions Array of transactions to execute
    /// @param _metadata Any additional metadata such as a title or description to submit with the proposal
    function submitProposal(
        address _strategy,
        bytes memory _data,
        FractalUsul.Transaction[] calldata _transactions,
        string calldata _metadata
    ) external;

    /// @notice Called by the strategy contract when the proposal vote has succeeded
    /// @param _proposalId The ID of the proposal
    function timelockProposal(uint256 _proposalId) external;

    /// @notice Executes the specified transaction within a proposal
    /// @notice Transactions must be called in order
    /// @param _proposalId the identifier of the proposal
    /// @param _target the contract to be called by the avatar
    /// @param _value ether value to pass with the call
    /// @param _data the data to be executed from the call
    /// @param _operation Call or Delegatecall
    function executeProposalByIndex(
        uint256 _proposalId,
        address _target,
        uint256 _value,
        bytes memory _data,
        Enum.Operation _operation
    ) external;

    /// @notice Executes all the transactions within a proposal
    /// @param _proposalId the identifier of the proposal
    /// @param _targets the contracts to be called by the avatar
    /// @param _values ether values to pass with the calls
    /// @param _data the data to be executed from the calls
    /// @param _operations Calls or Delegatecalls
    function executeProposalBatch(
        uint256 _proposalId,
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _data,
        Enum.Operation[] memory _operations
    ) external;

    /// @notice Returns if a strategy is enabled
    /// @param _strategy The address of the strategy to check
    /// @return True if the strategy is enabled
    function isStrategyEnabled(address _strategy) external view returns (bool);

    /// @notice Returns array of strategy contract addresses
    /// @param _startAddress Address in the strategy linked list to start with
    /// @param _count Maximum number of strategies that should be returned
    /// @return _strategies Array of strategy
    /// @return _next Next address in the linked list
    function getStrategies(
        address _startAddress,
        uint256 _count
    ) external view returns (address[] memory _strategies, address _next);

    /// @notice Returns true if a proposal transaction by index is executed
    /// @param _proposalId The ID of the proposal
    /// @param _index The index of the transaction within the proposal
    /// @return bool True if the transaction has been executed
    function isTxExecuted(
        uint256 _proposalId,
        uint256 _index
    ) external view returns (bool);

    /// @notice Gets the state of a proposal
    /// @param _proposalId The ID of the proposal
    /// @return ProposalState the uint256 representing of the state of the proposal
    function proposalState(
        uint256 _proposalId
    ) external view returns (ProposalState);

    /// @notice Generates the data for the module transaction hash (required for signing)
    /// @param _to The target address of the transaction
    /// @param _value The Ether value to send with the transaction
    /// @param _data The encoded function call data of the transaction
    /// @param _operation The operation to use for the transaction
    /// @param _nonce The Safe nonce of the transaction
    /// @return bytes The hash transaction data
    function generateTxHashData(
        address _to,
        uint256 _value,
        bytes memory _data,
        Enum.Operation _operation,
        uint256 _nonce
    ) external view returns (bytes memory);

    /// @notice Returns the hash of a transaction in a proposal
    /// @param _proposalId The ID of the proposal
    /// @param _txIndex The index of the transaction within the proposal
    /// @return bytes32 The hash of the specified transaction
    function getProposalTxHash(
        uint256 _proposalId,
        uint256 _txIndex
    ) external view returns (bytes32);

    /// @notice Returns the keccak256 hash of the specified transaction
    /// @param _to The target address of the transaction
    /// @param _value The Ether value to send with the transaction
    /// @param _data The encoded function call data of the transaction
    /// @param _operation The operation to use for the transaction
    /// @return bytes32 The transaction hash
    function getTxHash(
        address _to,
        uint256 _value,
        bytes memory _data,
        Enum.Operation _operation
    ) external view returns (bytes32);

    /// @notice Gets the transaction hashes associated with a given proposald
    /// @param _proposalId The ID of the proposal to get the tx hashes for
    /// @return bytes32[] The array of tx hashes
    function getProposalTxHashes(
        uint256 _proposalId
    ) external view returns (bytes32[] memory);

    /// @notice Gets details about the specified proposal
    /// @param _proposalId The ID of the proposal
    /// @return _timelockDeadline Timestamp the proposal deadline ends can be executed
    /// @return _txHashes The hashes of the transactions the proposal contains
    /// @return _executionCounter Counter of how many of the proposal transactions have been executed
    /// @return _strategy The address of the strategy contract the proposal is on
    function getProposal(
        uint256 _proposalId
    )
        external
        view
        returns (
            uint256 _timelockDeadline,
            bytes32[] memory _txHashes,
            uint256 _executionCounter,
            address _strategy
        );
}
