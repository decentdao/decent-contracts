//SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "@gnosis.pm/safe-contracts/contracts/proxies/IProxyCreationCallback.sol";

interface ICallbackGnosis is IProxyCreationCallback {
    /// @notice Allows Gnosis Safe txs without knowledge of the Gnosis address
    /// @dev Utilized to bypass the txGuard / Sig Requirement
    /// @param _targets Contract Address / Address(0) == proxy
    /// @param _txs Target payload
    /// @param _proxy GnosisSafe Address
    function multiTx(
        address[] memory _targets,
        bytes[] memory _txs,
        address _proxy
    ) external;
}
