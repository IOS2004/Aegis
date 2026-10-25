// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AuditDatabase } from "../src/services/auditDb.js";
import type { Hex } from "@aegis/shared";

describe("AuditDatabase SQLite Service", () => {
  let db: AuditDatabase;

  beforeEach(() => {
    db = new AuditDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("should record an action request and retrieve it by actionId", () => {
    const actionId = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;
    const grantId = "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex;
    const agent = "0x3333333333333333333333333333333333333333" as Hex;

    db.recordRequest({
      actionId,
      grantId,
      agentAddress: agent,
      toolName: "run_test_suite",
      cost: 10,
      params: { target: "unit" },
      paramsHash: "0x4444444444444444444444444444444444444444444444444444444444444444" as Hex,
    });

    const record = db.getAction(actionId);
    expect(record).not.toBeNull();
    expect(record?.actionId).toBe(actionId);
    expect(record?.grantId).toBe(grantId);
    expect(record?.status).toBe("REQUESTED");
    expect(record?.cost).toBe(10);
  });

  it("should transition status from REQUESTED to AUTHORIZED and EXECUTED", () => {
    const actionId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;
    const grantId = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex;

    db.recordRequest({
      actionId,
      grantId,
      agentAddress: "0x0000000000000000000000000000000000000001" as Hex,
      toolName: "read_project_status",
      cost: 0,
      params: { format: "summary" },
      paramsHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as Hex,
    });

    db.updateStatus(actionId, "AUTHORIZED", {
      txHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" as Hex,
    });
    let rec = db.getAction(actionId);
    expect(rec?.status).toBe("AUTHORIZED");
    expect(rec?.txHash).toBe("0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd");

    db.updateStatus(actionId, "EXECUTED", {
      resultHash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as Hex,
      outputSummary: "Project is healthy",
    });
    rec = db.getAction(actionId);
    expect(rec?.status).toBe("EXECUTED");
    expect(rec?.resultHash).toBe("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
    expect(rec?.outputSummary).toBe("Project is healthy");
  });

  it("should record DENIED status with explicit reason code", () => {
    const actionId = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as Hex;
    db.recordRequest({
      actionId,
      grantId: "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
      agentAddress: "0x2222222222222222222222222222222222222222" as Hex,
      toolName: "vault_transfer",
      cost: 100,
      params: {},
      paramsHash: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
      status: "DENIED",
      decisionReason: "ERR_TOOL_NOT_PERMITTED",
    });

    const rec = db.getAction(actionId);
    expect(rec?.status).toBe("DENIED");
    expect(rec?.decisionReason).toBe("ERR_TOOL_NOT_PERMITTED");
  });
});
