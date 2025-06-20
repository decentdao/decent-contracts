// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

interface ICountersignV1 {
    // --- Errors ---

    error InvalidSigner();
    error SigningDeadlineElapsed();
    error ExecutionDeadlineElapsed();
    error SignerAlreadySigned();
    error RequiredSignerNotSigned(address signer);
    error InvalidKYCSignature();
    error RequiredSignerTxFailed(address signer);
    error MinimumWeightNotMet();
    error SigningDeadlineNotElapsed();
    error PreExecutionTxFailed();

    // --- Structs ---

    struct SignerInitialization {
        address account;
        bool required;
        uint256 weight;
        bytes transactions;
    }

    struct Signer {
        bool isSigner;
        bool required;
        bool signed;
        bool executed;
        uint48 signedTimestamp;
        uint256 weight;
        bytes transactions;
    }

    // --- Events ---

    event Signed(address indexed signer);
    event SignerTxExecuted(address indexed signer);
    event SignerTxFailed(address indexed signer);

    // --- Initializer Functions ---

    function initialize(
        address owner_,
        string memory agreementUri_,
        address verificationContract_,
        uint48 signingDeadline_,
        uint48 executionDeadline_,
        address multisend_,
        uint256 minWeight_,
        bytes memory preExecutionTransactions_,
        SignerInitialization[] memory signerInitializations_
    ) external;

    // --- View Functions ---

    function initialExecutionComplete() external view returns (bool isComplete);

    function agreementUri() external view returns (string memory agreementUri);

    function kycVerifier() external view returns (address kycVerifier);

    function signingDeadline() external view returns (uint48 signingDeadline);

    function executionDeadline()
        external
        view
        returns (uint48 executionDeadline);

    function multisend() external view returns (address multisend);

    function minWeight() external view returns (uint256 minWeight);

    function signerAddresses()
        external
        view
        returns (address[] memory signerAddresses);

    function signerData(
        address signer_
    )
        external
        view
        returns (
            bool isSigner,
            bool required,
            bool signed,
            bool executed,
            uint48 signedTimestamp,
            uint256 weight,
            bytes memory transactions
        );

    function preExecutionTransactions()
        external
        view
        returns (bytes memory preExecutionTransactions);

    // --- State-Changing Functions ---

    function sign() external;

    function execute() external;
}
