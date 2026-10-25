// SPDX-License-Identifier: MIT
import { useState, useEffect, useCallback } from "react";
import { Navbar } from "./components/Navbar.js";
import { GrantTree, type GrantNode } from "./components/GrantTree.js";
import { GrantDetails } from "./components/GrantDetails.js";
import { ActionFeed } from "./components/ActionFeed.js";
import { ReceiptVerification } from "./components/ReceiptVerification.js";
import { ActionSimulator } from "./components/ActionSimulator.js";
import {
  fetchActions,
  fetchUnanchoredActions,
  fetchFullGrantTree,
  seedDemoHierarchy,
  type ActionRecord,
} from "./lib/api.js";
import { DEMO_ACCOUNTS } from "./lib/config.js";
import { Sparkles, Shield, AlertTriangle, Info, CheckCircle2 } from "lucide-react";

export function App() {
  const [activeTab, setActiveTab] = useState<"overview" | "feed" | "verify" | "simulator">("overview");
  const [selectedAccountKey, setSelectedAccountKey] = useState<keyof typeof DEMO_ACCOUNTS>("owner");

  const [grantNodes, setGrantNodes] = useState<GrantNode[]>([]);
  const [selectedGrantId, setSelectedGrantId] = useState<`0x${string}` | null>(null);

  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [unanchoredActions, setUnanchoredActions] = useState<ActionRecord[]>([]);

  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isSeeding, setIsSeeding] = useState<boolean>(false);
  const [bannerNotice, setBannerNotice] = useState<{ message: string; type: "info" | "success" | "warning" } | null>(null);

  // Flattened grants list for simulator and dropdowns
  const flattenGrants = (nodes: GrantNode[]): Array<{ grantId: `0x${string}`; label: string; agent: string; nonce: bigint }> => {
    const list: Array<{ grantId: `0x${string}`; label: string; agent: string; nonce: bigint }> = [];
    const traverse = (node: GrantNode) => {
      list.push({
        grantId: node.grantId,
        label: `${node.label} (${node.role})`,
        agent: node.grant.agent,
        nonce: node.grant.nonce,
      });
      for (const child of node.children) {
        traverse(child);
      }
    };
    for (const root of nodes) {
      traverse(root);
    }
    return list;
  };

  const flattenedGrantsList = flattenGrants(grantNodes);

  // Find currently selected node in tree
  const findSelectedNode = (nodes: GrantNode[], targetId: string | null): GrantNode | null => {
    if (!targetId) return nodes[0] || null;
    for (const n of nodes) {
      if (n.grantId.toLowerCase() === targetId.toLowerCase()) return n;
      const found = findSelectedNode(n.children, targetId);
      if (found) return found;
    }
    return null;
  };

  const selectedNode = findSelectedNode(grantNodes, selectedGrantId);

  // Refresh all state from gateway and blockchain
  const loadData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    try {
      // 1. Load on-chain grant tree
      const tree = await fetchFullGrantTree();
      setGrantNodes(tree);

      if (tree.length > 0 && !selectedGrantId) {
        setSelectedGrantId(tree[0].grantId);
      }

      // 2. Load audit actions from gateway
      try {
        const [allActs, unanchored] = await Promise.all([
          fetchActions(),
          fetchUnanchoredActions(),
        ]);
        setActions(allActs);
        setUnanchoredActions(unanchored);
      } catch (e) {
        console.warn("Gateway /actions unreachable (gateway may not be running yet):", e);
      }
    } catch (err: any) {
      console.error("Failed to load on-chain state:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedGrantId]);

  useEffect(() => {
    loadData();
    // 10s background poll
    const interval = setInterval(() => {
      loadData(false);
    }, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleSeedDemo = async () => {
    setIsSeeding(true);
    setBannerNotice(null);
    try {
      const grantIds = await seedDemoHierarchy();
      setBannerNotice({
        message: `Successfully created demo delegation tree: Root (G0), Child (G1), and Sub-Child (G2) on-chain!`,
        type: "success",
      });
      await loadData();
      if (grantIds[0]) {
        setSelectedGrantId(grantIds[0] as `0x${string}`);
      }
    } catch (err: any) {
      setBannerNotice({
        message: `Seeding failed: ${err.message}`,
        type: "warning",
      });
    } finally {
      setIsSeeding(false);
    }
  };

  const activeAccount = DEMO_ACCOUNTS[selectedAccountKey];

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Top Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedAccountKey={selectedAccountKey}
        setSelectedAccountKey={setSelectedAccountKey}
        unanchoredCount={unanchoredActions.length}
        totalActionsCount={actions.length}
        onRefresh={() => loadData(true)}
        isRefreshing={isRefreshing}
      />

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: "0 1.5rem 2rem", maxWidth: "1600px", margin: "0 auto", width: "100%" }}>
        {/* Banner Notice */}
        {bannerNotice && (
          <div
            style={{
              marginBottom: "1rem",
              padding: "0.75rem 1.25rem",
              borderRadius: "10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background:
                bannerNotice.type === "success"
                  ? "rgba(16, 185, 129, 0.15)"
                  : bannerNotice.type === "warning"
                  ? "rgba(245, 158, 11, 0.15)"
                  : "rgba(99, 102, 241, 0.15)",
              border: `1px solid ${
                bannerNotice.type === "success"
                  ? "rgba(16, 185, 129, 0.4)"
                  : bannerNotice.type === "warning"
                  ? "rgba(245, 158, 11, 0.4)"
                  : "rgba(99, 102, 241, 0.4)"
              }`,
              color:
                bannerNotice.type === "success"
                  ? "#6ee7b7"
                  : bannerNotice.type === "warning"
                  ? "#fcd34d"
                  : "#a5b4fc",
              fontSize: "0.82rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              {bannerNotice.type === "success" && <CheckCircle2 size={16} />}
              {bannerNotice.type === "warning" && <AlertTriangle size={16} />}
              {bannerNotice.type === "info" && <Info size={16} />}
              <span>{bannerNotice.message}</span>
            </div>
            <button
              onClick={() => setBannerNotice(null)}
              style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", fontSize: "1rem" }}
            >
              ×
            </button>
          </div>
        )}

        {/* Tab 1: Overview (Tree & Quotas) */}
        {activeTab === "overview" && (
          <div>
            {/* Quick Action Bar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
              <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                Active Operator: <strong style={{ color: "var(--text-main)" }}>{activeAccount.name}</strong> ({activeAccount.role})
              </div>
              <button
                id="btn-seed-hierarchy"
                onClick={handleSeedDemo}
                disabled={isSeeding}
                className="btn btn-primary btn-sm"
              >
                <Sparkles size={14} />
                {isSeeding ? "Deploying on-chain..." : "Seed 3-Tier Demo Hierarchy (G0 → G1 → G2)"}
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(350px, 1.25fr) minmax(320px, 1fr)", gap: "1.5rem" }}>
              {/* Left Column: Grant Tree */}
              <div>
                <GrantTree
                  nodes={grantNodes}
                  selectedGrantId={selectedGrantId}
                  onSelectGrant={(id) => setSelectedGrantId(id)}
                />
              </div>

              {/* Right Column: Grant Live Quotas & Controls */}
              <div>
                <GrantDetails
                  selectedNode={selectedNode}
                  callerPrivateKey={activeAccount.privateKey}
                  onActionComplete={() => loadData(true)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Action Feed & Audit Trail */}
        {activeTab === "feed" && (
          <ActionFeed
            actions={actions}
            onRefresh={() => loadData(true)}
          />
        )}

        {/* Tab 3: Receipt Verification */}
        {activeTab === "verify" && (
          <ReceiptVerification
            recentActions={actions}
          />
        )}

        {/* Tab 4: Deterministic Action Simulator */}
        {activeTab === "simulator" && (
          <ActionSimulator
            grantsList={flattenedGrantsList}
            onActionComplete={() => loadData(true)}
          />
        )}
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: "1px solid var(--border-subtle)",
          padding: "1rem 1.5rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.75rem",
          fontSize: "0.72rem",
          color: "var(--text-dim)",
          background: "rgba(4, 7, 13, 0.4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Shield size={14} color="#6366f1" />
          <span>Aegis Protocol — Cryptographic Delegation & Verification Framework for Autonomous Agents</span>
        </div>
        <div>
          <span>ICML 2025 Architecture • EIP-712 Typed Data • Immutable On-Chain Receipt Anchors</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
