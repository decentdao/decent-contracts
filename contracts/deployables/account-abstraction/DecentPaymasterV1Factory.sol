// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/utils/Create2.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "./DecentPaymasterV1.sol";

contract DecentPaymasterV1Factory {
    DecentPaymasterV1 public immutable paymasterImplementation;
    IEntryPoint public immutable entryPoint;

    constructor(IEntryPoint _entryPoint) {
        paymasterImplementation = new DecentPaymasterV1();
        entryPoint = _entryPoint;
    }

    /**
     * create an account, and return its address.
     * returns the address even if the account is already deployed.
     * Note that during UserOperation execution, this method is called only if the account is not deployed.
     * This method returns an existing account address so that entryPoint.getSenderAddress() would work even after account creation
     */
    function createPaymaster(
        address owner,
        uint256 salt
    ) public returns (DecentPaymasterV1 ret) {
        address addr = getAddress(owner, salt);
        uint256 codeSize = addr.code.length;
        if (codeSize > 0) {
            return DecentPaymasterV1(payable(addr));
        }
        ret = DecentPaymasterV1(
            payable(
                new ERC1967Proxy{salt: bytes32(salt)}(
                    address(paymasterImplementation),
                    abi.encodeCall(
                        DecentPaymasterV1.initialize,
                        (owner, address(entryPoint))
                    )
                )
            )
        );
    }

    /**
     * calculate the counterfactual address of this paymaster as it would be returned by createPaymaster()
     */
    function getAddress(
        address owner,
        uint256 salt
    ) public view returns (address) {
        return
            Create2.computeAddress(
                bytes32(salt),
                keccak256(
                    abi.encodePacked(
                        type(ERC1967Proxy).creationCode,
                        abi.encode(
                            address(paymasterImplementation),
                            abi.encodeCall(
                                DecentPaymasterV1.initialize,
                                (owner, address(entryPoint))
                            )
                        )
                    )
                )
            );
    }
}
