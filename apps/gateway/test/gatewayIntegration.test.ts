// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { FastifyInstance } from "fastify";
import { buildGatewayServer } from "../src/server.js";
import { AuditDatabase } from "../src/services/auditDb.js";
import { PolicyClient, AEGIS_POLICY_MANAGER_ABI } from "../src/services/policyClient.js";
import { SandboxEnvironment } from "../src/tools/sandbox.js";
import { MockAgent } from "../src/agent/mockAgent.js";

const RPC_URL = "http://127.0.0.1:8545";
const CHAIN_ID = 31337;
const POLICY_MANAGER_ADDR = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const VAULT_ADDR = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as Address;

// Anvil default accounts
const OWNER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const AGENT_A_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const AGENT_B_PK = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;
const ATTACKER_PK = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex;

describe("Aegis Gateway End-to-End Integration & Security Matrix", () => {
  let app: FastifyInstance;
  let auditDb: AuditDatabase;
  let sandbox: SandboxEnvironment;
  let policyClient: PolicyClient;
  let tempDir: string;

  let agentA: MockAgent;
  let agentB: MockAgent;
  let attacker: MockAgent;

  let rootGrantId: Hex;
  let childGrantId: Hex;

  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const ownerWallet = createWalletClient({
    account: privateKeyToAccount(OWNER_PK),
    transport: http(RPC_URL),
  });
  const agentAWallet = createWalletClient({
    account: privateKeyToAccount(AGENT_A_PK),
    transport: http(RPC_URL),
  });

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-e2e-gateway-"));
    sandbox = new SandboxEnvironment(tempDir);
    auditDb = new AuditDatabase(":memory:");

    policyClient = new PolicyClient({
      rpcUrl: RPC_URL,
      chainId: CHAIN_ID,
      policyManagerAddress: POLICY_MANAGER_ADDR,
      vaultAddress: VAULT_ADDR,
      relayerPrivateKey: OWNER_PK,
    });

    app = buildGatewayServer({ policyClient, auditDb, sandbox });
    await app.ready();

    agentA = new MockAgent({
      privateKey: AGENT_A_PK,
      chainId: CHAIN_ID,
      policyManagerAddress: POLICY_MANAGER_ADDR,
    });

    agentB = new MockAgent({
      privateKey: AGENT_B_PK,
      chainId: CHAIN_ID,
      policyManagerAddress: POLICY_MANAGER_ADDR,
    });

    attacker = new MockAgent({
      privateKey: ATTACKER_PK,
      chainId: CHAIN_ID,
      policyManagerAddress: POLICY_MANAGER_ADDR,
    });

    // 1. Create Root Grant G0 on-chain: Agent A, all tools (0x1F), cap 100, budget 1000
    const now = BigInt(Math.floor(Date.now() / 1000));
    const expiryRoot = now + 86400n * 30n;

    const createRootTx = await ownerWallet.writeContract({
      address: POLICY_MANAGER_ADDR,
      abi: parseAbi([
        "function createRootGrant(address,uint256,uint64,uint256,uint256) returns (bytes32)",
      ]),
      functionName: "createRootGrant",
      args: [agentA.address, 0x1Fn, expiryRoot, 100n, 1000n],
      account: ownerWallet.account!,
      chain: undefined,
    });
    const receipt0 = await publicClient.waitForTransactionReceipt({ hash: createRootTx });
    // RootGrantCreated event topic 1 is grantId
    rootGrantId = receipt0.logs[0].topics[1] as Hex;

    // 2. Delegate to Agent B (G1): tools 0x0F (read, test, branch, write; NO vault transfer 0x10), cap 50, budget 300
    const expiryChild = now + 86400n * 7n;
    const delegateTx = await agentAWallet.writeContract({
      address: POLICY_MANAGER_ADDR,
      abi: parseAbi([
        "function delegateGrant(bytes32,address,uint256,uint64,uint256,uint256) returns (bytes32)",
      ]),
      functionName: "delegateGrant",
      args: [rootGrantId, agentB.address, 0x0Fn, expiryChild, 50n, 300n],
      account: agentAWallet.account!,
      chain: undefined,
    });
    const receipt1 = await publicClient.waitForTransactionReceipt({ hash: delegateTx });
    childGrantId = receipt1.logs[0].topics[2] as Hex;
  });

  afterAll(async () => {
    await app.close();
    auditDb.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ================================================================
  // 1. Valid Execution Flows
  // ================================================================

  it("1. should allow authorized read_project_status and commit receipt on-chain", async () => {
    const sub = await agentB.createValidReadStatus(childGrantId, 0);

    const res = await app.inject({
      method: "POST",
      url: "/action",
      payload: sub,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.toolName).toBe("read_project_status");
    expect(body.output).toContain("healthy");
    expect(body.resultHash).toMatch(/^0x[0-9a-fA-F]{64}$/);

    // Verify SQLite audit log
    const record = auditDb.getAction(body.actionId);
    expect(record).not.toBeNull();
    expect(record?.status).toBe("EXECUTED");
  });

  it("2. should allow authorized write_demo_file, spend budget, and commit receipt", async () => {
    const sub = await agentB.createValidWriteFile(
      childGrantId,
      1,
      "audit-log.txt",
      "System verification in progress"
    );

    const res = await app.inject({
      method: "POST",
      url: "/action",
      payload: sub,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.output).toContain("Successfully wrote");

    // Verify file exists on host within demo directory
    const filePath = path.join(tempDir, "demo", "audit-log.txt");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toBe("System verification in progress");

    // Verify on-chain budget was consumed
    const grantState = await policyClient.getGrant(childGrantId);
    expect(grantState.spent).toBe(5n); // 0 from read + 5 from write
    expect(grantState.nonce).toBe(2n);
  });

  it("3. should allow authorized run_test_suite within sandbox", async () => {
    const sub = await agentB.createValidRunTests(childGrantId, 2, 10);

    const res = await app.inject({
      method: "POST",
      url: "/action",
      payload: sub,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.output).toContain("PASS");

    const grantState = await policyClient.getGrant(childGrantId);
    expect(grantState.spent).toBe(15n);
    expect(grantState.nonce).toBe(3n);
  });

  it("4. should allow authorized create_sandbox_branch in git repository", async () => {
    const sub = await agentB.createValidCreateBranch(childGrantId, 3, "fix-aegis-core");

    const res = await app.inject({
      method: "POST",
      url: "/action",
      payload: sub,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.output).toContain("fix-aegis-core");

    const grantState = await policyClient.getGrant(childGrantId);
    expect(grantState.spent).toBe(20n);
    expect(grantState.nonce).toBe(4n);
  });

  // ================================================================
  // 2. Adversarial & Hostile Request Rejections
  // ================================================================

  it("5. should REJECT replayed action request (nonce already consumed)", async () => {
    // Attempt to replay sub with nonce 1 (already consumed in test 2)
    const staleSub = await agentB.createValidWriteFile(
      childGrantId,
      1,
      "replayed.txt",
      "Replayed content"
    );

    const res = await app.inject({
      method: "POST",
      url: "/action",
      payload: staleSub,
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe("ERR_ONCHAIN_POLICY_REJECTION");

    // Verify audit log status is DENIED
    const allActions = auditDb.getAllActions();
    const denied = allActions.find((a) => a.status === "DENIED");
    expect(denied).toBeDefined();
  });

  it("6. should REJECT unauthorized tool request (vault_transfer not in child bitmask)", async () => {
    const sub = await agentB.createUnauthorizedToolAttempt(childGrantId, 4);

    const res = await app.inject({
      method: "POST",
      url: "/action",
      payload: sub,
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe("ERR_ONCHAIN_POLICY_REJECTION");
    expect(body.details).toContain("ToolNotPermitted");
  });

  it("7. should REJECT per-action cap violation (requesting cost 60 > cap 50)", async () => {
    const sub = await agentB.createOverCapAttempt(childGrantId, 4, 60);

    const res = await app.inject({
      method: "POST",
      url: "/action",
      payload: sub,
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe("ERR_ONCHAIN_POLICY_REJECTION");
    expect(body.details).toContain("PerActionLimitExceeded");
  });

  it("8. should REJECT budget exhaustion attack (cost exceeding available capacity)", async () => {
    // Create a constrained grant with total budget 30 and maxPerAction 30
    const now = BigInt(Math.floor(Date.now() / 1000));
    const expirySmall = now + 86400n;
    const delegateTx = await agentAWallet.writeContract({
      address: POLICY_MANAGER_ADDR,
      abi: parseAbi([
        "function delegateGrant(bytes32,address,uint256,uint64,uint256,uint256) returns (bytes32)",
      ]),
      functionName: "delegateGrant",
      args: [rootGrantId, agentB.address, 0x0Fn, expirySmall, 30n, 30n],
      account: agentAWallet.account!,
      chain: undefined,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: delegateTx });
    const smallGrantId = receipt.logs[0].topics[2] as Hex;

    // Action 1: spend 20 of 30 -> succeeds (budget remaining = 10)
    const sub1 = await agentB.signAction({
      grantId: smallGrantId,
      toolName: "run_test_suite",
      cost: 20,
      paramsObj: { target: "unit" },
      nonce: 0,
    });
    const res1 = await app.inject({
      method: "POST",
      url: "/action",
      payload: sub1,
    });
    expect(res1.statusCode).toBe(200);

    // Action 2: attempt to spend 20 more (only 10 remaining) -> SubtreeBudgetExceeded
    const sub2 = await agentB.signAction({
      grantId: smallGrantId,
      toolName: "run_test_suite",
      cost: 20,
      paramsObj: { target: "unit" },
      nonce: 1,
    });
    const res2 = await app.inject({
      method: "POST",
      url: "/action",
      payload: sub2,
    });
    expect(res2.statusCode).toBe(403);
    const body2 = res2.json();
    expect(body2.error).toBe("ERR_ONCHAIN_POLICY_REJECTION");
    expect(body2.details).toContain("SubtreeBudgetExceeded");
  });

  it("9. should REJECT expired signature (deadline in the past)", async () => {
    const sub = await agentB.createExpiredSignatureAttempt(childGrantId, 4);

    const res = await app.inject({
      method: "POST",
      url: "/action",
      payload: sub,
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe("ERR_ONCHAIN_POLICY_REJECTION");
    expect(body.details).toContain("SignatureExpired");
  });

  it("10. should REJECT signature forged by wrong agent key", async () => {
    // Attacker signs request targeting Agent B's grant
    const sub = await attacker.createValidReadStatus(childGrantId, 4);

    const res = await app.inject({
      method: "POST",
      url: "/action",
      payload: sub,
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe("ERR_INVALID_SIGNATURE");
  });

  it("11. should REJECT path traversal attack at gateway validation layer", async () => {
    const sub = await agentB.createPathTraversalAttack(childGrantId, 4);

    const res = await app.inject({
      method: "POST",
      url: "/action",
      payload: sub,
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("ERR_INVALID_TOOL_PARAMETERS");

    // Confirm no file was written outside
    const outsidePath = path.resolve(tempDir, "..", "escaped.txt");
    expect(fs.existsSync(outsidePath)).toBe(false);
  });

  it("12. should REJECT shell injection attack at gateway validation layer", async () => {
    const sub = await agentB.createShellInjectionAttack(childGrantId, 4);

    const res = await app.inject({
      method: "POST",
      url: "/action",
      payload: sub,
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("ERR_INVALID_TOOL_PARAMETERS");
  });

  // ================================================================
  // 3. Revocation & Crash Behavior
  // ================================================================

  it("13. should immediately block actions once grant is revoked", async () => {
    // Agent A revokes Child Grant B
    const revokeTx = await agentAWallet.writeContract({
      address: POLICY_MANAGER_ADDR,
      abi: parseAbi(["function revokeGrant(bytes32)"]),
      functionName: "revokeGrant",
      args: [childGrantId],
      account: agentAWallet.account!,
      chain: undefined,
    });
    await publicClient.waitForTransactionReceipt({ hash: revokeTx });

    // Agent B attempts to execute an action
    const sub = await agentB.createValidReadStatus(childGrantId, 4);
    const res = await app.inject({
      method: "POST",
      url: "/action",
      payload: sub,
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe("ERR_ONCHAIN_POLICY_REJECTION");
    expect(body.details).toContain("GrantRevokedError");
  });

  it("14. should block descendant actions if ancestor is revoked", async () => {
    // Create new Child C under Root G0
    const now = BigInt(Math.floor(Date.now() / 1000));
    const expiry = now + 86400n;
    const delegateTx = await agentAWallet.writeContract({
      address: POLICY_MANAGER_ADDR,
      abi: parseAbi([
        "function delegateGrant(bytes32,address,uint256,uint64,uint256,uint256) returns (bytes32)",
      ]),
      functionName: "delegateGrant",
      args: [rootGrantId, attacker.address, 0x0Fn, expiry, 50n, 100n],
      account: agentAWallet.account!,
      chain: undefined,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: delegateTx });
    const grantCId = receipt.logs[0].topics[2] as Hex;

    // Owner revokes Root G0
    const revokeRootTx = await ownerWallet.writeContract({
      address: POLICY_MANAGER_ADDR,
      abi: parseAbi(["function revokeGrant(bytes32)"]),
      functionName: "revokeGrant",
      args: [rootGrantId],
      account: ownerWallet.account!,
      chain: undefined,
    });
    await publicClient.waitForTransactionReceipt({ hash: revokeRootTx });

    // Child C attempts action -> must fail on ancestry check
    const sub = await attacker.createValidReadStatus(grantCId, 0);
    const res = await app.inject({
      method: "POST",
      url: "/action",
      payload: sub,
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.details).toContain("AncestorRevoked");
  });

  it("15. should handle execution failure conservatively without refund and reconcile on retry", async () => {
    // Create a fresh grant for crash & retry reconciliation
    const now = BigInt(Math.floor(Date.now() / 1000));
    const expiryCrash = now + 86400n;
    const createTx = await ownerWallet.writeContract({
      address: POLICY_MANAGER_ADDR,
      abi: parseAbi([
        "function createRootGrant(address,uint256,uint64,uint256,uint256) returns (bytes32)",
      ]),
      functionName: "createRootGrant",
      args: [agentB.address, 0x0Fn, expiryCrash, 50n, 200n],
      account: ownerWallet.account!,
      chain: undefined,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
    const crashGrantId = receipt.logs[0].topics[1] as Hex;

    // Attempt action with deterministic host tool execution failure
    const failingSub = await agentB.signAction({
      grantId: crashGrantId,
      toolName: "run_test_suite",
      cost: 15,
      paramsObj: { target: "failing" },
      nonce: 0,
    });

    const failRes = await app.inject({
      method: "POST",
      url: "/action",
      payload: failingSub,
    });

    expect(failRes.statusCode).toBe(500);
    const failBody = failRes.json();
    expect(failBody.error).toBe("ERR_TOOL_EXECUTION_FAILED");
    expect(failBody.budgetNote).toContain("not refunded");

    // Verify audit log status is FAILED
    const failRecord = auditDb.getAction(failingSub.actionId!);
    expect(failRecord?.status).toBe("FAILED");

    // Verify on-chain budget was consumed despite failure (conservative accounting)
    const grantAfterFailure = await policyClient.getGrant(crashGrantId);
    expect(grantAfterFailure.spent).toBe(15n);
    expect(grantAfterFailure.nonce).toBe(1n);

    // Replay attempt with same nonce (0) must fail on-chain
    const replayRes = await app.inject({
      method: "POST",
      url: "/action",
      payload: failingSub,
    });
    expect(replayRes.statusCode).toBe(403);
    expect(replayRes.json().details).toContain("InvalidNonce");

    // Agent reconciles by incrementing nonce to 1 with normal timeout -> succeeds without duplicating side effect
    const retrySub = await agentB.signAction({
      grantId: crashGrantId,
      toolName: "run_test_suite",
      cost: 10,
      paramsObj: { target: "unit", timeoutMs: 5000 },
      nonce: 1,
    });

    const retryRes = await app.inject({
      method: "POST",
      url: "/action",
      payload: retrySub,
    });

    expect(retryRes.statusCode).toBe(200);
    expect(retryRes.json().success).toBe(true);

    const grantAfterRetry = await policyClient.getGrant(crashGrantId);
    expect(grantAfterRetry.spent).toBe(25n); // 15 + 10
    expect(grantAfterRetry.nonce).toBe(2n);
  });

  it("16. should handle interruption after execution, persist unanchored evidence, and support idempotent retry-receipt", async () => {
    // Fresh grant for unanchored receipt recovery testing
    const now = BigInt(Math.floor(Date.now() / 1000));
    const expiry = now + 86400n;
    const createTx = await ownerWallet.writeContract({
      address: POLICY_MANAGER_ADDR,
      abi: parseAbi([
        "function createRootGrant(address,uint256,uint64,uint256,uint256) returns (bytes32)",
      ]),
      functionName: "createRootGrant",
      args: [agentB.address, 0x0Fn, expiry, 50n, 100n],
      account: ownerWallet.account!,
      chain: undefined,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
    const recoveryGrantId = receipt.logs[0].topics[1] as Hex;

    // Simulate transient failure during commitReceipt (interruption after tool execution)
    const originalCommit = policyClient.commitReceipt.bind(policyClient);
    let failCommitOnce = true;
    policyClient.commitReceipt = async (actionId, grantId, receiptHash) => {
      if (failCommitOnce) {
        failCommitOnce = false;
        throw new Error("Simulated network timeout during receipt anchoring");
      }
      return originalCommit(actionId, grantId, receiptHash);
    };

    const actionSub = await agentB.createValidWriteFile(
      recoveryGrantId,
      0,
      "unanchored-proof.txt",
      "Persistent execution proof"
    );

    const executeRes = await app.inject({
      method: "POST",
      url: "/action",
      payload: actionSub,
    });

    // 1. Tool execution succeeded on host, but receipt anchoring failed -> 202 UNANCHORED
    expect(executeRes.statusCode).toBe(202);
    const body = executeRes.json();
    expect(body.status).toBe("UNANCHORED");
    expect(body.warning).toContain("POST /actions/:actionId/retry-receipt");
    expect(body.resultHash).toBeDefined();

    // Verify host file was written
    const writtenFile = path.join(tempDir, "demo", "unanchored-proof.txt");
    expect(fs.existsSync(writtenFile)).toBe(true);

    // Verify database record has UNANCHORED status and execution resultHash preserved
    const actionRecord = auditDb.getAction(actionSub.actionId!);
    expect(actionRecord?.status).toBe("UNANCHORED");
    expect(actionRecord?.resultHash).toBe(body.resultHash);

    // Verify unanchored query returns this action
    const unanchoredList = auditDb.getUnanchoredActions();
    expect(unanchoredList.some((a) => a.actionId === actionSub.actionId)).toBe(true);

    // 2. Retry receipt commitment via recovery endpoint (re-uses existing evidence, does NOT re-run tool)
    const retryReceiptRes = await app.inject({
      method: "POST",
      url: `/actions/${actionSub.actionId}/retry-receipt`,
    });

    expect(retryReceiptRes.statusCode).toBe(200);
    const retryBody = retryReceiptRes.json();
    expect(retryBody.success).toBe(true);
    expect(retryBody.status).toBe("EXECUTED");
    expect(retryBody.receiptTxHash).toBeDefined();

    // Verify database status is now EXECUTED with receiptTxHash
    const updatedRecord = auditDb.getAction(actionSub.actionId!);
    expect(updatedRecord?.status).toBe("EXECUTED");
    expect(updatedRecord?.receiptTxHash).toBe(retryBody.receiptTxHash);

    // Verify action is no longer in unanchored list
    const unanchoredAfter = auditDb.getUnanchoredActions();
    expect(unanchoredAfter.some((a) => a.actionId === actionSub.actionId)).toBe(false);

    // 3. Duplicate retry-receipt submission must be idempotent
    const duplicateRetryRes = await app.inject({
      method: "POST",
      url: `/actions/${actionSub.actionId}/retry-receipt`,
    });
    expect(duplicateRetryRes.statusCode).toBe(200);
    expect(duplicateRetryRes.json().receiptTxHash).toBe(retryBody.receiptTxHash);
    expect(duplicateRetryRes.json().message).toContain("already anchored");

    // 4. Conflicting receipt submission with different resultHash must be strictly rejected
    const conflictingRes = await app.inject({
      method: "POST",
      url: `/actions/${actionSub.actionId}/receipt`,
      payload: {
        resultHash: "0x" + "a".repeat(64),
      },
    });
    expect(conflictingRes.statusCode).toBe(409);
    expect(conflictingRes.json().error).toBe("ERR_CONFLICTING_RECEIPT");

    // Restore original commit function
    policyClient.commitReceipt = originalCommit;
  });

  it("17. should reject conflicting request using an existing actionId with 409 Conflict", async () => {
    const actionId = "0x" + "c".repeat(64) as Hex;
    const initialSub = await agentB.createValidReadStatus(rootGrantId, 99);
    // Explicitly set actionId
    initialSub.actionId = actionId;

    // Submit valid action (fails on nonce or budget or succeeds, but records in DB)
    await app.inject({
      method: "POST",
      url: "/action",
      payload: initialSub,
    });

    // Attempt to submit a conflicting request reusing the same actionId but with different cost/tool
    const conflictingSub = {
      ...initialSub,
      cost: 99, // different cost!
    };

    const conflictRes = await app.inject({
      method: "POST",
      url: "/action",
      payload: conflictingSub,
    });

    expect(conflictRes.statusCode).toBe(409);
    expect(conflictRes.json().error).toBe("ERR_ACTION_ID_CONFLICT");

    const events = auditDb.getEventsForAction(actionId);
    const rejectedEvent = events.find((e) => e.eventType === "CONFLICTING_REQUEST_REJECTED");
    expect(rejectedEvent).toBeDefined();
  });
});
