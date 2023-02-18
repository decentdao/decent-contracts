//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";

interface IGnosisSafe {
    function nonce() external view returns (uint256);

    /// @dev Setup function sets initial storage of contract.
    /// @param _owners List of Safe owners.
    /// @param _threshold Number of required confirmations for a Safe transaction.
    /// @param _to Contract address for optional delegate call.
    /// @param _data Data payload for optional delegate call.
    /// @param _fallbackHandler Handler for fallback calls to this contract
    /// @param _paymentToken Token that should be used for the payment (0 is ETH)
    /// @param _payment Value that should be paid
    /// @param _paymentReceiver Address that should receive the payment (or 0 if tx.origin)
    function setup(
        address[] calldata _owners,
        uint256 _threshold,
        address _to,
        bytes calldata _data,
        address _fallbackHandler,
        address _paymentToken,
        uint256 _payment,
        address payable _paymentReceiver
    ) external;

    function setGuard(address _guard) external;

    function execTransaction(
        address _to,
        uint256 _value,
        bytes calldata _data,
        Enum.Operation _operation,
        uint256 _safeTxGas,
        uint256 _baseGas,
        uint256 _gasPrice,
        address _gasToken,
        address payable _refundReceiver,
        bytes memory _signatures
    ) external payable returns (bool success);

    /**
     * @dev Checks whether the signature provided is valid for the provided data, hash. Will revert otherwise.
     * @param dataHash Hash of the data (could be either a message hash or transaction hash)
     * @param data That should be signed (this is passed to an external validator contract)
     * @param signatures Signature data that should be verified. Can be ECDSA signature, contract signature (EIP-1271) or approved hash.
     */
    function checkSignatures(
        bytes32 _dataHash,
        bytes memory _data,
        bytes memory _signatures
    ) external view;

    /// @dev Returns the bytes that are hashed to be signed by owners.
    /// @param _to Destination address.
    /// @param _value Ether value.
    /// @param _data Data payload.
    /// @param _operation Operation type.
    /// @param _safeTxGas Gas that should be used for the safe transaction.
    /// @param _baseGas Gas costs for that are independent of the transaction execution(e.g. base transaction fee, signature check, payment of the refund)
    /// @param _gasPrice Maximum gas price that should be used for this transaction.
    /// @param _gasToken Token address (or 0 if ETH) that is used for the payment.
    /// @param _refundReceiver Address of receiver of gas payment (or 0 if tx.origin).
    /// @param _nonce Transaction nonce.
    /// @return Transaction hash bytes.
    function encodeTransactionData(
        address _to,
        uint256 _value,
        bytes calldata _data,
        Enum.Operation _operation,
        uint256 _safeTxGas,
        uint256 _baseGas,
        uint256 _gasPrice,
        address _gasToken,
        address _refundReceiver,
        uint256 _nonce
    ) external view returns (bytes memory);

    /// @notice Returns whether the passed address is an owner
    /// @param _owner The address the check
    /// @return bool True if the address is an owner
    function isOwner(address _owner) external view returns (bool);
}
