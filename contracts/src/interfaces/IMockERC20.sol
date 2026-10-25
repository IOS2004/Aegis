// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IMockERC20
 * @notice Standard ERC-20 test interface extending IERC20 with mint and burn.
 */
interface IMockERC20 is IERC20 {
    function decimals() external view returns (uint8);
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
}
