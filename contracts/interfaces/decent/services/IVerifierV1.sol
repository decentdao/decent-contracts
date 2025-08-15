// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

/**
 * @title IVerifierV1
 * @notice Service interface for verification
 * @dev This interface provides a standard way to verify if an address has completed
 * verification requirements. It's designed as a service contract that can be deployed once
 * per chain and referenced by multiple contracts that need verification. The signer will typically
 * be a backend service that is responsible for signing verifications. Verification could include
 * KYC, KYB, whitelisting, etc.
 *
 * Key features:
 * - verify function that reverts if the signature is invalid or expired
 * - checkVerify view function that returns a boolean indicating if a signature is valid
 *
 *
 * Security:
 * - Verification logic is critical for compliance
 */
interface IVerifierV1 {
    // --- Errors ---

    /** @notice Thrown when the signature has expired */
    error SignatureExpired();

    /** @notice Thrown when the signature is invalid */
    error InvalidSignature();

    // --- Events ---

    /**
     * @notice Emitted when a signature is verified
     * @param operator The address of the operator that is verifying
     * @param account The address to verify for
     * @param signatureExpiration The expiration timestamp of the signature
     * @param nonce The nonce used for the signature
     */
    event SignatureVerified(
        address indexed operator,
        address indexed account,
        uint48 signatureExpiration,
        uint256 nonce
    );

    /**
     * @notice Emitted when the signer address is updated
     * @param signer The address of the signer
     */
    event SignerUpdated(address indexed signer);

    // --- View Functions ---

    /**
     * @notice Returns the address of the signer
     * @dev The signer is the address that is authorized to sign verifications
     * @return signerAddress The address of the signer
     */
    function signer() external view returns (address signerAddress);

    /**
     * @notice Returns the nonce for an account
     * @param account_ The address to get the nonce for
     * @return nonce The nonce for the account
     */
    function nonce(address account_) external view returns (uint256 nonce);

    /**
     * @notice Checks if a signature is valid
     * @param operator_ The address of the operator that is verifying
     * @param account_ The address to verify for
     * @param signatureExpiration_ The expiration timestamp of the signature
     * @param signature_ The signer signature attesting to verification
     * @return isValid Whether the signature is valid
     */
    function checkVerify(
        address operator_,
        address account_,
        uint48 signatureExpiration_,
        bytes calldata signature_
    ) external view returns (bool);

    // --- State-Changing Functions ---

    /**
     * @notice Verifies if an address is verified
     * @dev Reverts if the signature is invalid or expired.
     * If signature is valid, the account's nonce is incremented.
     * @param account_ The address to verify for
     * @param signatureExpiration_ The expiration timestamp of the signature
     * @param signature_ The signer signature attesting to verification
     */
    function verify(
        address account_,
        uint48 signatureExpiration_,
        bytes calldata signature_
    ) external;

    /**
     * @notice Updates the signer address
     * @param signer_ The address of the new signer
     */
    function updateSigner(address signer_) external;
}
