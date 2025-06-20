// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

interface IVotesERC20V1 {
    // --- Errors ---

    error IsLocked();
    error ExceedMaxTotalSupply();
    error InvalidMaxTotalSupply();

    // --- Events ---

    event Locked(bool isLocked);
    event MaxTotalSupplyUpdated(uint256 newMaxTotalSupply);

    // --- Structs ---

    struct Metadata {
        string name;
        string symbol;
    }

    struct Allocation {
        address to;
        uint256 amount;
    }

    // --- Initializer Functions ---

    function initialize(
        Metadata calldata metadata_,
        Allocation[] calldata allocations_,
        address owner_,
        bool locked_,
        uint256 maxTotalSupply_
    ) external;

    // --- Pure Functions ---

    function CLOCK_MODE() external pure returns (string memory clockMode);

    // --- View Functions ---

    function clock() external view returns (uint48 clock);

    function locked() external view returns (bool isLocked);

    function maxTotalSupply() external view returns (uint256 maxTotalSupply);

    function getUnlockTime() external view returns (uint48 unlockTime);

    // --- State-Changing Functions ---

    function lock(bool locked_) external;

    function setMaxTotalSupply(uint256 newMaxTotalSupply_) external;

    function mint(address to_, uint256 amount_) external;

    function burn(uint256 amount_) external;
}
