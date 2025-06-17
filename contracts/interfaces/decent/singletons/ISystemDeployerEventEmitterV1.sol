// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

interface ISystemDeployerEventEmitterV1 {
    // --- Events ---

    event SystemDeployed(
        address indexed safeProxy,
        address indexed safeProxyFactory,
        bytes32 salt,
        bytes initData
    );

    // --- State-Changing Functions ---

    function emitSystemDeployed(
        address safeProxyFactory_,
        bytes32 salt_,
        bytes calldata initData_
    ) external;
}
