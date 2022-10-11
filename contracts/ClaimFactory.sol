//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./interfaces/IClaimFactory.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/utils/Create2.sol";

/// @notice Token Factory used to deploy votes tokens
contract ClaimFactory is IClaimFactory {
    /// @dev Creates an ERC-20 votes token
    /// @param creator The address creating the module
    /// @param data The array of bytes used to create the token
    /// @return address The address of the created token
    function create(address creator, bytes[] calldata data)
        external
        override
        returns (address[] memory)
    {
        address[] memory createdContracts = new address[](1);

        createdContracts[0] = _createClaimSubsidiary(
            abi.decode(data[0], (address)),
            creator,
            abi.decode(data[1], (bytes32))
        );

        return createdContracts;
    }

    function _createClaimSubsidiary(
        address subImpl,
        address creator,
        bytes32 salt
    ) internal returns (address createdSubsidiary) {
        createdSubsidiary = Create2.deploy(
            0,
            keccak256(
                abi.encodePacked(creator, msg.sender, block.chainid, salt)
            ),
            abi.encodePacked(
                type(ERC1967Proxy).creationCode,
                abi.encode(subImpl, "")
            )
        );
        emit SubsidiaryCreated(createdSubsidiary);
    }
}
