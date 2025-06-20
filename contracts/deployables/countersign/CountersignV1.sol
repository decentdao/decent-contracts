// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IKYCVerifierV1} from "../../interfaces/decent/services/IKYCVerifierV1.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {ICountersignV1} from "../../interfaces/decent/deployables/ICountersignV1.sol";
import {IDeploymentBlockV1} from "../../interfaces/decent/IDeploymentBlockV1.sol";
import {IMultisend} from "../../interfaces/safe/IMultiSend.sol";
import {DeploymentBlockV1} from "../../DeploymentBlockV1.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

contract CountersignV1 is
    ICountersignV1,
    IVersion,
    DeploymentBlockV1,
    ERC165,
    Ownable2StepUpgradeable
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    /// @custom:storage-location erc7201:Decent.Countersign.main
    struct CountersignStorage {
        bool initialExecutionComplete;
        string agreementUri;
        address kycVerifier;
        uint48 signingDeadline;
        uint48 executionDeadline;
        address multisend;
        uint256 minWeight;
        address[] signerAddresses;
        mapping(address signer => Signer signerData) signerData;
        bytes preExecutionTransactions;
    }

    // EIP-7201: keccak256(abi.encode(uint256(keccak256("Decent.Countersign.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant COUNTERSIGN_STORAGE_LOCATION =
        0x17e3324905ecbcdb5282616f8444afa635592330380c984274eec8eac2a85400;

    function _getCountersignStorage()
        internal
        pure
        returns (CountersignStorage storage $)
    {
        assembly {
            $.slot := COUNTERSIGN_STORAGE_LOCATION
        }
    }

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        string memory agreementUri_,
        address kycVerifier_,
        uint48 signingDeadline_,
        uint48 executionDeadline_,
        address multisend_,
        uint256 minWeight_,
        bytes memory preExecutionTransactions_,
        SignerInitialization[] memory signerInitializations_
    ) public virtual override initializer {
        __Ownable_init(owner_);
        __DeploymentBlockV1_init();

        CountersignStorage storage $ = _getCountersignStorage();
        $.agreementUri = agreementUri_;
        $.kycVerifier = kycVerifier_;
        $.signingDeadline = signingDeadline_;
        $.executionDeadline = executionDeadline_;
        $.multisend = multisend_;
        $.minWeight = minWeight_;
        $.preExecutionTransactions = preExecutionTransactions_;

        for (uint256 i = 0; i < signerInitializations_.length; ) {
            SignerInitialization memory signerInit = signerInitializations_[i];

            $.signerAddresses.push(signerInit.account);

            Signer storage signer = $.signerData[signerInit.account];
            signer.isSigner = true;
            signer.required = signerInit.required;
            signer.weight = signerInit.weight;
            signer.transactions = signerInit.transactions;

            unchecked {
                ++i;
            }
        }
    }

    // ======================================================================
    // ICountersignV1
    // ======================================================================

    // --- View Functions ---

    function initialExecutionComplete()
        public
        view
        virtual
        override
        returns (bool)
    {
        CountersignStorage storage $ = _getCountersignStorage();
        return $.initialExecutionComplete;
    }

    function agreementUri()
        public
        view
        virtual
        override
        returns (string memory)
    {
        CountersignStorage storage $ = _getCountersignStorage();
        return $.agreementUri;
    }

    function kycVerifier() public view virtual override returns (address) {
        CountersignStorage storage $ = _getCountersignStorage();
        return $.kycVerifier;
    }

    function signingDeadline() public view virtual override returns (uint48) {
        CountersignStorage storage $ = _getCountersignStorage();
        return $.signingDeadline;
    }

    function executionDeadline() public view virtual override returns (uint48) {
        CountersignStorage storage $ = _getCountersignStorage();
        return $.executionDeadline;
    }

    function multisend() public view virtual override returns (address) {
        CountersignStorage storage $ = _getCountersignStorage();
        return $.multisend;
    }

    function minWeight() public view virtual override returns (uint256) {
        CountersignStorage storage $ = _getCountersignStorage();
        return $.minWeight;
    }

    function signerAddresses()
        public
        view
        virtual
        override
        returns (address[] memory)
    {
        CountersignStorage storage $ = _getCountersignStorage();
        return $.signerAddresses;
    }

    function signerData(
        address signer_
    )
        public
        view
        override
        returns (bool, bool, bool, bool, uint48, uint256, bytes memory)
    {
        CountersignStorage storage $ = _getCountersignStorage();
        Signer storage signer = $.signerData[signer_];

        return (
            signer.isSigner,
            signer.required,
            signer.signed,
            signer.executed,
            signer.signedTimestamp,
            signer.weight,
            signer.transactions
        );
    }

    function preExecutionTransactions()
        public
        view
        virtual
        override
        returns (bytes memory)
    {
        CountersignStorage storage $ = _getCountersignStorage();
        return $.preExecutionTransactions;
    }

    // --- State-Changing Functions ---

    function sign() public virtual override {
        CountersignStorage storage $ = _getCountersignStorage();
        if (block.timestamp > $.signingDeadline) {
            revert SigningDeadlineElapsed();
        }

        Signer storage signer = $.signerData[msg.sender];

        if (!signer.isSigner) {
            revert InvalidSigner();
        }

        if (signer.signed) {
            revert SignerAlreadySigned();
        }

        if (!IKYCVerifierV1($.kycVerifier).verify(msg.sender)) {
            revert InvalidKYCSignature();
        }

        signer.signed = true;
        signer.signedTimestamp = uint48(block.timestamp);

        emit Signed(msg.sender);
    }

    function execute() public virtual override onlyOwner {
        CountersignStorage storage $ = _getCountersignStorage();

        if (block.timestamp < $.signingDeadline) {
            revert SigningDeadlineNotElapsed();
        }

        if (block.timestamp > $.executionDeadline) {
            revert ExecutionDeadlineElapsed();
        }

        if (!$.initialExecutionComplete) {
            _initialExecution($);
        } else {
            _followUpExecutions($);
        }
    }

    // ======================================================================
    // IVersion
    // ======================================================================

    // --- Pure Functions ---

    function version() public pure virtual override returns (uint16) {
        return 1;
    }

    // ======================================================================
    // ERC165
    // ======================================================================

    // --- View Functions ---

    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(ICountersignV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlockV1).interfaceId ||
            super.supportsInterface(interfaceId_);
    }

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    function _initialExecution(CountersignStorage storage $) internal {
        if ($.preExecutionTransactions.length > 0) {
            (bool success, ) = $.multisend.delegatecall(
                abi.encodeCall(IMultisend.multiSend, $.preExecutionTransactions)
            );

            if (!success) {
                revert PreExecutionTxFailed();
            }
        }

        uint256 executedWeight;

        for (uint256 i = 0; i < $.signerAddresses.length; ) {
            address signerAddress = $.signerAddresses[i];
            Signer storage signer = $.signerData[signerAddress];

            if (!signer.signed) {
                if (signer.required)
                    revert RequiredSignerNotSigned(signerAddress);

                unchecked {
                    ++i;
                }
                continue;
            }

            if (signer.transactions.length > 0) {
                (bool success, ) = $.multisend.delegatecall(
                    abi.encodeCall(IMultisend.multiSend, signer.transactions)
                );

                if (success) {
                    signer.executed = true;
                    executedWeight += signer.weight;
                    emit SignerTxExecuted(signerAddress);
                } else {
                    if (signer.required) {
                        revert RequiredSignerTxFailed(signerAddress);
                    } else {
                        emit SignerTxFailed(signerAddress);
                    }
                }
            }

            unchecked {
                ++i;
            }
        }

        if (executedWeight < $.minWeight) {
            revert MinimumWeightNotMet();
        }

        $.initialExecutionComplete = true;
    }

    function _followUpExecutions(CountersignStorage storage $) internal {
        for (uint256 i = 0; i < $.signerAddresses.length; ) {
            address signerAddress = $.signerAddresses[i];
            Signer storage signer = $.signerData[signerAddress];

            if (
                !signer.signed ||
                signer.executed ||
                signer.transactions.length == 0
            ) {
                unchecked {
                    ++i;
                }
                continue;
            }

            (bool success, ) = $.multisend.delegatecall(
                abi.encodeCall(IMultisend.multiSend, signer.transactions)
            );

            if (success) {
                signer.executed = true;
                emit SignerTxExecuted(signerAddress);
            } else {
                emit SignerTxFailed(signerAddress);
            }

            unchecked {
                ++i;
            }
        }
    }
}
