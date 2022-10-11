//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./interfaces/ITokenFactory.sol";
import "./VotesToken.sol";
import "@openzeppelin/contracts/utils/Create2.sol";

/// @notice Token Factory used to deploy votes tokens
contract TokenFactory is ITokenFactory {
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

        createdContracts[0] = _createToken(
            creator,
            abi.decode(data[4], (bytes32)),
            abi.decode(data[0], (string)),
            abi.decode(data[1], (string)),
            abi.decode(data[2], (address[])),
            abi.decode(data[3], (uint256[]))
        );

        return createdContracts;
    }

    function _createToken(
        address creator,
        bytes32 salt,
        string memory name,
        string memory symbol,
        address[] memory _hodlers,
        uint256[] memory _allocations
    ) internal returns (address createdToken) {
        createdToken = Create2.deploy(
            0,
            keccak256(
                abi.encodePacked(creator, msg.sender, block.chainid, salt)
            ),
            abi.encodePacked(
                type(VotesToken).creationCode,
                abi.encode(name, symbol, _hodlers, _allocations)
            )
        );
        emit TokenCreated(createdToken);
        return createdToken;
    }
}
