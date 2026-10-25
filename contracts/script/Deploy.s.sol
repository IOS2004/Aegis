// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/MockUSDC.sol";
import "../src/AegisPolicyManager.sol";
import "../src/AgentVault.sol";

contract DeployAegis is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80) // Anvil #0 default
        );

        vm.startBroadcast(deployerPrivateKey);

        MockUSDC token = new MockUSDC();
        AegisPolicyManager policyManager = new AegisPolicyManager();
        AgentVault vault = new AgentVault(address(policyManager), address(token));

        policyManager.setVault(address(vault));

        // Seed vault with initial test liquidity
        token.approve(address(vault), 10_000 * 10 ** 6);
        vault.deposit(10_000 * 10 ** 6);

        vm.stopBroadcast();

        console.log("MockUSDC deployed to:", address(token));
        console.log("AegisPolicyManager deployed to:", address(policyManager));
        console.log("AgentVault deployed to:", address(vault));
    }
}
