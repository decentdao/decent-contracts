// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {Transaction} from "../Module.sol";

interface IModuleAzoriusV1 {
    // --- Errors ---

    error InvalidStrategy();
    error InvalidProposal();
    error InvalidProposer();
    error ProposalNotExecutable();
    error InvalidTxHash();
    error TxFailed();
    error InvalidTxs();

    // --- Structs ---

    struct Proposal {
        uint32 executionCounter;
        uint32 timelockPeriod;
        uint32 executionPeriod;
        address strategy;
        bytes32[] txHashes;
    }

    // --- Enums ---

    enum ProposalState {
        ACTIVE,
        TIMELOCKED,
        EXECUTABLE,
        EXECUTED,
        EXPIRED,
        FAILED
    }

    // --- Events ---

    event ProposalCreated(
        address strategy,
        uint32 proposalId,
        address proposer,
        Transaction[] transactions,
        string metadata
    );
    event ProposalExecuted(uint32 proposalId, bytes32[] txHashes);
    event TimelockPeriodUpdated(uint32 timelockPeriod);
    event ExecutionPeriodUpdated(uint32 executionPeriod);
    event StrategyUpdated(address strategy);

    // --- Initializer Functions ---

    function initialize(
        address owner_,
        address avatar_,
        address target_,
        uint32 timelockPeriod_,
        uint32 executionPeriod_
    ) external;

    // --- View Functions ---

    function totalProposalCount()
        external
        view
        returns (uint32 totalProposalCount);

    function timelockPeriod() external view returns (uint32 timelockPeriod);

    function executionPeriod() external view returns (uint32 executionPeriod);

    function proposals(
        uint32 proposalId_
    ) external view returns (Proposal memory proposal);

    function strategy() external view returns (address strategy);

    function proposalState(
        uint32 proposalId_
    ) external view returns (ProposalState proposalState);

    function generateTxHashData(
        Transaction calldata transaction_,
        uint256 nonce_
    ) external view returns (bytes memory txHashData);

    function getTxHash(
        Transaction calldata transaction_
    ) external view returns (bytes32 txHash);

    function getProposalTxHash(
        uint32 proposalId_,
        uint32 txIndex_
    ) external view returns (bytes32 txHash);

    function getProposalTxHashes(
        uint32 proposalId_
    ) external view returns (bytes32[] memory txHashes);

    function getProposal(
        uint32 proposalId_
    )
        external
        view
        returns (
            address strategy,
            bytes32[] memory txHashes,
            uint32 timelockPeriod,
            uint32 executionPeriod,
            uint32 executionCounter
        );

    // --- State-Changing Functions ---

    function updateTimelockPeriod(uint32 timelockPeriod_) external;

    function updateExecutionPeriod(uint32 executionPeriod_) external;

    function updateStrategy(address strategy_) external;

    function submitProposal(
        Transaction[] calldata transactions_,
        string calldata metadata_,
        address proposerAdapter_,
        bytes calldata proposerAdapterData_
    ) external;

    function executeProposal(
        uint32 proposalId_,
        Transaction[] calldata transactions_
    ) external;
}
