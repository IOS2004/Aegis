// SPDX-License-Identifier: MIT
import path from "node:path";
import { buildGatewayServer } from "./server.js";
import { AuditDatabase } from "./services/auditDb.js";
import { PolicyClient } from "./services/policyClient.js";
import { SandboxEnvironment } from "./tools/sandbox.js";

const PORT = Number(process.env.PORT || 3000);
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
const POLICY_MANAGER_ADDRESS = (process.env.POLICY_MANAGER_ADDRESS || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512") as `0x${string}`;
const VAULT_ADDRESS = (process.env.VAULT_ADDRESS || "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0") as `0x${string}`;
const RELAYER_KEY = (process.env.RELAYER_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as `0x${string}`;

const auditDb = new AuditDatabase(process.env.SQLITE_PATH || path.join(process.cwd(), "scratch", "aegis_audit.db"));
const sandbox = new SandboxEnvironment(process.env.SANDBOX_ROOT);

const policyClient = new PolicyClient({
  rpcUrl: RPC_URL,
  chainId: CHAIN_ID,
  policyManagerAddress: POLICY_MANAGER_ADDRESS,
  vaultAddress: VAULT_ADDRESS,
  relayerPrivateKey: RELAYER_KEY,
});

const server = buildGatewayServer({ policyClient, auditDb, sandbox });

server.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`[Aegis Gateway] Listening on ${address}`);
});
