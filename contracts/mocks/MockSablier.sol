// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

contract MockSablier {
    mapping(uint256 => uint256) private streamBalances;
    mapping(uint256 => uint256) private withdrawnAmounts;

    function setStreamBalance(uint256 streamId, uint256 balance) external {
        streamBalances[streamId] = balance;
    }

    function balanceOf(
        uint256 streamId,
        address
    ) external view returns (uint256) {
        return streamBalances[streamId];
    }

    function withdrawFromStream(
        uint256 streamId,
        uint256 amount
    ) external returns (bool) {
        require(streamBalances[streamId] >= amount, "Insufficient balance");
        streamBalances[streamId] -= amount;
        withdrawnAmounts[streamId] += amount;
        return true;
    }

    function getWithdrawnAmount(
        uint256 streamId
    ) external view returns (uint256) {
        return withdrawnAmounts[streamId];
    }
}
