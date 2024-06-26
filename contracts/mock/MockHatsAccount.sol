// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

contract MockHatsAccount {
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
}
