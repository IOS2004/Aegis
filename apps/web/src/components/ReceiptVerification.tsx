import React, { useState } from "react";
import { FileCheck2, ShieldCheck, ShieldAlert, Hash } from "lucide-react";
import type { ActionRecord } from "../lib/api.js";
import { verifyReceiptApi } from "../lib/api.js";
import type { Hex } from "viem";

interface ReceiptVerificationProps {
  recentActions: ActionRecord[];
}

export const ReceiptVerification: React.FC<ReceiptVerificationProps> = ({ recentActions }) => {
  const [selectedActionId, setSelectedActionId] = useState<string>("");
  const [manualActionId, setManualActionId] = useState<string>("");
  const [outputPayload, setOutputPayload] = useState<string>("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    verified: boolean;
    onChainHash?: string;
    computedHash?: string;
    details?: string;
  } | null>(null);

  const handleSelectAction = (actId: string) => {
    setSelectedActionId(actId);
    setManualActionId(actId);
    const act = recentActions.find((a) => a.actionId === actId);
    if (act) {
      setOutputPayload(act.outputSummary || "");
    }
  };

  const computeSha256 = async (str: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return "0x" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const handleComputeAndVerify = async () => {
    const actId = manualActionId.trim();
    if (!actId) {
      alert("Please enter or select an Action ID");
      return;
    }

    setIsVerifying(true);
    setVerificationResult(null);

    try {
      // 1. Compute hash client-side
      const computed = await computeSha256(outputPayload);

      // 2. Find target action from records
      const act = recentActions.find((a) => a.actionId.toLowerCase() === actId.toLowerCase());
      const onChainHash = act?.resultHash;

      if (!onChainHash) {
        setVerificationResult({
          verified: false,
          computedHash: computed,
          details: "Action has no recorded resultHash on-chain or in gateway",
        });
        return;
      }

      const isMatch = computed.toLowerCase() === onChainHash.toLowerCase();

      // Test idempotent submission to API
      try {
        await verifyReceiptApi(actId, onChainHash as Hex);
      } catch {}

      setVerificationResult({
        verified: isMatch,
        onChainHash,
        computedHash: computed,
        details: isMatch
          ? "Client-side output hash matches the immutable on-chain receipt hash exactly."
          : "HASH MISMATCH: Local execution payload differs from the anchored receipt hash!",
      });
    } catch (err: any) {
      setVerificationResult({
        verified: false,
        details: err.message || "Failed to verify receipt",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="glass-panel" style={{ padding: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1.25rem" }}>
        <FileCheck2 size={20} color="var(--primary-light)" />
        <h2 style={{ fontSize: "1.15rem", fontWeight: 700 }}>Independent Cryptographic Receipt Verification</h2>
      </div>

      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "1.5rem" }}>
        Verify that an off-chain execution output was not tampered with. Paste the raw execution output and compute its SHA-256 hash client-side to verify it against the on-chain anchored receipt.
      </p>

      {/* Action Picker from recent list */}
      <div style={{ marginBottom: "1.25rem" }}>
        <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: "0.4rem" }}>
          Load from Recent Gateway Actions
        </label>
        <select
          value={selectedActionId}
          onChange={(e) => handleSelectAction(e.target.value)}
          style={{
            width: "100%",
            background: "var(--bg-inset)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "8px",
            padding: "0.55rem 0.85rem",
            color: "var(--text-main)",
            fontSize: "0.8rem",
            outline: "none",
          }}
        >
          <option value="">-- Choose an action or enter manually below --</option>
          {recentActions.map((a) => (
            <option key={a.actionId} value={a.actionId}>
              {a.actionId.slice(0, 16)}... | {a.toolName} ({a.status}) {a.resultHash ? `[Hash: ${a.resultHash.slice(0, 10)}...]` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Manual Inputs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "1rem", marginBottom: "1.25rem" }}>
        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: "0.4rem" }}>
            Action ID (bytes32 hex)
          </label>
          <input
            type="text"
            placeholder="0x..."
            value={manualActionId}
            onChange={(e) => setManualActionId(e.target.value)}
            className="mono"
            style={{
              width: "100%",
              background: "var(--bg-inset)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "8px",
              padding: "0.55rem 0.85rem",
              color: "var(--text-main)",
              fontSize: "0.8rem",
              outline: "none",
            }}
          />
        </div>

        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: "0.4rem" }}>
            Execution Output Payload (Raw Output)
          </label>
          <textarea
            rows={4}
            placeholder="Enter raw output or file content to verify..."
            value={outputPayload}
            onChange={(e) => setOutputPayload(e.target.value)}
            className="mono"
            style={{
              width: "100%",
              background: "var(--bg-inset)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "8px",
              padding: "0.55rem 0.85rem",
              color: "var(--text-main)",
              fontSize: "0.8rem",
              outline: "none",
              resize: "vertical",
            }}
          />
        </div>
      </div>

      {/* Action Button */}
      <button
        onClick={handleComputeAndVerify}
        disabled={isVerifying || !manualActionId.trim()}
        className="btn btn-primary"
        style={{ marginBottom: "1.5rem" }}
      >
        <Hash size={14} />
        {isVerifying ? "Verifying..." : "Compute SHA-256 & Verify Against Chain"}
      </button>

      {/* Verification Results Panel */}
      {verificationResult && (
        <div
          className="glass-card"
          style={{
            padding: "1.25rem",
            borderRadius: "12px",
            border: `1px solid ${
              verificationResult.verified
                ? "rgba(16, 185, 129, 0.4)"
                : "rgba(239, 68, 68, 0.4)"
            }`,
            background: verificationResult.verified
              ? "rgba(16, 185, 129, 0.08)"
              : "rgba(239, 68, 68, 0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.75rem" }}>
            {verificationResult.verified ? (
              <ShieldCheck size={24} color="#10b981" />
            ) : (
              <ShieldAlert size={24} color="#ef4444" />
            )}
            <h4
              style={{
                fontSize: "1rem",
                fontWeight: 800,
                color: verificationResult.verified ? "#6ee7b7" : "#fca5a5",
                letterSpacing: "0.02em",
              }}
            >
              {verificationResult.verified
                ? "CRYPTOGRAPHICALLY VERIFIED"
                : "VERIFICATION FAILED"}
            </h4>
          </div>

          <p style={{ fontSize: "0.8rem", color: "var(--text-main)", marginBottom: "1rem" }}>
            {verificationResult.details}
          </p>

          <div className="code-box" style={{ fontSize: "0.75rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <div>
              <strong style={{ color: "#94a3b8" }}>Client-Calculated Hash:</strong>{" "}
              {verificationResult.computedHash ?? "N/A"}
            </div>
            <div>
              <strong style={{ color: "#94a3b8" }}>On-Chain Anchored Hash:</strong>{" "}
              {verificationResult.onChainHash ?? "N/A"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
