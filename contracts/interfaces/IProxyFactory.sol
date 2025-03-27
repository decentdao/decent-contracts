// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

interface IProxyFactory {
    // Events
    event ProxyDeployed(address indexed proxy, address indexed implementation);

    /**
     * @dev Deploys a proxy for any implementation with arbitrary initialization data
     * @param implementation The implementation contract address
     * @param initData The initialization data to be passed to the proxy
     * @param salt A unique value to ensure deterministic address generation
     * @return proxy The address of the deployed proxy
     */
    function deployProxy(
        address implementation,
        bytes memory initData,
        bytes32 salt
    ) external returns (address proxy);

    /**
     * @dev Predicts the address where a proxy will be deployed
     * @param implementation The implementation contract address
     * @param initData The initialization data to be passed to the proxy
     * @param salt A unique value to ensure deterministic address generation
     * @param deployer The address that will deploy the proxy
     * @return The predicted address
     */
    function predictProxyAddress(
        address implementation,
        bytes memory initData,
        bytes32 salt,
        address deployer
    ) external view returns (address);
}
