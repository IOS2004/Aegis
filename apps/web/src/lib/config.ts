// SPDX-License-Identifier: MIT
import type { Address, Hex } from "viem";

export const GATEWAY_API_URL = "/api";
export const RPC_URL = "http://127.0.0.1:8545";
export const CHAIN_ID = 31337;

export const CONTRACT_ADDRESSES = {
  policyManager: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address,
  vault: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as Address,
  mockUsdc: "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address,
};

export const DEMO_ACCOUNTS = {
  owner: {
    name: "Owner / Delegator",
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
    privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex,
    role: "Root Granter",
  },
  agentA: {
    name: "Agent A (Senior Orchestrator)",
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
    privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex,
    role: "Parent Delegate",
  },
  agentB: {
    name: "Agent B (Sub-Agent Worker)",
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address,
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex,
    role: "Child Delegate",
  },
  attacker: {
    name: "Attacker (Adversary)",
    address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address,
    privateKey: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex,
    role: "Unauthorized Key",
  },
};

export const TOOL_NAMES_MAP: Record<number, string> = {
  1: "read_project_status",
  2: "run_test_suite",
  4: "create_sandbox_branch",
  8: "write_demo_file",
  16: "vault_transfer",
};

export function decodeTools(allowedTools: bigint): string[] {
  const tools: string[] = [];
  if ((allowedTools & 1n) !== 0n) tools.push("read_project_status");
  if ((allowedTools & 2n) !== 0n) tools.push("run_test_suite");
  if ((allowedTools & 4n) !== 0n) tools.push("create_sandbox_branch");
  if ((allowedTools & 8n) !== 0n) tools.push("write_demo_file");
  if ((allowedTools & 16n) !== 0n) tools.push("vault_transfer");
  return tools;
}
