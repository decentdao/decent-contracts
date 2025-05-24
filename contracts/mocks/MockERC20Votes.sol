// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {ClockMode} from "../interfaces/decent/ClockMode.sol";

/**
 * @title MockERC20Votes
 * @dev Mock ERC20 token with IVotes implementation for testing voting functionality
 * Enhanced with proper historical snapshot support
 */
contract MockERC20Votes is ERC20, ERC20Permit, IVotes {
    mapping(address => mapping(uint256 => uint256)) private _mockPastVotes;
    mapping(address => mapping(uint256 => bool))
        private _hasMockPastVoteBeenSet;
    mapping(uint256 => uint256) private _mockPastTotalSupply;
    mapping(uint256 => bool) private _hasMockPastTotalSupplyBeenSet;
    mapping(address => address) private _delegates;
    string public clockMode;

    constructor()
        ERC20("Mock Voting Token", "MVT")
        ERC20Permit("Mock Voting Token")
    {
        clockMode = "mode=timestamp";
    }

    function clock() public view returns (uint256) {
        return block.timestamp;
    }

    function setClockMode(ClockMode _clockMode) public {
        clockMode = _clockMode == ClockMode.Timestamp
            ? "mode=timestamp"
            : "mode=blocknumber&from=default";
    }

    function CLOCK_MODE() public view returns (string memory) {
        return clockMode;
    }

    /**
     * @dev Mints tokens to the specified address
     * @param to The address to mint tokens to
     * @param amount The amount of tokens to mint
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @dev Burns tokens from the specified address
     * @param from The address to burn tokens from
     * @param amount The amount of tokens to burn
     */
    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    /**
     * @dev Sets a specific past voting weight for an account at a specific timepoint
     * @param account The account to set past votes for
     * @param timepoint The timepoint to set votes at
     * @param votes The amount of votes to set
     */
    function setPastVotes(
        address account,
        uint256 timepoint,
        uint256 votes
    ) external {
        _mockPastVotes[account][timepoint] = votes;
        _hasMockPastVoteBeenSet[account][timepoint] = true;
    }

    /**
     * @dev Sets a specific past total supply for a specific timepoint
     * @param timepoint The timepoint to set total supply at
     * @param totalSupply The total supply to set
     */
    function setPastTotalSupply(
        uint256 timepoint,
        uint256 totalSupply
    ) external {
        _mockPastTotalSupply[timepoint] = totalSupply;
        _hasMockPastTotalSupplyBeenSet[timepoint] = true;
    }

    /**
     * @dev Implementation of the delegation function from IVotes
     */
    function delegate(address delegatee) public override {
        _delegates[msg.sender] = delegatee;
    }

    /**
     * @dev Implementation of the delegation function from IVotes
     */
    function delegateBySig(
        address delegatee,
        uint256,
        uint256,
        uint8,
        bytes32,
        bytes32
    ) public override {
        // Not implemented for mock
        _delegates[msg.sender] = delegatee;
    }

    /**
     * @dev Returns the current delegated address
     */
    function delegates(address account) public view override returns (address) {
        return _delegates[account];
    }

    /**
     * @dev Returns the current voting power
     */
    function getVotes(address account) public view override returns (uint256) {
        return balanceOf(account);
    }

    /**
     * @dev Overrides getPastVotes to return our mock values
     * Enhanced to properly handle historical snapshots
     */
    function getPastVotes(
        address account,
        uint256 timepoint
    ) public view override returns (uint256) {
        if (_hasMockPastVoteBeenSet[account][timepoint]) {
            return _mockPastVotes[account][timepoint];
        }
        // If no explicit value is set for this timepoint, return the current balance
        // In a real implementation, this would use a checkpoint system
        return balanceOf(account);
    }

    /**
     * @dev Enhanced implementation that properly handles historical snapshots
     */
    function getPastTotalSupply(
        uint256 timepoint
    ) public view override returns (uint256) {
        if (_hasMockPastTotalSupplyBeenSet[timepoint]) {
            return _mockPastTotalSupply[timepoint];
        }
        // If no explicit value is set for this timepoint, return the current total supply
        // In a real implementation, this would use a checkpoint system
        return totalSupply();
    }
}
