// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {IVerifierV1} from "../../interfaces/decent/services/IVerifierV1.sol";
import {IVersion} from "../../interfaces/decent/deployables/IVersion.sol";
import {IDeploymentBlock} from "../../interfaces/decent/IDeploymentBlock.sol";
import {
    DeploymentBlockNonInitializable
} from "../../DeploymentBlockNonInitializable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {
    Ownable2Step,
    Ownable
} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title VerifierV1
 * @author Decent Labs
 * @notice General-purpose verification service using EIP-712 signature verification
 * @dev Implements IVerifierV1 for flexible verification
 *
 * Implementation details:
 * - Uses EIP-712 structured data signing for verification
 * - Requires signature from authorized verifier address
 * - Deployed as singleton service per chain
 * - Supports operating contract-specific verification
 *
 * Security considerations:
 * - Verifier address is immutable and set at deployment
 * - Uses ECDSA signature recovery for verification
 * - EIP-712 prevents signature replay across different domains
 * - Operating contract context prevents cross-contract signature reuse
 *
 * @custom:security-contact security@decentlabs.io
 */
contract VerifierV1 is
    IVerifierV1,
    IVersion,
    DeploymentBlockNonInitializable,
    ERC165,
    EIP712,
    Ownable2Step
{
    // ======================================================================
    // STATE VARIABLES
    // ======================================================================

    address private _signer;

    mapping(address account => uint256 nonce) private _nonces;

    bytes32 internal constant TYPEHASH =
        keccak256(
            "VerificationData(address operator,address account,uint48 signatureExpiration,uint256 nonce)"
        );

    // ======================================================================
    // CONSTRUCTOR & INITIALIZERS
    // ======================================================================

    constructor(
        address owner_,
        address signer_
    ) EIP712("Verifier", "1") Ownable(owner_) {
        _signer = signer_;
    }

    // ======================================================================
    // IVerifier
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc IVerifierV1
     */
    function signer() public view virtual override returns (address) {
        return _signer;
    }

    /**
     * @inheritdoc IVerifierV1
     */
    function nonce(
        address account_
    ) public view virtual override returns (uint256) {
        return _nonces[account_];
    }

    /**
     * @inheritdoc IVerifierV1
     */
    function checkVerify(
        address operator_,
        address account_,
        uint48 signatureExpiration_,
        bytes calldata signature_
    ) public view virtual override returns (bool) {
        if (block.timestamp > signatureExpiration_) {
            return false;
        }

        return
            ECDSA.recover(
                _hashTypedDataV4(
                    keccak256(
                        abi.encode(
                            TYPEHASH,
                            operator_,
                            account_,
                            signatureExpiration_,
                            _nonces[account_]
                        )
                    )
                ),
                signature_
            ) == _signer;
    }

    // --- State-Changing Functions ---

    /**
     * @inheritdoc IVerifierV1
     * @dev Verifies account status using EIP-712 signature verification. The signature
     * must be provided by the authorized verifier address.
     */
    function verify(
        address account_,
        uint48 signatureExpiration_,
        bytes calldata signature_
    ) public virtual override {
        if (block.timestamp > signatureExpiration_) {
            revert SignatureExpired();
        }

        uint256 accountNonce = _nonces[account_];

        if (
            ECDSA.recover(
                _hashTypedDataV4(
                    keccak256(
                        abi.encode(
                            TYPEHASH,
                            msg.sender,
                            account_,
                            signatureExpiration_,
                            accountNonce
                        )
                    )
                ),
                signature_
            ) == _signer
        ) {
            // signature is valid
            _nonces[account_]++;

            emit SignatureVerified(
                msg.sender,
                account_,
                signatureExpiration_,
                accountNonce
            );
        } else {
            // signature is invalid
            revert InvalidSignature();
        }
    }

    /**
     * @inheritdoc IVerifierV1
     */
    function updateSigner(address signer_) public virtual override onlyOwner {
        _signer = signer_;

        emit SignerUpdated(signer_);
    }

    // ======================================================================
    // IVersion
    // ======================================================================

    // --- Pure Functions ---

    /**
     * @inheritdoc IVersion
     */
    function version() public pure virtual override returns (uint16) {
        return 1;
    }

    // ======================================================================
    // ERC165
    // ======================================================================

    // --- View Functions ---

    /**
     * @inheritdoc ERC165
     * @dev Supports IVerifierV1, IVersion, IDeploymentBlock, and IERC165
     */
    function supportsInterface(
        bytes4 interfaceId_
    ) public view virtual override returns (bool) {
        return
            interfaceId_ == type(IVerifierV1).interfaceId ||
            interfaceId_ == type(IVersion).interfaceId ||
            interfaceId_ == type(IDeploymentBlock).interfaceId ||
            super.supportsInterface(interfaceId_);
    }
}
