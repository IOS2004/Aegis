import React, { useState } from "react";
import {
  Activity,
  Clock,
  Search,
  RotateCw,
} from "lucide-react";
import type { ActionRecord, AuditEventRecord } from "../lib/api.js";
import { fetchActionEvents, retryReceiptCommitment } from "../lib/api.js";

interface ActionFeedProps {
  actions: ActionRecord[];
  onRefresh: () => void;
}

export const ActionFeed: React.FC<ActionFeedProps> = ({ actions, onRefresh }) => {
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedAction, setSelectedAction] = useState<ActionRecord | null>(null);
  const [actionEvents, setActionEvents] = useState<AuditEventRecord[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [isRetryingReceipt, setIsRetryingReceipt] = useState(false);
  const [retryStatusMsg, setRetryStatusMsg] = useState<string | null>(null);

  const filteredActions = actions.filter((act) => {
    if (filterStatus !== "ALL" && act.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        act.actionId.toLowerCase().includes(q) ||
        act.toolName.toLowerCase().includes(q) ||
        act.grantId.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleOpenAction = async (act: ActionRecord) => {
    setSelectedAction(act);
    setIsLoadingEvents(true);
    setRetryStatusMsg(null);
    try {
      const events = await fetchActionEvents(act.actionId);
      setActionEvents(events);
    } catch {
      setActionEvents([]);
    } finally {
      setIsLoadingEvents(false);
    }
  };

  const handleRetryReceipt = async (actionId: string) => {
    setIsRetryingReceipt(true);
    setRetryStatusMsg(null);
    try {
      const res = await retryReceiptCommitment(actionId);
      if (res.success) {
        setRetryStatusMsg(`Successfully anchored on-chain! Tx: ${res.receiptTxHash?.slice(0, 16)}...`);
        onRefresh();
        if (selectedAction && selectedAction.actionId === actionId) {
          const events = await fetchActionEvents(actionId);
          setActionEvents(events);
          setSelectedAction({ ...selectedAction, status: "EXECUTED", receiptTxHash: res.receiptTxHash });
        }
      } else {
        setRetryStatusMsg(`Retry failed: ${res.error}`);
      }
    } catch (err: any) {
      setRetryStatusMsg(`Error: ${err.message}`);
    } finally {
      setIsRetryingReceipt(false);
    }
  };

  return (
    <div className="glass-panel" style={{ padding: "1.5rem" }}>
      {/* Feed Controls Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <Activity size={20} color="var(--primary-light)" />
          <h2 style={{ fontSize: "1.15rem", fontWeight: 700 }}>Gateway Action Feed & Cryptographic Audit</h2>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: "0.6rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)" }} />
            <input
              type="text"
              placeholder="Search Action ID / Tool..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                background: "var(--bg-inset)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "6px",
                padding: "0.35rem 0.6rem 0.35rem 1.8rem",
                color: "var(--text-main)",
                fontSize: "0.78rem",
                outline: "none",
                width: "200px",
              }}
            />
          </div>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{
              background: "var(--bg-inset)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "6px",
              padding: "0.35rem 0.65rem",
              color: "var(--text-main)",
              fontSize: "0.78rem",
              outline: "none",
            }}
          >
            <option value="ALL">All Statuses</option>
            <option value="EXECUTED">Executed</option>
            <option value="UNANCHORED">Unanchored (Recoverable)</option>
            <option value="FAILED">Failed</option>
            <option value="DENIED">Denied</option>
          </select>
        </div>
      </div>

      {/* Action Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", textAlign: "left" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-subtle)", color: "var(--text-dim)", textTransform: "uppercase", fontSize: "0.68rem" }}>
              <th style={{ padding: "0.75rem" }}>Status</th>
              <th style={{ padding: "0.75rem" }}>Action ID</th>
              <th style={{ padding: "0.75rem" }}>Tool</th>
              <th style={{ padding: "0.75rem" }}>Cost</th>
              <th style={{ padding: "0.75rem" }}>Grant</th>
              <th style={{ padding: "0.75rem" }}>Anchored Receipt</th>
              <th style={{ padding: "0.75rem", textAlign: "right" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredActions.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "2.5rem", color: "var(--text-dim)" }}>
                  No actions found matching filters.
                </td>
              </tr>
            ) : (
              filteredActions.map((act) => (
                <tr
                  key={act.actionId}
                  style={{
                    borderBottom: "1px solid var(--border-subtle)",
                    transition: "background 0.15s ease",
                  }}
                  className="table-row-hover"
                >
                  <td style={{ padding: "0.75rem" }}>
                    <span className={`badge badge-${
                      act.status === "EXECUTED"
                        ? "active"
                        : act.status === "UNANCHORED"
                        ? "unanchored"
                        : "revoked"
                    }`}>
                      {act.status}
                    </span>
                  </td>
                  <td style={{ padding: "0.75rem" }} className="mono">
                    <span title={act.actionId} style={{ color: "var(--text-main)", fontWeight: 500 }}>
                      {act.actionId.slice(0, 10)}...{act.actionId.slice(-6)}
                    </span>
                  </td>
                  <td style={{ padding: "0.75rem" }}>
                    <span className="mono" style={{ color: "#a5b4fc", background: "rgba(99, 102, 241, 0.1)", padding: "0.15rem 0.4rem", borderRadius: "4px" }}>
                      {act.toolName}
                    </span>
                  </td>
                  <td style={{ padding: "0.75rem", fontWeight: 600, color: "var(--text-main)" }}>
                    {act.cost} USDC
                  </td>
                  <td style={{ padding: "0.75rem", color: "var(--text-dim)" }} className="mono">
                    {act.grantId.slice(0, 8)}...
                  </td>
                  <td style={{ padding: "0.75rem" }}>
                    {act.receiptTxHash ? (
                      <span className="mono" style={{ fontSize: "0.72rem", color: "#6ee7b7" }}>
                        ✓ {act.receiptTxHash.slice(0, 10)}...
                      </span>
                    ) : act.status === "UNANCHORED" ? (
                      <span style={{ fontSize: "0.72rem", color: "#f59e0b", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                        <Clock size={11} /> Unanchored
                      </span>
                    ) : (
                      <span style={{ fontSize: "0.72rem", color: "var(--text-dim)" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "0.75rem", textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: "0.4rem" }}>
                      {act.status === "UNANCHORED" && (
                        <button
                          onClick={() => handleRetryReceipt(act.actionId)}
                          disabled={isRetryingReceipt}
                          className="btn btn-warning btn-sm"
                          title="Retry on-chain receipt anchoring"
                        >
                          <RotateCw size={12} className={isRetryingReceipt ? "spin-icon" : ""} />
                          Anchor
                        </button>
                      )}
                      <button
                        onClick={() => handleOpenAction(act)}
                        className="btn btn-secondary btn-sm"
                      >
                        Inspect
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Action Inspection Modal */}
      {selectedAction && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1rem",
          }}
          onClick={() => setSelectedAction(null)}
        >
          <div
            className="glass-panel"
            style={{
              width: "100%",
              maxWidth: "760px",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: "2rem",
              background: "#0c101b",
              border: "1px solid var(--border-card)",
              borderRadius: "16px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "1rem" }}>
              <div>
                <span style={{ fontSize: "0.75rem", color: "var(--cyan)", fontWeight: 700, textTransform: "uppercase" }}>
                  Action Inspection & Audit Trail
                </span>
                <h3 className="mono" style={{ fontSize: "1.1rem", color: "var(--text-main)", marginTop: "0.2rem" }}>
                  {selectedAction.actionId}
                </h3>
              </div>
              <button
                onClick={() => setSelectedAction(null)}
                className="btn btn-secondary btn-sm"
              >
                Close
              </button>
            </div>

            {retryStatusMsg && (
              <div style={{ padding: "0.6rem 0.8rem", borderRadius: "6px", background: "rgba(16, 185, 129, 0.15)", color: "#6ee7b7", fontSize: "0.8rem", marginBottom: "1rem" }}>
                {retryStatusMsg}
              </div>
            )}

            {/* Status & Properties */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.25rem" }}>
              <div className="glass-card" style={{ padding: "0.85rem" }}>
                <span style={{ fontSize: "0.7rem", color: "var(--text-dim)", display: "block" }}>Execution Status</span>
                <span className={`badge badge-${selectedAction.status === "EXECUTED" ? "active" : selectedAction.status === "UNANCHORED" ? "unanchored" : "revoked"}`} style={{ marginTop: "0.3rem" }}>
                  {selectedAction.status}
                </span>
                {selectedAction.decisionReason && (
                  <div style={{ fontSize: "0.75rem", color: "#fca5a5", marginTop: "0.4rem" }}>
                    {selectedAction.decisionReason}
                  </div>
                )}
              </div>

              <div className="glass-card" style={{ padding: "0.85rem" }}>
                <span style={{ fontSize: "0.7rem", color: "var(--text-dim)", display: "block" }}>Tool & Cost</span>
                <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-main)", display: "block", marginTop: "0.2rem" }}>
                  {selectedAction.toolName} ({selectedAction.cost} USDC)
                </span>
                <span className="mono" style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>
                  Grant: {selectedAction.grantId.slice(0, 14)}...
                </span>
              </div>
            </div>

            {/* Hashes & Transactions */}
            <div style={{ marginBottom: "1.25rem" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", display: "block", marginBottom: "0.5rem" }}>
                Cryptographic Evidence & On-Chain Anchors
              </span>
              <div className="code-box" style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <div><strong style={{ color: "#94a3b8" }}>Params Hash:</strong> {selectedAction.paramsHash}</div>
                <div><strong style={{ color: "#94a3b8" }}>Result Hash:</strong> {selectedAction.resultHash ?? "None (Failed or Denied)"}</div>
                <div><strong style={{ color: "#94a3b8" }}>Pre-Consume Tx:</strong> {selectedAction.txHash ?? "None"}</div>
                <div><strong style={{ color: "#94a3b8" }}>Receipt Anchor Tx:</strong> {selectedAction.receiptTxHash ?? "Pending / Unanchored"}</div>
              </div>
            </div>

            {/* Input Parameters */}
            <div style={{ marginBottom: "1.25rem" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", display: "block", marginBottom: "0.5rem" }}>
                Validated Input Parameters
              </span>
              <pre className="code-box">
                {JSON.stringify(JSON.parse(selectedAction.paramsJson || "{}"), null, 2)}
              </pre>
            </div>

            {/* Append-Only Audit Trail */}
            <div>
              <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", display: "block", marginBottom: "0.5rem" }}>
                Append-Only Audit Event Trail ({actionEvents.length} events)
              </span>
              {isLoadingEvents ? (
                <div style={{ color: "var(--text-dim)", fontSize: "0.75rem" }}>Loading audit stream...</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  {actionEvents.map((ev) => (
                    <div
                      key={ev.id}
                      style={{
                        padding: "0.6rem 0.85rem",
                        borderRadius: "6px",
                        background: "rgba(255, 255, 255, 0.02)",
                        border: "1px solid var(--border-subtle)",
                        fontSize: "0.75rem",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <span className="mono" style={{ color: "var(--cyan)", fontWeight: 600 }}>
                          {ev.eventType}
                        </span>
                        {ev.previousStatus && ev.newStatus && (
                          <span style={{ color: "var(--text-dim)", marginLeft: "0.5rem" }}>
                            {ev.previousStatus} → {ev.newStatus}
                          </span>
                        )}
                      </div>
                      <span className="mono" style={{ color: "var(--text-dim)", fontSize: "0.7rem" }}>
                        {new Date(ev.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recover Button Footer */}
            {selectedAction.status === "UNANCHORED" && (
              <div style={{ marginTop: "1.5rem", borderTop: "1px solid var(--border-subtle)", paddingTop: "1rem", display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={() => handleRetryReceipt(selectedAction.actionId)}
                  disabled={isRetryingReceipt}
                  className="btn btn-warning"
                >
                  <RotateCw size={14} className={isRetryingReceipt ? "spin-icon" : ""} />
                  {isRetryingReceipt ? "Anchoring on-chain..." : "Anchor Receipt to Blockchain"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
