// SPDX-License-Identifier: MIT
import React, { useState } from "react";
import { Play, ShieldAlert, Zap, Terminal, AlertOctagon, Send } from "lucide-react";
import { DEMO_ACCOUNTS, CONTRACT_ADDRESSES, CHAIN_ID } from "../lib/config.js";
import { submitActionToGateway } from "../lib/api.js";
import {
  buildActionRequest,
  getAegisPolicyManagerDomain,
  ACTION_REQUEST_TYPES,
  type ToolName,
} from "@aegis/shared";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

interface ActionSimulatorProps {
  grantsList: Array<{ grantId: `0x${string}`; label: string; agent: string; nonce: bigint }>;
  onActionComplete: () => void;
}

export const ActionSimulator: React.FC<ActionSimulatorProps> = ({
  grantsList,
  onActionComplete,
}) => {
  const [selectedAgentKey, setSelectedAgentKey] = useState<"agentA" | "agentB" | "attacker">("agentB");
  const [selectedGrantId, setSelectedGrantId] = useState<string>(grantsList[0]?.grantId || "");
  const [selectedTool, setSelectedTool] = useState<ToolName>("read_project_status");
  const [cost, setCost] = useState<number>(0);
  const [paramsInput, setParamsInput] = useState<string>('{\n  "format": "summary"\n}');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [executionResult, setExecutionResult] = useState<{
    status: number;
    data: any;
  } | null>(null);

  const handleToolChange = (tool: ToolName) => {
    setSelectedTool(tool);
    if (tool === "read_project_status") {
      setCost(0);
      setParamsInput('{\n  "format": "summary"\n}');
    } else if (tool === "write_demo_file") {
      setCost(5);
      setParamsInput('{\n  "fileName": "status.txt",\n  "content": "Operator system test successful"\n}');
    } else if (tool === "run_test_suite") {
      setCost(10);
      setParamsInput('{\n  "target": "unit"\n}');
    } else if (tool === "create_sandbox_branch") {
      setCost(5);
      setParamsInput('{\n  "branchName": "feature-auth-delegation"\n}');
    } else if (tool === "vault_transfer") {
      setCost(50);
      setParamsInput('{\n  "to": "0x000000000000000000000000000000000000CAFE",\n  "amount": "50000000"\n}');
    }
  };

  const executeActionRequest = async (override?: {
    toolName?: ToolName;
    cost?: number;
    paramsObj?: Record<string, unknown>;
    nonceOffset?: number;
    useAttackerKey?: boolean;
  }) => {
    const grantId = (selectedGrantId || grantsList[0]?.grantId) as Hex;
    if (!grantId) {
      alert("No grant selected");
      return;
    }

    const grantMeta = grantsList.find((g) => g.grantId.toLowerCase() === grantId.toLowerCase());
    const onChainNonce = grantMeta ? grantMeta.nonce : 0n;

    const tool = override?.toolName ?? selectedTool;
    const finalCost = override?.cost ?? cost;
    const nonce = override?.nonceOffset !== undefined
      ? BigInt(Math.max(0, Number(onChainNonce) + override.nonceOffset))
      : onChainNonce;

    let parsedParams: Record<string, unknown>;
    try {
      parsedParams = override?.paramsObj ?? JSON.parse(paramsInput);
    } catch {
      alert("Invalid JSON in parameters");
      return;
    }

    const activeAccountKey = override?.useAttackerKey ? "attacker" : selectedAgentKey;
    const accountInfo = DEMO_ACCOUNTS[activeAccountKey];
    const account = privateKeyToAccount(accountInfo.privateKey);

    setIsSubmitting(true);
    setExecutionResult(null);

    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      const actionReq = buildActionRequest({
        grantId,
        toolName: tool,
        cost: BigInt(finalCost),
        paramsObj: parsedParams,
        nonce,
        deadline,
      });

      const domain = getAegisPolicyManagerDomain(CHAIN_ID, CONTRACT_ADDRESSES.policyManager);

      const signature = await account.signTypedData({
        domain,
        types: ACTION_REQUEST_TYPES,
        primaryType: "ActionRequest",
        message: actionReq,
      });

      const submission = {
        grantId,
        toolName: tool,
        cost: finalCost,
        params: parsedParams,
        nonce: Number(nonce),
        deadline: Number(deadline),
        signature,
        actionId: actionReq.actionId,
      };

      const res = await submitActionToGateway(submission);
      setExecutionResult(res);
      onActionComplete();
    } catch (err: any) {
      setExecutionResult({
        status: 500,
        data: { error: "CLIENT_ERROR", message: err.message },
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="glass-panel" style={{ padding: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1.25rem" }}>
        <Play size={20} color="var(--primary-light)" />
        <h2 style={{ fontSize: "1.15rem", fontWeight: 700 }}>Deterministic Action Simulator & Threat Prover</h2>
      </div>

      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "1.5rem" }}>
        Construct cryptographic EIP-712 action requests and dispatch them to the Execution Gateway. Test both legitimate execution flows and adversarial attack vectors to observe on-chain enforcement in real time.
      </p>

      {/* Adversarial Attack Vector Shortcuts */}
      <div style={{ marginBottom: "1.5rem" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", display: "block", marginBottom: "0.6rem" }}>
          One-Click Adversarial Attacks & Policy Provers
        </span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "0.6rem" }}>
          <button
            onClick={() => executeActionRequest({ cost: 60 })}
            className="btn btn-secondary btn-sm"
            style={{ borderLeft: "3px solid var(--crimson)", justifyContent: "flex-start" }}
          >
            <ShieldAlert size={14} color="#ef4444" />
            Cap Violation (Cost 60 &gt; 50)
          </button>

          <button
            onClick={() => executeActionRequest({ nonceOffset: -1 })}
            className="btn btn-secondary btn-sm"
            style={{ borderLeft: "3px solid var(--amber)", justifyContent: "flex-start" }}
          >
            <Zap size={14} color="#f59e0b" />
            Replay Attack (Old Nonce)
          </button>

          <button
            onClick={() => executeActionRequest({ toolName: "write_demo_file", cost: 5, paramsObj: { fileName: "../../escaped.txt", content: "payload" } })}
            className="btn btn-secondary btn-sm"
            style={{ borderLeft: "3px solid var(--crimson)", justifyContent: "flex-start" }}
          >
            <AlertOctagon size={14} color="#ef4444" />
            Path Traversal (../../)
          </button>

          <button
            onClick={() => executeActionRequest({ toolName: "create_sandbox_branch", cost: 5, paramsObj: { branchName: "main; rm -rf /" } })}
            className="btn btn-secondary btn-sm"
            style={{ borderLeft: "3px solid var(--crimson)", justifyContent: "flex-start" }}
          >
            <Terminal size={14} color="#ef4444" />
            Shell Injection (rm -rf)
          </button>

          <button
            onClick={() => executeActionRequest({ useAttackerKey: true })}
            className="btn btn-secondary btn-sm"
            style={{ borderLeft: "3px solid var(--amber)", justifyContent: "flex-start" }}
          >
            <ShieldAlert size={14} color="#f59e0b" />
            Signature Forgery (Wrong Key)
          </button>

          <button
            onClick={() => executeActionRequest({ toolName: "vault_transfer", cost: 50, paramsObj: { to: "0x000000000000000000000000000000000000CAFE", amount: "50000000" } })}
            className="btn btn-secondary btn-sm"
            style={{ borderLeft: "3px solid #8b5cf6", justifyContent: "flex-start" }}
          >
            <ShieldAlert size={14} color="#8b5cf6" />
            Unauthorized Tool (Bit 0x10)
          </button>
        </div>
      </div>

      {/* Manual Request Builder Form */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "1.25rem", marginBottom: "1.5rem" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", display: "block", marginBottom: "0.75rem" }}>
          Manual Action Request Constructor
        </span>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
          <div>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: "0.4rem" }}>
              Signing Agent Key
            </label>
            <select
              value={selectedAgentKey}
              onChange={(e) => setSelectedAgentKey(e.target.value as any)}
              style={{
                width: "100%",
                background: "var(--bg-inset)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "8px",
                padding: "0.5rem 0.75rem",
                color: "var(--text-main)",
                fontSize: "0.8rem",
                outline: "none",
              }}
            >
              <option value="agentA">Agent A (Senior Orchestrator)</option>
              <option value="agentB">Agent B (Sub-Agent Worker)</option>
              <option value="attacker">Attacker (Unauthorized Key)</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: "0.4rem" }}>
              Target Delegation Grant
            </label>
            <select
              value={selectedGrantId}
              onChange={(e) => setSelectedGrantId(e.target.value)}
              style={{
                width: "100%",
                background: "var(--bg-inset)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "8px",
                padding: "0.5rem 0.75rem",
                color: "var(--text-main)",
                fontSize: "0.8rem",
                outline: "none",
              }}
            >
              {grantsList.map((g) => (
                <option key={g.grantId} value={g.grantId}>
                  {g.label} ({g.grantId.slice(0, 10)}... | Nonce: {g.nonce.toString()})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
          <div>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: "0.4rem" }}>
              Allowlisted Tool
            </label>
            <select
              value={selectedTool}
              onChange={(e) => handleToolChange(e.target.value as ToolName)}
              style={{
                width: "100%",
                background: "var(--bg-inset)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "8px",
                padding: "0.5rem 0.75rem",
                color: "var(--text-main)",
                fontSize: "0.8rem",
                outline: "none",
              }}
            >
              <option value="read_project_status">read_project_status (Bit 0x01)</option>
              <option value="run_test_suite">run_test_suite (Bit 0x02)</option>
              <option value="create_sandbox_branch">create_sandbox_branch (Bit 0x04)</option>
              <option value="write_demo_file">write_demo_file (Bit 0x08)</option>
              <option value="vault_transfer">vault_transfer (Bit 0x10)</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: "0.4rem" }}>
              Cost (USDC Units)
            </label>
            <input
              type="number"
              value={cost}
              onChange={(e) => setCost(Number(e.target.value))}
              style={{
                width: "100%",
                background: "var(--bg-inset)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "8px",
                padding: "0.5rem 0.75rem",
                color: "var(--text-main)",
                fontSize: "0.8rem",
                outline: "none",
              }}
            />
          </div>
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: "0.4rem" }}>
            Tool Parameters JSON
          </label>
          <textarea
            rows={3}
            value={paramsInput}
            onChange={(e) => setParamsInput(e.target.value)}
            className="mono"
            style={{
              width: "100%",
              background: "var(--bg-inset)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "8px",
              padding: "0.5rem 0.75rem",
              color: "var(--text-main)",
              fontSize: "0.78rem",
              outline: "none",
              resize: "vertical",
            }}
          />
        </div>

        <button
          onClick={() => executeActionRequest()}
          disabled={isSubmitting}
          className="btn btn-primary"
        >
          <Send size={14} />
          {isSubmitting ? "Signing & Dispatched to Gateway..." : "Sign EIP-712 & Submit to Gateway"}
        </button>
      </div>

      {/* Execution Results */}
      {executionResult && (
        <div
          className="glass-card"
          style={{
            padding: "1.25rem",
            borderRadius: "12px",
            border: `1px solid ${
              executionResult.status === 200
                ? "rgba(16, 185, 129, 0.4)"
                : executionResult.status === 202
                ? "rgba(245, 158, 11, 0.4)"
                : "rgba(239, 68, 68, 0.4)"
            }`,
            background:
              executionResult.status === 200
                ? "rgba(16, 185, 129, 0.08)"
                : executionResult.status === 202
                ? "rgba(245, 158, 11, 0.08)"
                : "rgba(239, 68, 68, 0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
            <span
              style={{
                fontSize: "0.95rem",
                fontWeight: 800,
                color:
                  executionResult.status === 200
                    ? "#6ee7b7"
                    : executionResult.status === 202
                    ? "#fcd34d"
                    : "#fca5a5",
              }}
            >
              Gateway Response: HTTP {executionResult.status} {executionResult.status === 200 ? "OK" : executionResult.status === 202 ? "ACCEPTED (UNANCHORED)" : "REJECTED"}
            </span>
          </div>

          <pre className="code-box" style={{ maxHeight: "250px", overflowY: "auto" }}>
            {JSON.stringify(executionResult.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
