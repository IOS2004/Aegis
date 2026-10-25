// SPDX-License-Identifier: MIT
import Fastify from "fastify";
import cors from "@fastify/cors";
import { ActionSubmissionSchema, ReadProjectStatusParamsSchema, RunTestSuiteParamsSchema, CreateSandboxBranchParamsSchema, WriteDemoFileParamsSchema, VaultTransferParamsSchema, TOOL_BITS, hashParams, computeActionId, } from "@aegis/shared";
export function buildGatewayServer(config) {
    const app = Fastify({ logger: false });
    app.register(cors, { origin: true });
    const { policyClient, auditDb, sandbox } = config;
    // Health check
    app.get("/health", async () => ({ status: "ok", service: "Aegis Execution Gateway" }));
    // Get all audit actions
    app.get("/actions", async () => {
        return auditDb.getAllActions();
    });
    // Get specific audit action
    app.get("/actions/:actionId", async (request, reply) => {
        const { actionId } = request.params;
        const record = auditDb.getAction(actionId);
        if (!record) {
            return reply.code(404).send({ error: "Action not found" });
        }
        return record;
    });
    // Get on-chain grant details
    app.get("/grants/:grantId", async (request, reply) => {
        const { grantId } = request.params;
        try {
            const grant = await policyClient.getGrant(grantId);
            const available = await policyClient.getAvailableBudget(grantId);
            const validity = await policyClient.isGrantValid(grantId);
            return {
                grant,
                availableBudget: available.toString(),
                validity,
            };
        }
        catch (err) {
            return reply.code(404).send({ error: "Failed to fetch grant", details: err?.message });
        }
    });
    // Trigger permissionless expired grant reclamation
    app.post("/grants/reclaim", async (request, reply) => {
        const { childGrantId } = request.body;
        if (!childGrantId) {
            return reply.code(400).send({ error: "childGrantId required" });
        }
        try {
            const { txHash } = await policyClient.reclaimExpiredBudget(childGrantId);
            return { success: true, childGrantId, txHash };
        }
        catch (err) {
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
        let validatedParams = sub.params;
        try {
            if (sub.toolName === "read_project_status") {
                validatedParams = ReadProjectStatusParamsSchema.parse(sub.params);
            }
            else if (sub.toolName === "run_test_suite") {
                validatedParams = RunTestSuiteParamsSchema.parse(sub.params);
            }
            else if (sub.toolName === "create_sandbox_branch") {
                validatedParams = CreateSandboxBranchParamsSchema.parse(sub.params);
            }
            else if (sub.toolName === "write_demo_file") {
                validatedParams = WriteDemoFileParamsSchema.parse(sub.params);
            }
            else if (sub.toolName === "vault_transfer") {
                validatedParams = VaultTransferParamsSchema.parse(sub.params);
            }
        }
        catch (schemaErr) {
            const pHash = hashParams(sub.params);
            const actionId = sub.actionId ??
                computeActionId(sub.grantId, BigInt(sub.nonce), toolBit, BigInt(Math.floor(Date.now() / 1000)));
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
            return reply.code(400).send({
                error: "ERR_INVALID_TOOL_PARAMETERS",
                message: schemaErr.message,
            });
        }
        // 3. Construct canonical ActionRequest
        const pHash = hashParams(validatedParams);
        const actionId = sub.actionId ??
            computeActionId(sub.grantId, BigInt(sub.nonce), toolBit, BigInt(Math.floor(Date.now() / 1000)));
        const actionReq = {
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
        }
        catch (err) {
            return reply.code(404).send({ error: "ERR_GRANT_NOT_FOUND" });
        }
        if (grant.grantId === "0x0000000000000000000000000000000000000000000000000000000000000000") {
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
            return reply.code(404).send({ error: "ERR_GRANT_NOT_FOUND" });
        }
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
        // 5. Verify EIP-712 signature locally
        const isSigValid = await policyClient.verifyActionSignature(actionReq, sub.signature, grant.agent);
        if (!isSigValid) {
            auditDb.updateStatus(actionId, "DENIED", {
                decisionReason: "ERR_INVALID_SIGNATURE",
            });
            return reply.code(401).send({ error: "ERR_INVALID_SIGNATURE" });
        }
        // 6. Pre-consume budget on-chain in AegisPolicyManager
        let preConsumeTx;
        try {
            const res = await policyClient.preConsumeBudget(actionReq, sub.signature);
            preConsumeTx = res.txHash;
            auditDb.updateStatus(actionId, "AUTHORIZED", { txHash: preConsumeTx });
        }
        catch (revertErr) {
            const errMsg = revertErr?.shortMessage ?? revertErr?.message ?? String(revertErr);
            auditDb.updateStatus(actionId, "DENIED", { decisionReason: errMsg });
            return reply.code(403).send({
                error: "ERR_ONCHAIN_POLICY_REJECTION",
                details: errMsg,
            });
        }
        // 7. Execute Sandboxed Tool
        auditDb.updateStatus(actionId, "EXECUTING");
        let toolResult;
        if (sub.toolName === "read_project_status") {
            toolResult = await sandbox.readProjectStatus(validatedParams);
        }
        else if (sub.toolName === "run_test_suite") {
            toolResult = await sandbox.runTestSuite(validatedParams);
        }
        else if (sub.toolName === "create_sandbox_branch") {
            toolResult = await sandbox.createSandboxBranch(validatedParams);
        }
        else if (sub.toolName === "write_demo_file") {
            toolResult = await sandbox.writeDemoFile(validatedParams);
        }
        else {
            toolResult = {
                success: false,
                toolName: sub.toolName,
                output: "",
                resultHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
                durationMs: 0,
                error: "Direct execution not supported for tool",
            };
        }
        // 8. Handle tool outcome & commit receipt hash on-chain
        if (toolResult.success) {
            try {
                await policyClient.commitReceipt(actionId, sub.grantId, toolResult.resultHash);
            }
            catch (commitErr) {
                // Receipt commitment error is logged but execution already occurred
            }
            auditDb.updateStatus(actionId, "EXECUTED", {
                resultHash: toolResult.resultHash,
                outputSummary: toolResult.output.slice(0, 500),
            });
            return reply.code(200).send({
                success: true,
                actionId,
                toolName: sub.toolName,
                cost: sub.cost,
                resultHash: toolResult.resultHash,
                output: toolResult.output,
                txHash: preConsumeTx,
            });
        }
        else {
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
