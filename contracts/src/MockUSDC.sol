// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/IMockERC20.sol";

/**
 * @title MockUSDC
 * @notice Test ERC-20 token for Aegis demonstration and testing.
 * @dev Holds no real monetary value. Faucets and minting are open for test environments.
 */
contract MockUSDC is ERC20, IMockERC20 {
    uint8 private constant _DECIMALS = 6;

    constructor() ERC20("Mock USD Coin", "mUSDC") {
        _mint(msg.sender, 1_000_000 * 10 ** _DECIMALS);
    }

    function decimals() public pure override(ERC20, IMockERC20) returns (uint8) {
        return _DECIMALS;
    }

    function mint(address to, uint256 amount) external override {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external override {
        _burn(from, amount);
    }
}
