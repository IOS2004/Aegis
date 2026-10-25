// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { verifyTypedData, type Hex, type Address } from "viem";
import { MockAgent } from "../src/agent/mockAgent.js";
import {
  getAegisPolicyManagerDomain,
  ACTION_REQUEST_TYPES,
  buildActionRequest,
} from "@aegis/shared";

describe("MockAgent Adapter & Adversarial Request Generators", () => {
  const agentPk = "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d" as Hex;
  const policyManagerAddress = "0x1111111111111111111111111111111111111111" as Address;
  const chainId = 31337;
  const grantId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;

  const agent = new MockAgent({
    privateKey: agentPk,
    chainId,
    policyManagerAddress,
  });

  it("should generate a valid EIP-712 signed action request that verifies successfully", async () => {
    const sub = await agent.createValidReadStatus(grantId, 0);

    expect(sub.grantId).toBe(grantId);
    expect(sub.toolName).toBe("read_project_status");
    expect(sub.nonce).toBe(0);
    expect(sub.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);

    const actionReq = buildActionRequest({
      grantId: sub.grantId,
      toolName: sub.toolName,
      cost: BigInt(sub.cost),
      paramsObj: sub.params,
      nonce: BigInt(sub.nonce),
      deadline: BigInt(sub.deadline),
      actionId: sub.actionId,
    });

    const domain = getAegisPolicyManagerDomain(chainId, policyManagerAddress);
    const valid = await verifyTypedData({
      address: agent.address,
      domain,
      types: ACTION_REQUEST_TYPES,
      primaryType: "ActionRequest",
      message: actionReq,
      signature: sub.signature,
    });

    expect(valid).toBe(true);
  });

  it("should generate an unauthorized tool attempt request", async () => {
    const sub = await agent.createUnauthorizedToolAttempt(grantId, 1);
    expect(sub.toolName).toBe("vault_transfer");
    expect(sub.nonce).toBe(1);
    expect(sub.cost).toBe(50);
  });

  it("should generate an over-cap attempt request", async () => {
    const sub = await agent.createOverCapAttempt(grantId, 2, 500);
    expect(sub.cost).toBe(500);
    expect(sub.toolName).toBe("run_test_suite");
  });

  it("should generate an expired signature attempt", async () => {
    const sub = await agent.createExpiredSignatureAttempt(grantId, 3);
    const now = Math.floor(Date.now() / 1000);
    expect(sub.deadline).toBeLessThan(now);
  });

  it("should generate a path traversal attack request", async () => {
    const sub = await agent.createPathTraversalAttack(grantId, 4);
    expect(sub.params.fileName).toBe("../../escaped.txt");
  });

  it("should generate a shell injection attack request", async () => {
    const sub = await agent.createShellInjectionAttack(grantId, 5);
    expect(sub.params.branchName).toContain(";");
  });
});
