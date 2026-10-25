// SPDX-License-Identifier: MIT
import React from "react";
import { GitBranch, XCircle, CheckCircle2, Clock } from "lucide-react";
import { decodeTools } from "../lib/config.js";
import type { Grant } from "@aegis/shared";

export interface GrantNode {
  grantId: `0x${string}`;
  grant: Grant;
  availableBudget: bigint;
  isValid: boolean;
  invalidNodeId: `0x${string}`;
  label: string;
  role: string;
  children: GrantNode[];
}

interface GrantTreeProps {
  nodes: GrantNode[];
  selectedGrantId: string | null;
  onSelectGrant: (grantId: `0x${string}`) => void;
}

export const GrantTree: React.FC<GrantTreeProps> = ({
  nodes,
  selectedGrantId,
  onSelectGrant,
}) => {
  const now = BigInt(Math.floor(Date.now() / 1000));

  const renderCard = (node: GrantNode, depth: number = 0) => {
    const isSelected = selectedGrantId === node.grantId;
    const isRevoked = node.grant.revoked;
    const isExpired = now > node.grant.expiresAt;
    const isAncestorRevoked = !node.isValid && node.invalidNodeId !== "0x0000000000000000000000000000000000000000000000000000000000000000" && !isRevoked;

    let statusType: "active" | "expired" | "revoked" = "active";
    let statusLabel = "Active";

    if (isRevoked) {
      statusType = "revoked";
      statusLabel = "Revoked";
    } else if (isAncestorRevoked) {
      statusType = "revoked";
      statusLabel = "Ancestor Revoked";
    } else if (isExpired) {
      statusType = "expired";
      statusLabel = "Expired";
    }

    const tools = decodeTools(node.grant.allowedTools);

    return (
      <div key={node.grantId} style={{ marginLeft: `${depth * 2.5}rem`, position: "relative" }}>
        {depth > 0 && (
          <div
            style={{
              position: "absolute",
              left: "-1.5rem",
              top: "1.75rem",
              width: "1.25rem",
              height: "2px",
              background: "rgba(255, 255, 255, 0.15)",
            }}
          />
        )}
        <div
          onClick={() => onSelectGrant(node.grantId)}
          className="glass-card"
          style={{
            marginBottom: "1rem",
            padding: "1rem 1.25rem",
            cursor: "pointer",
            borderLeft: `4px solid ${
              statusType === "active"
                ? "var(--emerald)"
                : statusType === "expired"
                ? "var(--amber)"
                : "var(--crimson)"
            }`,
            borderColor: isSelected ? "var(--primary)" : undefined,
            background: isSelected ? "var(--bg-card-active)" : undefined,
            boxShadow: isSelected ? "0 0 20px rgba(99, 102, 241, 0.3)" : undefined,
            opacity: statusType === "revoked" ? 0.75 : 1,
            transition: "all 0.2s ease",
          }}
        >
          {/* Header Row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-main)" }}>
                {node.label}
              </span>
              <span style={{ fontSize: "0.7rem", color: "var(--cyan)", background: "rgba(6, 182, 212, 0.12)", padding: "0.1rem 0.4rem", borderRadius: "4px" }}>
                {node.role}
              </span>
            </div>

            {/* Badge */}
            <span className={`badge badge-${statusType}`}>
              {statusType === "active" && <CheckCircle2 size={11} />}
              {statusType === "expired" && <Clock size={11} />}
              {statusType === "revoked" && <XCircle size={11} />}
              {statusLabel}
            </span>
          </div>

          {/* Details Row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "0.75rem", fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
            <div>
              <span style={{ color: "var(--text-dim)", display: "block" }}>Grant ID</span>
              <span className="mono" style={{ color: "var(--text-main)" }}>
                {node.grantId.slice(0, 10)}...{node.grantId.slice(-6)}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--text-dim)", display: "block" }}>Agent Address</span>
              <span className="mono" style={{ color: "var(--text-main)" }}>
                {node.grant.agent.slice(0, 6)}...{node.grant.agent.slice(-4)}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--text-dim)", display: "block" }}>Budget Cap</span>
              <span style={{ fontWeight: 600, color: "#6ee7b7" }}>
                {node.availableBudget.toString()} / {node.grant.maxTotalBudget.toString()} USDC
              </span>
            </div>
            <div>
              <span style={{ color: "var(--text-dim)", display: "block" }}>Tools Permitted</span>
              <span style={{ fontWeight: 600, color: "var(--text-main)" }}>
                {tools.length} of 5 tools
              </span>
            </div>
          </div>

          {/* Tool Pills */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.75rem" }}>
            {tools.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: "0.65rem",
                  padding: "0.15rem 0.45rem",
                  borderRadius: "4px",
                  background: "rgba(255, 255, 255, 0.05)",
                  color: "#cbd5e1",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* Render Children Recursively */}
        {node.children.map((child) => renderCard(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="glass-panel" style={{ padding: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <GitBranch size={20} color="var(--primary-light)" />
          <h2 style={{ fontSize: "1.15rem", fontWeight: 700 }}>Delegation Graph & Ancestry Tree</h2>
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          Click any grant node to inspect live quotas & trigger operator actions
        </div>
      </div>

      {nodes.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--text-dim)", fontSize: "0.85rem" }}>
          No active grants detected on-chain. Create a root grant or run the action simulator.
        </div>
      ) : (
        <div>{nodes.map((root) => renderCard(root, 0))}</div>
      )}
    </div>
  );
};
