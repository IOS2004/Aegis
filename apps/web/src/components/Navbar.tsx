// SPDX-License-Identifier: MIT
import React from "react";
import { Shield, Activity, Key, RefreshCw, Layers, FileCheck, Play } from "lucide-react";
import { DEMO_ACCOUNTS } from "../lib/config.js";

interface NavbarProps {
  activeTab: "overview" | "feed" | "verify" | "simulator";
  setActiveTab: (tab: "overview" | "feed" | "verify" | "simulator") => void;
  selectedAccountKey: keyof typeof DEMO_ACCOUNTS;
  setSelectedAccountKey: (key: keyof typeof DEMO_ACCOUNTS) => void;
  unanchoredCount: number;
  totalActionsCount: number;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  selectedAccountKey,
  setSelectedAccountKey,
  unanchoredCount,
  totalActionsCount,
  onRefresh,
  isRefreshing,
}) => {
  return (
    <header className="glass-panel" style={{ margin: "1rem 1.5rem", padding: "0.85rem 1.5rem", borderRadius: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div style={{
            width: "38px",
            height: "38px",
            borderRadius: "10px",
            background: "linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 16px rgba(99, 102, 241, 0.4)",
          }}>
            <Shield size={22} color="#ffffff" />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "1.25rem", fontWeight: 800, fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>
                AEGIS
              </span>
              <span style={{ fontSize: "0.65rem", padding: "0.15rem 0.5rem", borderRadius: "9999px", background: "rgba(99, 102, 241, 0.15)", color: "#818cf8", fontWeight: 700, border: "1px solid rgba(99, 102, 241, 0.3)" }}>
                PROTOCOL v1.0
              </span>
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
              Authenticated AI Agent Delegation & Execution Gateway
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav style={{ display: "flex", alignItems: "center", gap: "0.35rem", background: "rgba(0,0,0,0.3)", padding: "0.3rem", borderRadius: "10px", border: "1px solid var(--border-subtle)" }}>
          <button
            onClick={() => setActiveTab("overview")}
            className={`btn btn-sm ${activeTab === "overview" ? "btn-primary" : "btn-secondary"}`}
            style={{ border: "none" }}
          >
            <Layers size={14} />
            Grant Tree & Quotas
          </button>
          <button
            onClick={() => setActiveTab("feed")}
            className={`btn btn-sm ${activeTab === "feed" ? "btn-primary" : "btn-secondary"}`}
            style={{ border: "none", position: "relative" }}
          >
            <Activity size={14} />
            Audit Feed ({totalActionsCount})
            {unanchoredCount > 0 && (
              <span style={{
                position: "absolute",
                top: "-4px",
                right: "-4px",
                width: "16px",
                height: "16px",
                borderRadius: "50%",
                background: "#f59e0b",
                color: "#000",
                fontSize: "0.62rem",
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}>
                {unanchoredCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("verify")}
            className={`btn btn-sm ${activeTab === "verify" ? "btn-primary" : "btn-secondary"}`}
            style={{ border: "none" }}
          >
            <FileCheck size={14} />
            Receipt Verification
          </button>
          <button
            onClick={() => setActiveTab("simulator")}
            className={`btn btn-sm ${activeTab === "simulator" ? "btn-primary" : "btn-secondary"}`}
            style={{ border: "none" }}
          >
            <Play size={14} />
            Action Simulator
          </button>
        </nav>

        {/* Right Section: Node Info, Account Switcher & Refresh */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {/* Node Status */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.35rem 0.75rem", borderRadius: "8px", background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.25)", fontSize: "0.75rem" }}>
            <span className="pulse-dot green" />
            <span style={{ color: "#6ee7b7", fontWeight: 600 }}>Anvil Local (31337)</span>
          </div>

          {/* Account Selector */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "rgba(255, 255, 255, 0.04)", padding: "0.3rem 0.6rem", borderRadius: "8px", border: "1px solid var(--border-subtle)" }}>
            <Key size={14} color="#94a3b8" />
            <select
              value={selectedAccountKey}
              onChange={(e) => setSelectedAccountKey(e.target.value as any)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-main)",
                fontSize: "0.78rem",
                fontWeight: 600,
                outline: "none",
                cursor: "pointer",
              }}
            >
              {Object.entries(DEMO_ACCOUNTS).map(([key, acc]) => (
                <option key={key} value={key} style={{ background: "#0f172a", color: "#f8fafc" }}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>

          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            className="btn btn-secondary btn-sm"
            disabled={isRefreshing}
            title="Refresh on-chain state and audit records"
          >
            <RefreshCw size={13} className={isRefreshing ? "spin-icon" : ""} />
            Sync
          </button>
        </div>
      </div>
    </header>
  );
};
