// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

contract MockHatsAccount {
    // see https://github.com/Hats-Protocol/hats-account/blob/00650b3de756352d303ca08e4b024376f1d1db98/src/HatsAccountBase.sol#L41
    // for my inspiration

    function tokenId() public view returns (uint256) {
        bytes memory footer = new bytes(0x20);
        assembly {
            // copy 0x20 bytes from final word of footer
            extcodecopy(address(), add(footer, 0x20), 0x8d, 0x20)
        }
        return abi.decode(footer, (uint256));
    }

    function tokenImplementation() public view returns (address) {
        bytes memory footer = new bytes(0x20);
        assembly {
            // copy 0x20 bytes from third word of footer
            extcodecopy(address(), add(footer, 0x20), 0x6d, 0x20)
        }
        return abi.decode(footer, (address));
    }

    function execute(
        address to,
        uint256 value,
        bytes calldata data,
        uint8
    ) external returns (bytes memory) {
        (bool success, bytes memory result) = to.call{value: value}(data);
        require(success, "HatsAccount: execution failed");
        return result;
    }
}
