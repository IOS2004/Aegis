import { useState } from "react";
import {
  ShieldAlert,
  Coins,
  RotateCcw,
} from "lucide-react";
import { TOOL_NAMES_MAP } from "../lib/config.js";
import { executeRevokeOnChain, executeReclaimExpiredOnChain } from "../lib/api.js";
import type { GrantNode } from "./GrantTree.js";

interface GrantDetailsProps {
  selectedNode: GrantNode | null;
  callerPrivateKey: `0x${string}`;
  onActionComplete: () => void;
}

export const GrantDetails: React.FC<GrantDetailsProps> = ({
  selectedNode,
  callerPrivateKey,
  onActionComplete,
}) => {
  const [isRevoking, setIsRevoking] = useState(false);
  const [isReclaiming, setIsReclaiming] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  if (!selectedNode) {
    return (
      <div className="glass-panel" style={{ padding: "2rem", textAlign: "center", color: "var(--text-dim)" }}>
        <Coins size={36} style={{ margin: "0 auto 1rem", opacity: 0.4 }} />
        <h3 style={{ fontSize: "1rem", color: "var(--text-main)", marginBottom: "0.5rem" }}>
          No Grant Selected
        </h3>
        <p style={{ fontSize: "0.8rem" }}>
          Select a node from the Delegation Graph to inspect live quotas, budget distribution, and operator controls.
        </p>
      </div>
    );
  }

  const { grant, availableBudget, isValid, grantId, label } = selectedNode;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const isExpired = now > grant.expiresAt;

  // Budget calculations
  const total = Number(grant.maxTotalBudget);
  const spent = Number(grant.spent);
  const reserved = Number(grant.reservedChildBudget);
  const available = Number(availableBudget);

  const spentPct = total > 0 ? (spent / total) * 100 : 0;
  const reservedPct = total > 0 ? (reserved / total) * 100 : 0;
  const availablePct = total > 0 ? (available / total) * 100 : 0;

  // Time remaining calculation
  const remainingSecs = Number(grant.expiresAt - now);
  const days = Math.floor(remainingSecs / 86400);
  const hours = Math.floor((remainingSecs % 86400) / 3600);
  const minutes = Math.floor((remainingSecs % 3600) / 60);

  const handleRevoke = async () => {
    if (!confirm(`Are you sure you want to revoke grant ${grantId.slice(0, 10)}...? This action immediately disables this grant and its entire subtree.`)) {
      return;
    }
    setIsRevoking(true);
    setFeedbackMsg(null);
    try {
      const tx = await executeRevokeOnChain(grantId, callerPrivateKey);
      setFeedbackMsg({ text: `Grant successfully revoked on-chain! Tx: ${tx.slice(0, 14)}...`, type: "success" });
      onActionComplete();
    } catch (err: any) {
      setFeedbackMsg({ text: `Revocation failed: ${err.message}`, type: "error" });
    } finally {
      setIsRevoking(false);
    }
  };

  const handleReclaim = async () => {
    setIsReclaiming(true);
    setFeedbackMsg(null);
    try {
      const tx = await executeReclaimExpiredOnChain(grantId, callerPrivateKey);
      setFeedbackMsg({ text: `Unspent budget reclaimed back to parent! Tx: ${tx.slice(0, 14)}...`, type: "success" });
      onActionComplete();
    } catch (err: any) {
      setFeedbackMsg({ text: `Reclamation failed: ${err.message}`, type: "error" });
    } finally {
      setIsReclaiming(false);
    }
  };

  return (
    <div className="glass-panel" style={{ padding: "1.5rem" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "1rem" }}>
        <div>
          <span style={{ fontSize: "0.72rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
            Selected Grant Node
          </span>
          <h3 style={{ fontSize: "1.2rem", fontWeight: 800, color: "var(--text-main)" }}>
            {label}
          </h3>
        </div>
        <div style={{ textAlign: "right" }}>
          <span className={`badge badge-${grant.revoked || !isValid ? "revoked" : isExpired ? "expired" : "active"}`}>
            {grant.revoked ? "Revoked" : !isValid ? "Ancestor Revoked" : isExpired ? "Expired" : "Active & Enforced"}
          </span>
          <div className="mono" style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginTop: "0.3rem" }}>
            Nonce: {grant.nonce.toString()}
          </div>
        </div>
      </div>

      {feedbackMsg && (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "8px",
            fontSize: "0.8rem",
            marginBottom: "1rem",
            background: feedbackMsg.type === "success" ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
            border: `1px solid ${feedbackMsg.type === "success" ? "rgba(16, 185, 129, 0.4)" : "rgba(239, 68, 68, 0.4)"}`,
            color: feedbackMsg.type === "success" ? "#6ee7b7" : "#fca5a5",
          }}
        >
          {feedbackMsg.text}
        </div>
      )}

      {/* Budget Meter */}
      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.5rem" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)" }}>
            Subtree Budget Utilization
          </span>
          <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-main)" }}>
            {available} <span style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>/ {total} USDC Available</span>
          </span>
        </div>

        {/* Triple progress bar */}
        <div
          style={{
            height: "10px",
            borderRadius: "9999px",
            background: "rgba(255,255,255,0.06)",
            display: "flex",
            overflow: "hidden",
            marginBottom: "0.6rem",
          }}
        >
          <div style={{ width: `${spentPct}%`, background: "var(--cyan)" }} title={`Spent: ${spent}`} />
          <div style={{ width: `${reservedPct}%`, background: "var(--amber)" }} title={`Reserved for Children: ${reserved}`} />
          <div style={{ width: `${availablePct}%`, background: "var(--emerald)" }} title={`Available: ${available}`} />
        </div>

        {/* Legend */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "var(--text-dim)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--cyan)" }} />
            <span>Spent ({spent} USDC)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--amber)" }} />
            <span>Reserved Children ({reserved} USDC)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--emerald)" }} />
            <span>Available ({available} USDC)</span>
          </div>
        </div>
      </div>

      {/* Grid Properties */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.85rem", marginBottom: "1.5rem" }}>
        <div className="glass-card" style={{ padding: "0.85rem" }}>
          <span style={{ fontSize: "0.7rem", color: "var(--text-dim)", display: "block" }}>Single Action Cap</span>
          <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-main)" }}>
            {grant.maxPerAction.toString()} <span style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>USDC / action</span>
          </span>
        </div>

        <div className="glass-card" style={{ padding: "0.85rem" }}>
          <span style={{ fontSize: "0.7rem", color: "var(--text-dim)", display: "block" }}>Expiry Countdown</span>
          <span style={{ fontSize: "1.1rem", fontWeight: 700, color: isExpired ? "var(--crimson)" : "var(--amber)" }}>
            {isExpired ? "EXPIRED" : `${days}d ${hours}h ${minutes}m`}
          </span>
        </div>
      </div>

      {/* Permitted Tools */}
      <div style={{ marginBottom: "1.5rem" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: "0.5rem" }}>
          Cryptographically Allowed Tool Scope (Bitmask: {grant.allowedTools.toString()})
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
          {Object.entries(TOOL_NAMES_MAP).map(([bitStr, name]) => {
            const bit = BigInt(bitStr);
            const isAllowed = (grant.allowedTools & bit) !== 0n;
            return (
              <span
                key={name}
                style={{
                  fontSize: "0.7rem",
                  padding: "0.25rem 0.6rem",
                  borderRadius: "6px",
                  background: isAllowed ? "rgba(99, 102, 241, 0.15)" : "rgba(255, 255, 255, 0.02)",
                  color: isAllowed ? "#a5b4fc" : "var(--text-dim)",
                  border: `1px solid ${isAllowed ? "rgba(99, 102, 241, 0.35)" : "rgba(255, 255, 255, 0.05)"}`,
                  textDecoration: isAllowed ? "none" : "line-through",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {name}
              </span>
            );
          })}
        </div>
      </div>

      {/* Operator Controls */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "1.25rem" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", display: "block", marginBottom: "0.75rem" }}>
          Operator On-Chain Controls
        </span>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button
            onClick={handleRevoke}
            disabled={grant.revoked || isRevoking}
            className="btn btn-danger btn-sm"
            style={{ flex: 1 }}
          >
            <ShieldAlert size={14} />
            {isRevoking ? "Revoking..." : "Revoke Grant"}
          </button>

          {isExpired && !grant.reservationReleased && grant.parentGrantId !== "0x0000000000000000000000000000000000000000000000000000000000000000" && (
            <button
              onClick={handleReclaim}
              disabled={isReclaiming}
              className="btn btn-warning btn-sm"
              style={{ flex: 1 }}
            >
              <RotateCcw size={14} />
              {isReclaiming ? "Reclaiming..." : "Reclaim Expired Budget"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
