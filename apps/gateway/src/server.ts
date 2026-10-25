// SPDX-License-Identifier: MIT
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import {
  ActionSubmissionSchema,
  ReadProjectStatusParamsSchema,
  RunTestSuiteParamsSchema,
  CreateSandboxBranchParamsSchema,
  WriteDemoFileParamsSchema,
  VaultTransferParamsSchema,
  TOOL_BITS,
  hashParams,
  computeActionId,
  type ActionRequest,
  type ToolName,
  type Hex,
} from "@aegis/shared";
import { AuditDatabase } from "./services/auditDb.js";
import { PolicyClient } from "./services/policyClient.js";
import { SandboxEnvironment } from "./tools/sandbox.js";

export interface GatewayServerConfig {
  policyClient: PolicyClient;
  auditDb: AuditDatabase;
  sandbox: SandboxEnvironment;
}

function extractRevertReason(err: any): string {
  if (err?.data?.errorName) return err.data.errorName;
  if (err?.walk) {
    const customErr = err.walk((e: any) => Boolean(e?.data?.errorName));
    if (customErr?.data?.errorName) return customErr.data.errorName;
    const revertErr = err.walk((e: any) => Boolean(e?.shortMessage || e?.reason));
    if (revertErr?.shortMessage) return revertErr.shortMessage;
  }
  return err?.shortMessage || err?.message || String(err);
}

export function buildGatewayServer(config: GatewayServerConfig): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });

  app.setErrorHandler((error, request, reply) => {
    console.error("Fastify uncaught error:", error);
    reply.status(500).send({
      error: "INTERNAL_SERVER_ERROR",
      message: error?.message ?? String(error),
    });
  });

  const { policyClient, auditDb, sandbox } = config;

  // Health check
  app.get("/health", async () => ({ status: "ok", service: "Aegis Execution Gateway" }));

  // Get all audit actions
  app.get("/actions", async () => {
    return auditDb.getAllActions();
  });

  // Get unanchored actions awaiting receipt commitment
  app.get("/actions/unanchored", async () => {
    return auditDb.getUnanchoredActions();
  });

  // Get specific audit action
  app.get("/actions/:actionId", async (request, reply) => {
    const { actionId } = request.params as { actionId: string };
    const record = auditDb.getAction(actionId);
    if (!record) {
      return reply.code(404).send({ error: "Action not found" });
    }
    return record;
  });

  // Get immutable audit event stream for a specific action
  app.get("/actions/:actionId/events", async (request, reply) => {
    const { actionId } = request.params as { actionId: string };
    const action = auditDb.getAction(actionId);
    if (!action) {
      return reply.code(404).send({ error: "Action not found" });
    }
    return auditDb.getEventsForAction(actionId);
  });

  // Retry receipt commitment for an unanchored action without re-executing host tools
  app.post("/actions/:actionId/retry-receipt", async (request, reply) => {
    const { actionId } = request.params as { actionId: string };
    const action = auditDb.getAction(actionId);
    if (!action) {
      return reply.code(404).send({ error: "ERR_ACTION_NOT_FOUND", message: `Action ${actionId} not found` });
    }

    if (action.receiptTxHash && action.status === "EXECUTED") {
      return reply.code(200).send({
        success: true,
        actionId,
        receiptTxHash: action.receiptTxHash,
        status: "EXECUTED",
        message: "Receipt is already anchored on-chain",
      });
    }

    if (!action.resultHash) {
      return reply.code(400).send({
        error: "ERR_NO_RESULT_HASH",
        message: "Action has no execution resultHash available to anchor on-chain",
      });
    }

    try {
      const commitRes = await policyClient.commitReceipt(
        action.actionId as Hex,
        action.grantId as Hex,
        action.resultHash as Hex
      );

      auditDb.recordReceipt(action.actionId, action.resultHash, {
        receiptTxHash: commitRes.txHash,
        status: "EXECUTED",
      });

      return reply.code(200).send({
        success: true,
        actionId,
        receiptTxHash: commitRes.txHash,
        status: "EXECUTED",
      });
    } catch (err: any) {
      const reason = extractRevertReason(err);
      auditDb.appendEvent({
        actionId,
        eventType: "RETRY_ANCHORING_FAILED",
        previousStatus: action.status,
        newStatus: action.status,
        dataJson: JSON.stringify({ error: reason }),
      });

      return reply.code(500).send({
        success: false,
        actionId,
        error: "ERR_RECEIPT_ANCHORING_FAILED",
        details: reason,
      });
    }
  });

  // Verify or submit receipt idempotently; rejects conflicting receipts
  app.post("/actions/:actionId/receipt", async (request, reply) => {
    const { actionId } = request.params as { actionId: string };
    const { resultHash } = request.body as { resultHash: Hex };

    if (!resultHash || !/^0x[0-9a-fA-F]{64}$/.test(resultHash)) {
      return reply.code(400).send({ error: "ERR_INVALID_RESULT_HASH", message: "Must be a 32-byte hex hash" });
    }

    try {
      const res = auditDb.recordReceipt(actionId, resultHash);
      return reply.code(200).send({
        success: true,
        actionId,
        resultHash,
        alreadyAnchored: res.alreadyAnchored,
      });
    } catch (err: any) {
      if (err.message.includes("ERR_CONFLICTING_RECEIPT")) {
        return reply.code(409).send({
          error: "ERR_CONFLICTING_RECEIPT",
          message: err.message,
        });
      }
      if (err.message.includes("ERR_ACTION_NOT_FOUND")) {
        return reply.code(404).send({ error: "ERR_ACTION_NOT_FOUND", message: err.message });
      }
      return reply.code(500).send({ error: "ERR_INTERNAL", message: err.message });
    }
  });

  // Get on-chain grant details
  app.get("/grants/:grantId", async (request, reply) => {
    const { grantId } = request.params as { grantId: `0x${string}` };
    try {
      const grant = await policyClient.getGrant(grantId);
      const available = await policyClient.getAvailableBudget(grantId);
      const validity = await policyClient.isGrantValid(grantId);

      return {
        grant,
        availableBudget: available.toString(),
        validity,
      };
    } catch (err: any) {
      return reply.code(404).send({ error: "Failed to fetch grant", details: err?.message });
    }
  });

  // Trigger permissionless expired grant reclamation
  app.post("/grants/reclaim", async (request, reply) => {
    const { childGrantId } = request.body as { childGrantId: `0x${string}` };
    if (!childGrantId) {
      return reply.code(400).send({ error: "childGrantId required" });
    }

    try {
      const { txHash } = await policyClient.reclaimExpiredBudget(childGrantId);
      return { success: true, childGrantId, txHash };
    } catch (err: any) {
      return reply.code(400).send({ error: "Reclamation failed", details: err?.message });
    }
  });

  // Submit protected action request
  app.post("/action", async (request, reply) => {
    // 1. Validate top-level schema
    const parseResult = ActionSubmissionSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: "ERR_SCHEMA_VALIDATION_FAILED",
        details: parseResult.error.format(),
      });
    }

    const sub = parseResult.data;
    const toolBit = TOOL_BITS[sub.toolName];

    // 2. Validate tool-specific parameters schema
    let validatedParams: Record<string, unknown> = sub.params;
    try {
      if (sub.toolName === "read_project_status") {
        validatedParams = ReadProjectStatusParamsSchema.parse(sub.params);
      } else if (sub.toolName === "run_test_suite") {
        validatedParams = RunTestSuiteParamsSchema.parse(sub.params);
      } else if (sub.toolName === "create_sandbox_branch") {
        validatedParams = CreateSandboxBranchParamsSchema.parse(sub.params);
      } else if (sub.toolName === "write_demo_file") {
        validatedParams = WriteDemoFileParamsSchema.parse(sub.params);
      } else if (sub.toolName === "vault_transfer") {
        validatedParams = VaultTransferParamsSchema.parse(sub.params);
      }
    } catch (schemaErr: any) {
      const pHash = hashParams(sub.params);
      const actionId =
        sub.actionId ??
        computeActionId(sub.grantId, BigInt(sub.nonce), toolBit);

      try {
        auditDb.recordRequest({
          actionId,
          grantId: sub.grantId,
          agentAddress: "0x0000000000000000000000000000000000000000",
          toolName: sub.toolName,
          cost: sub.cost,
          params: sub.params,
          paramsHash: pHash,
          status: "DENIED",
          decisionReason: `Schema validation error: ${schemaErr.message}`,
        });
      } catch {}

      return reply.code(400).send({
        error: "ERR_INVALID_TOOL_PARAMETERS",
        message: schemaErr.message,
      });
    }

    // 3. Construct canonical ActionRequest
    const pHash = hashParams(validatedParams);
    const actionId =
      sub.actionId ??
      computeActionId(sub.grantId, BigInt(sub.nonce), toolBit);

    const actionReq: ActionRequest = {
      actionId,
      grantId: sub.grantId,
      toolBit,
      cost: BigInt(sub.cost),
      paramsHash: pHash,
      nonce: BigInt(sub.nonce),
      deadline: BigInt(sub.deadline),
    };

    // 4. Retrieve on-chain grant and verify identity & policy
    let grant;
    try {
      grant = await policyClient.getGrant(sub.grantId);
    } catch (err: any) {
      return reply.code(404).send({ error: "ERR_GRANT_NOT_FOUND" });
    }

    if (grant.grantId === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      try {
        auditDb.recordRequest({
          actionId,
          grantId: sub.grantId,
          agentAddress: "0x0000000000000000000000000000000000000000",
          toolName: sub.toolName,
          cost: sub.cost,
          params: validatedParams,
          paramsHash: pHash,
          status: "DENIED",
          decisionReason: "Grant does not exist",
        });
      } catch {}
      return reply.code(404).send({ error: "ERR_GRANT_NOT_FOUND" });
    }

    try {
      auditDb.recordRequest({
        actionId,
        grantId: sub.grantId,
        agentAddress: grant.agent,
        toolName: sub.toolName,
        cost: sub.cost,
        params: validatedParams,
        paramsHash: pHash,
        status: "REQUESTED",
      });
    } catch (conflictErr: any) {
      if (conflictErr.message.includes("ERR_ACTION_ID_CONFLICT")) {
        return reply.code(409).send({
          error: "ERR_ACTION_ID_CONFLICT",
          details: conflictErr.message,
        });
      }
      throw conflictErr;
    }

    // 5. Verify EIP-712 signature locally
    let isSigValid = false;
    try {
      isSigValid = await policyClient.verifyActionSignature(
        actionReq,
        sub.signature,
        grant.agent
      );
    } catch {
      isSigValid = false;
    }

    if (!isSigValid) {
      auditDb.updateStatus(actionId, "DENIED", {
        decisionReason: "ERR_INVALID_SIGNATURE",
      });
      return reply.code(401).send({ error: "ERR_INVALID_SIGNATURE" });
    }

    // 6. Pre-consume budget on-chain in AegisPolicyManager
    let preConsumeTx: `0x${string}`;
    try {
      const res = await policyClient.preConsumeBudget(actionReq, sub.signature);
      preConsumeTx = res.txHash;
      auditDb.updateStatus(actionId, "AUTHORIZED", { txHash: preConsumeTx });
    } catch (revertErr: any) {
      const reason = extractRevertReason(revertErr);
      auditDb.updateStatus(actionId, "DENIED", { decisionReason: reason });
      return reply.code(403).send({
        error: "ERR_ONCHAIN_POLICY_REJECTION",
        details: reason,
      });
    }

    // 7. Execute Sandboxed Tool
    auditDb.updateStatus(actionId, "EXECUTING");
    let toolResult;

    if (sub.toolName === "read_project_status") {
      toolResult = await sandbox.readProjectStatus(validatedParams as any);
    } else if (sub.toolName === "run_test_suite") {
      toolResult = await sandbox.runTestSuite(validatedParams as any);
    } else if (sub.toolName === "create_sandbox_branch") {
      toolResult = await sandbox.createSandboxBranch(validatedParams as any);
    } else if (sub.toolName === "write_demo_file") {
      toolResult = await sandbox.writeDemoFile(validatedParams as any);
    } else {
      toolResult = {
        success: false,
        toolName: sub.toolName,
        output: "",
        resultHash: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
        durationMs: 0,
        error: "Direct execution not supported for tool",
      };
    }

    // 8. Handle tool outcome & commit receipt hash on-chain
    if (toolResult.success) {
      // Record execution evidence first before on-chain commit attempt
      auditDb.recordReceipt(actionId, toolResult.resultHash, {
        outputSummary: toolResult.output.slice(0, 500),
        status: "UNANCHORED",
      });

      try {
        const commitRes = await policyClient.commitReceipt(
          actionId,
          sub.grantId,
          toolResult.resultHash
        );

        auditDb.recordReceipt(actionId, toolResult.resultHash, {
          receiptTxHash: commitRes.txHash,
          status: "EXECUTED",
        });

        return reply.code(200).send({
          success: true,
          actionId,
          toolName: sub.toolName,
          cost: sub.cost,
          resultHash: toolResult.resultHash,
          output: toolResult.output,
          txHash: preConsumeTx,
          receiptTxHash: commitRes.txHash,
          status: "EXECUTED",
        });
      } catch (commitErr: any) {
        // Tool executed on host, but receipt anchoring failed on-chain
        const reason = extractRevertReason(commitErr);
        auditDb.updateStatus(actionId, "UNANCHORED", {
          decisionReason: `Receipt anchoring failed: ${reason}`,
        });

        return reply.code(202).send({
          success: true,
          actionId,
          toolName: sub.toolName,
          cost: sub.cost,
          resultHash: toolResult.resultHash,
          output: toolResult.output,
          txHash: preConsumeTx,
          status: "UNANCHORED",
          warning: "Tool executed successfully on host, but on-chain receipt anchoring failed. Recoverable via POST /actions/:actionId/retry-receipt",
          details: reason,
        });
      }
    } else {
      // Conservative failure mode: on-chain budget remains pre-consumed to prevent exhaustion attacks
      auditDb.updateStatus(actionId, "FAILED", {
        decisionReason: toolResult.error,
        outputSummary: "Tool execution failed on host",
      });

      return reply.code(500).send({
        success: false,
        actionId,
        error: "ERR_TOOL_EXECUTION_FAILED",
        details: toolResult.error,
        budgetNote: "Pre-consumed on-chain budget was not refunded (conservative failure policy)",
      });
    }
  });

  return app;
}
