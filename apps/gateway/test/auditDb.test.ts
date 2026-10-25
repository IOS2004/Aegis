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

    const events = db.getEventsForAction(actionId);
    expect(events.length).toBe(1);
    expect(events[0].eventType).toBe("REQUEST_RECORDED");
    expect(events[0].newStatus).toBe("REQUESTED");
  });

  it("should transition status from REQUESTED to AUTHORIZED and EXECUTED with audit trail", () => {
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

    const events = db.getEventsForAction(actionId);
    expect(events.length).toBe(3);
    expect(events[0].eventType).toBe("REQUEST_RECORDED");
    expect(events[1].eventType).toBe("STATUS_CHANGED");
    expect(events[1].newStatus).toBe("AUTHORIZED");
    expect(events[2].eventType).toBe("STATUS_CHANGED");
    expect(events[2].newStatus).toBe("EXECUTED");
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

  it("should handle idempotent duplicate requests and reject conflicting requests", () => {
    const actionId = "0x5555555555555555555555555555555555555555555555555555555555555555" as Hex;
    const grantId = "0x6666666666666666666666666666666666666666666666666666666666666666" as Hex;

    // First request
    db.recordRequest({
      actionId,
      grantId,
      agentAddress: "0x7777777777777777777777777777777777777777" as Hex,
      toolName: "read_project_status",
      cost: 0,
      params: { format: "summary" },
      paramsHash: "0x8888888888888888888888888888888888888888888888888888888888888888" as Hex,
    });

    // Idempotent duplicate: exact same grantId, toolName, cost, and paramsHash
    const dup = db.recordRequest({
      actionId,
      grantId,
      agentAddress: "0x7777777777777777777777777777777777777777" as Hex,
      toolName: "read_project_status",
      cost: 0,
      params: { format: "summary" },
      paramsHash: "0x8888888888888888888888888888888888888888888888888888888888888888" as Hex,
    });
    expect(dup.actionId).toBe(actionId);

    const events = db.getEventsForAction(actionId);
    expect(events.length).toBe(2);
    expect(events[1].eventType).toBe("DUPLICATE_REQUEST_RECORDED");

    // Conflicting request: same actionId but different cost or tool
    expect(() =>
      db.recordRequest({
        actionId,
        grantId,
        agentAddress: "0x7777777777777777777777777777777777777777" as Hex,
        toolName: "run_test_suite", // Different tool!
        cost: 10,
        params: { target: "unit" },
        paramsHash: "0x9999999999999999999999999999999999999999999999999999999999999999" as Hex,
      })
    ).toThrow("ERR_ACTION_ID_CONFLICT");

    const eventsAfterConflict = db.getEventsForAction(actionId);
    expect(eventsAfterConflict.length).toBe(3);
    expect(eventsAfterConflict[2].eventType).toBe("CONFLICTING_REQUEST_REJECTED");
  });

  it("should make duplicate receipts idempotent and reject conflicting receipts", () => {
    const actionId = "0x9999999999999999999999999999999999999999999999999999999999999999" as Hex;
    const resultHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;
    const conflictingHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex;

    db.recordRequest({
      actionId,
      grantId: "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
      agentAddress: "0x2222222222222222222222222222222222222222" as Hex,
      toolName: "write_demo_file",
      cost: 5,
      params: { fileName: "demo.txt", content: "hello" },
      paramsHash: "0x3333333333333333333333333333333333333333333333333333333333333333" as Hex,
    });

    // 1. Initial unanchored receipt recording
    const res1 = db.recordReceipt(actionId, resultHash, {
      outputSummary: "Wrote demo.txt",
    });
    expect(res1.success).toBe(true);
    expect(res1.alreadyAnchored).toBe(false);

    let action = db.getAction(actionId);
    expect(action?.status).toBe("UNANCHORED");
    expect(action?.resultHash).toBe(resultHash);

    // 2. Idempotent duplicate receipt (same resultHash)
    const res2 = db.recordReceipt(actionId, resultHash);
    expect(res2.success).toBe(true);

    // 3. Anchor receipt with txHash
    const res3 = db.recordReceipt(actionId, resultHash, {
      receiptTxHash: "0x4444444444444444444444444444444444444444444444444444444444444444" as Hex,
      status: "EXECUTED",
    });
    expect(res3.success).toBe(true);
    expect(res3.alreadyAnchored).toBe(true);

    action = db.getAction(actionId);
    expect(action?.status).toBe("EXECUTED");
    expect(action?.receiptTxHash).toBe("0x4444444444444444444444444444444444444444444444444444444444444444");

    // 4. Conflicting receipt attempt with different resultHash must be strictly rejected
    expect(() => db.recordReceipt(actionId, conflictingHash)).toThrow("ERR_CONFLICTING_RECEIPT");

    // Confirm history was NOT overwritten
    action = db.getAction(actionId);
    expect(action?.resultHash).toBe(resultHash);

    const events = db.getEventsForAction(actionId);
    const conflictEvent = events.find((e) => e.eventType === "CONFLICTING_RECEIPT_REJECTED");
    expect(conflictEvent).toBeDefined();
  });

  it("should query unanchored actions for recovery", () => {
    const act1 = "0x1000000000000000000000000000000000000000000000000000000000000001" as Hex;
    const act2 = "0x1000000000000000000000000000000000000000000000000000000000000002" as Hex;

    db.recordRequest({
      actionId: act1,
      grantId: "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
      agentAddress: "0x2222222222222222222222222222222222222222" as Hex,
      toolName: "read_project_status",
      cost: 0,
      params: {},
      paramsHash: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
    });
    db.recordReceipt(act1, "0xhash1" as Hex); // UNANCHORED

    db.recordRequest({
      actionId: act2,
      grantId: "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
      agentAddress: "0x2222222222222222222222222222222222222222" as Hex,
      toolName: "read_project_status",
      cost: 0,
      params: {},
      paramsHash: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
    });
    db.recordReceipt(act2, "0xhash2" as Hex, {
      receiptTxHash: "0xtx2" as Hex,
      status: "EXECUTED",
    }); // ANCHORED

    const unanchored = db.getUnanchoredActions();
    expect(unanchored.length).toBe(1);
    expect(unanchored[0].actionId).toBe(act1);
  });
});
