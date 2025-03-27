// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.28;

import {IProxyFactory} from "./interfaces/IProxyFactory.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title ProxyFactory
 * @dev Simplified factory contract for deploying ERC1967 proxies with deterministic addresses
 * This factory allows anyone to deploy proxies for any implementation contract
 * using CREATE2 for deterministic addresses
 */
contract ProxyFactory is IProxyFactory {
    function deployProxy(
        address implementation,
        bytes memory initData,
        bytes32 salt
    ) public returns (address proxy) {
        // Validate the implementation address
        require(
            implementation != address(0),
            "Implementation cannot be zero address"
        );
        require(
            implementation.code.length > 0,
            "Implementation must be a contract"
        );

        // Create a unique salt based on the sender and provided salt
        // This prevents salt collisions between different callers
        bytes32 uniqueSalt = keccak256(abi.encodePacked(msg.sender, salt));

        // Deploy the proxy using CREATE2
        proxy = address(
            new ERC1967Proxy{salt: uniqueSalt}(implementation, initData)
        );

        emit ProxyDeployed(proxy, implementation);
        return proxy;
    }

    function predictProxyAddress(
        address implementation,
        bytes memory initData,
        bytes32 salt,
        address deployer
    ) public view returns (address) {
        // Validate the implementation address
        require(
            implementation != address(0),
            "Implementation cannot be zero address"
        );
        require(
            implementation.code.length > 0,
            "Implementation must be a contract"
        );

        // Create a unique salt based on the deployer and provided salt
        bytes32 uniqueSalt = keccak256(abi.encodePacked(deployer, salt));

        // Calculate the proxy bytecode (implementation address + init data)
        bytes memory proxyConstructorData = abi.encode(
            implementation,
            initData
        );
        bytes memory bytecode = abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            proxyConstructorData
        );

        // Calculate the CREATE2 address
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                uniqueSalt,
                keccak256(bytecode)
            )
        );

        return address(uint160(uint256(hash)));
    }
}
