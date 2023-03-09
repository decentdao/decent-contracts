//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";

/**
 * @title Azorius spec - the base interface for the Azorius governance Safe module.
 * Azorius conforms to the Zodiac pattern for Safe modules: https://github.com/gnosis/zodiac
 */
interface IAzorius {

    /**
     * A struct which represents a transaction to perform on the blockchain.
     */
    struct Transaction {
        // the recipient address of the transaction TODO should this be named recipient?
        // https://ethereum.org/en/developers/docs/transactions/#whats-a-transaction
        address to;
        // Amount of ETH to transfer with the transaction.
        uint256 value;
        // Encoded function call data of the transaction.
        bytes data;
        // Operation type. TODO what's this?
        Enum.Operation operation;
    }

    /**
     * A struct which holds details pertaining to a single proposal.
     */
    struct Proposal {
        // the BaseStrategy contract this proposal was created on
        address strategy;
        // hashes of the transactions that are being proposed
        bytes32[] txHashes;
        // time (in seconds) this proposal will be timelocked for if it passes
        uint256 timelockPeriod;
        // time (in seconds) this proposal has to be executed after timelock
        // ends before it is expired
        uint256 executionPeriod;
        // the count of transactions that have been executed within the proposal
        uint256 executionCounter;
    }

    /**
     * The list of states in which a Proposal can be in at any given time.
     *
     * Proposals begin in the ACTIVE state and will ultimately end in either
     * the EXECUTED, EXPIRED, or FAILED state.
     *
     * ACTIVE - a new proposal begins in this state, and stays in this state
     *          for the duration of its voting period. TODO
     * TIMELOCKED - A proposal that passes enters the TIMELOCKED state, during which
     *          it cannot yet be executed.  This is to allow time for token holders
     *          to potentially exit their position, as well as parent DAOs time to
     *          initiate a Freeze, if they choose to do so. A proposal stays timelocked
     *          for the duration of its timelockPeriod.
     * EXECUTABLE - Following the TIMELOCKED state, a passed proposal becomes executable,
     *          and can then finally be executed on chain by anyone.
     * EXECUTED - the final state for a passed proposal.  The proposal has been executed
     *          on the blockchain.
     * EXPIRED - a passed proposal which is not executed before its executionPeriod has
     *          elapsed will be EXPIRED, and can no longer be executed.
     * FAILED - a failed proposal (as defined in its BaseStrategy isPassed function).
     *          For a standard strategy, this would mean it received more NO votes than YES. 
     */
    enum ProposalState {
        ACTIVE,
        TIMELOCKED,
        EXECUTABLE,
        EXECUTED,
        EXPIRED,
        FAILED
    }

    /**
     * Enables a BaseStrategy implementation for newly created Proposals.
     *
     * Multiple strategies can be enabled, and new Proposals will be able to be
     * created using any of the currently enabled strategies.
     *
     * @param _strategy Address of the BaseStrategy to be enabled.
     */
    function enableStrategy(address _strategy) external;

    /**
     * Disables a previously enabled BaseStrategy implementation for new proposal.
     * This has no effect on existing Proposals, either ACTIVE or completed.
     *
     * @param _prevStrategy the BaseStrategy that pointed to the strategy to be removed in the linked list
     *          TODO we should find a way to remove this _prevStrategy
     * @param _strategy the BaseStrategy implementation to be removed
     */
    function disableStrategy(address _prevStrategy, address _strategy) external;

    /**
     * Updates the timelockPeriod for newly created Proposals.
     * This has no effect on existing Proposals, either ACTIVE or completed.
     * @param _newTimelockPeriod The timelockPeriod (in seconds) to be used for new Proposals.
     * TODO should we remove the word 'new' from this somehow?
     */
    function updateTimelockPeriod(uint256 _newTimelockPeriod) external;

    /**
     * Submits a new Proposal, using one of the enabled BaseStrategies.
     * New Proposals begin immediately in the ACTIVE state.
     *
     * @param _strategy address of the BaseStrategy implementation which the Proposal will use.
     * @param _data arbitrary data TODO what is this?
     * @param _transactions An array of transactions to propose.
     * @param _metadata Any additional metadata such as a title or description to submit with the proposal.
     */
    function submitProposal(
        address _strategy,
        bytes memory _data,
        Transaction[] calldata _transactions,
        string calldata _metadata
    ) external;

    /**
     * Executes the specified Proposal. TODO why do we need to match the hashes here? can't it just be _proposalId ?
     * @notice Transactions must be called in order. TODO what's this mean?
     * TODO pretty sure this should be _proposalIndex, not _proposalId here???
     *
     * @param _proposalId the identifier of the proposal
     * @param _target the contract to be called by the avatar
     * @param _value ether value to pass with the call
     * @param _data the data to be executed from the call
     * @param _operation Call or Delegatecall
     */
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
    /// @return _strategy The address of the strategy contract the proposal is on
    /// @return _txHashes The hashes of the transactions the proposal contains
    /// @return _timelockPeriod The time in seconds the proposal is timelocked for
    /// @return _executionPeriod The time in seconds the proposal has to be executed after timelock ends
    /// @return _executionCounter Counter of how many of the proposal transactions have been executed
    function getProposal(
        uint256 _proposalId
    )
        external
        view
        returns (
            address _strategy,
            bytes32[] memory _txHashes,
            uint256 _timelockPeriod,
            uint256 _executionPeriod,
            uint256 _executionCounter
        );
}
