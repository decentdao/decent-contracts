//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;
import "./interfaces/ICallbackGnosis.sol";

/// @notice Operated via the GnosisFactory's createProxyWithCallback method
/// @notice Purpose - Setup Gnosis Safe w/ any arb method calls
contract CallbackGnosis is ICallbackGnosis {
    /// @dev Method called once a proxy contract is created
    /// @param proxy GnosisSafe address
    /// @param initializer Payload used to setup GnosisSafe Configuration 
    function proxyCreated(
        GnosisSafeProxy proxy,
        address,
        bytes calldata initializer,
        uint256
    ) external {
        (bytes memory txData, bytes memory signature) = abi.decode(
            initializer,
            (bytes, bytes)
        );

        (
            address[][] memory targets,
            bytes[][] memory txs,
            bool[] memory gnosisExecTxs
        ) = abi.decode(txData, (address[][], bytes[][], bool[]));

        for (uint256 i; i < targets.length; i++) {
            if (gnosisExecTxs[i]) {
                gnosisExecTx(targets[i], txs[i], address(proxy), signature);
            } else {
                multiTx(targets[i], txs[i], address(proxy));
            }
        }
    }

    /// @notice Allows Gnosis Safe txs without knowledge of the Gnosis address
    /// @dev Utilized to bypass the txGuard / Sig Requirement 
    /// @param _targets Contract Address / Address(0) == proxy
    /// @param _txs Target payload
    /// @param _proxy GnosisSafe Address
    function multiTx(
        address[] memory _targets,
        bytes[] memory _txs,
        address _proxy
    ) public {
        for (uint256 i; i < _targets.length; i++) {
            (bool success, ) = address(_targets[i] == address(0) ? _proxy : _targets[i]).call(_txs[i]);
            require(success, "CB001");
        }
    }

    /// @notice Executes a tx within the context of the Gnosis Safe
    /// @dev msg.sender == GnosisSafe Address
    /// @param _targets Contract Address / Address(0) == proxy
    /// @param _txs Target payload
    /// @param _proxy GnosisSafe Address
    /// @param _signature Signatures req. to execTransaction => Gnosis Safe
    function gnosisExecTx(address[] memory _targets, bytes[] memory _txs, address _proxy, bytes memory _signature) internal {
        (bool success, ) = address(_proxy).call(
                abi.encodeWithSignature(
                    "execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)",
                    address(this), // multisend address
                    0,
                    abi.encodeWithSignature(
                        "multiTx(address[],bytes[],address)",
                        _targets,
                        _txs,
                        _proxy
                    ), // data
                    1,
                    0,
                    0,
                    0,
                    address(0),
                    payable(0),
                    _signature
                )
            );
            require(success, "CB000");
    }
}
