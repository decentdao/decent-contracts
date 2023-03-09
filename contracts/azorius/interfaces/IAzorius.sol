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
        // destination address of the transaction
        address to;
        // amount of ETH to transfer with the transaction
        uint256 value;
        // encoded function call data of the transaction
        bytes data;
        // Operation type, Call or DelegateCall
        Enum.Operation operation;
    }

    /**
     * A struct which holds details pertaining to a single proposal.
     */
    struct Proposal {
        // BaseStrategy contract this proposal was created on
        address strategy;
        // hashes of the transactions that are being proposed
        bytes32[] txHashes;
        // time (in seconds) this proposal will be timelocked for if it passes
        uint256 timelockPeriod;
        // time (in seconds) this proposal has to be executed after timelock
        // ends before it is expired
        uint256 executionPeriod;
        // count of transactions that have been executed within the proposal
        uint256 executionCounter;
    }

    /**
     * The list of states in which a Proposal can be in at any given time.
     *
     * Proposals begin in the ACTIVE state and will ultimately end in either
     * the EXECUTED, EXPIRED, or FAILED state.
     *
     * ACTIVE - a new proposal begins in this state, and stays in this state
     *          for the duration of its voting period.
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
     *          For a basic strategy, this would mean it received more NO votes than YES. 
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
     * @param _strategy contract address of the BaseStrategy to be enabled.
     */
    function enableStrategy(address _strategy) external;

    /**
     * Disables a previously enabled BaseStrategy implementation for new proposal.
     * This has no effect on existing Proposals, either ACTIVE or completed.
     *
     * @param _prevStrategy BaseStrategy that pointed to the strategy to be removed in the linked list
     * @param _strategy BaseStrategy implementation to be removed
     */
    function disableStrategy(address _prevStrategy, address _strategy) external;

    /**
     * Updates the timelockPeriod for newly created Proposals.
     * This has no effect on existing Proposals, either ACTIVE or completed.
     * @param _timelockPeriod The timelockPeriod (in seconds) to be used for new Proposals.
     */
    function updateTimelockPeriod(uint256 _timelockPeriod) external;

    /**
     * Submits a new Proposal, using one of the enabled BaseStrategies.
     * New Proposals begin immediately in the ACTIVE state.
     *
     * @param _strategy address of the BaseStrategy implementation which the Proposal will use.
     * @param _data arbitrary data passed to the BaseStrategy implementation
     * @param _transactions array of transactions to propose
     * @param _metadata additional data such as a title/description to submit with the proposal
     */
    function submitProposal(
        address _strategy,
        bytes memory _data,
        Transaction[] calldata _transactions,
        string calldata _metadata
    ) external;

    /**
     * Executes the specified Proposal.
     *
     * Transactions must be called in order.
     *
     * @param _proposalId identifier of the proposal
     * @param _target contract to be called by the avatar
     * @param _value ETH value to pass with the call
     * @param _data data to be executed from the call
     * @param _operation Call or Delegatecall
     */
    function executeProposalByIndex(
        uint256 _proposalId,
        address _target,
        uint256 _value,
        bytes memory _data,
        Enum.Operation _operation
    ) external;

    /**
     * Executes all transactions within a Proposal.
     *
     * @param _proposalId identifier of the Proposal
     * @param _targets target contracts for each transaction
     * @param _values ETH values to be sent with each transaction
     * @param _data transaction data to be executed
     * @param _operations Calls or Delegatecalls
     */
    function executeProposalBatch(
        uint256 _proposalId,
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _data,
        Enum.Operation[] memory _operations
    ) external;

    /**
     * Returns whether a BaseStrategy implementation is enabled.
     *
     * @param _strategy contract address of the BaseStrategy to check
     * @return bool True if the strategy is enabled, otherwise False
     */
    function isStrategyEnabled(address _strategy) external view returns (bool);

    /**
     * Returns an array of enabled BaseStrategy contract addresses.
     * Because the list of BaseStrategies is technically unbounded, this
     * requires the address of the first strategy you would like, along
     * with the total count of strategies to return, rather than
     * returning the whole list at once.
     *
     * @param _startAddress contract address of the BaseStrategy to start with
     * @param _count maximum number of BaseStrategies that should be returned
     * @return _strategies array of BaseStrategies
     * @return _next next BaseStrategy contract address in the linked list
     */
    function getStrategies(
        address _startAddress,
        uint256 _count
    ) external view returns (address[] memory _strategies, address _next);

    /**
     * Returns true if a proposal transaction by index is executed.
     *
     * @param _proposalId identifier of the proposal
     * @param _index index of the transaction within the proposal
     * @return bool True if the transaction has been executed, otherwise False
     */
    function isTxExecuted(uint256 _proposalId, uint256 _index) external view returns (bool);

    /**
     * Gets the state of a Proposal.
     *
     * @param _proposalId identifier of the Proposal
     * @return ProposalState uint256 ProposalState enum value representing of the
     *         current state of the proposal
     */
    function proposalState(uint256 _proposalId) external view returns (ProposalState);

    /**
     * Generates the data for the module transaction hash (required for signing).
     *
     * @param _to target address of the transaction
     * @param _value ETH value to send with the transaction
     * @param _data encoded function call data of the transaction
     * @param _operation Enum.Operation to use for the transaction
     * @param _nonce Safe nonce of the transaction
     * @return bytes hashed transaction data
     */
    function generateTxHashData(
        address _to,
        uint256 _value,
        bytes memory _data,
        Enum.Operation _operation,
        uint256 _nonce
    ) external view returns (bytes memory);

    /**
     * Returns the hash of a transaction in a Proposal.
     *
     * @param _proposalId identifier of the Proposal
     * @param _txIndex index of the transaction within the Proposal
     * @return bytes32 hash of the specified transaction
     */
    function getProposalTxHash(uint256 _proposalId, uint256 _txIndex) external view returns (bytes32);

    /**
     * Returns the keccak256 hash of the specified transaction.
     *
     * @param _to target address of the transaction
     * @param _value ETH value to send with the transaction
     * @param _data encoded function call data of the transaction
     * @param _operation Enum.Operation to use for the transaction
     * @return bytes32 transaction hash
     */
    function getTxHash(
        address _to,
        uint256 _value,
        bytes memory _data,
        Enum.Operation _operation
    ) external view returns (bytes32);

    /**
     * Returns the transaction hashes associated with a given proposalId.
     *
     * @param _proposalId identifier of the Proposal to get transaction hashes for
     * @return bytes32[] array of transaction hashes
     */
    function getProposalTxHashes(uint256 _proposalId) external view returns (bytes32[] memory);

    /**
     * Returns details about the specified Proposal.
     *
     * @param _proposalId identifier of the Proposal
     * @return _strategy address of the BaseStrategy contract the Proposal is on
     * @return _txHashes hashes of the transactions the Proposal contains
     * @return _timelockPeriod time (in seconds) the Proposal is timelocked for
     * @return _executionPeriod time (in seconds) the Proposal must be executed within, after timelock ends
     * @return _executionCounter counter of how many of the Proposals transactions have been executed
     */
    function getProposal(uint256 _proposalId) external view
        returns (
            address _strategy,
            bytes32[] memory _txHashes,
            uint256 _timelockPeriod,
            uint256 _executionPeriod,
            uint256 _executionCounter
        );
}