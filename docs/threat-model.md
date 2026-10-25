
# Aegis: Threat Model and Security Analysis

## 1. Assets to Protect & Security Objectives

| Asset | Description | Primary Security Objective |
|---|---|---|
| **Vault Assets** | Test ERC-20 tokens (`MockUSDC`) deposited in `AgentVault`. | **Solvency & Authorization:** Zero unapproved movement. Every transfer requires a valid, unexpired, unrevoked grant with unexhausted budget. |
| **Sandbox Environment** | Host filesystem and local Git repository. | **Containment & Integrity:** No execution outside allowlisted commands and designated sandbox subdirectories. No path traversal or arbitrary shell execution. |
| **Policy State & Lineage** | The delegation tree, permissions, limits, and revocation records stored in `AegisPolicyManager`. | **Tamper-Resistance & Monotonic Attenuation:** Child grants cannot expand authority beyond parents; revocations cannot be un-done. |
| **Budget Quotas** | Maximum aggregate budget and reserved child budget across grant subtrees. | **Conservation & No Overdraft:** $\sum \text{spent} + \sum \text{reserved} \le \text{maxTotalBudget}$ across any subtree at all times. |
| **Audit Trails & Receipts** | Historical record of decisions, actions, parameters, and results. | **Verifiability & Non-Repudiation:** Cryptographic receipts anchored on-chain; private prompts and sensitive payload data kept off-chain. |

---

## 2. Threat Actors & Attacker Capabilities

1. **Malicious / Compromised Agent (Attacker A1):**
   - Holds an authentic agent signing key.
   - Actively crafts hostile action requests: calls tools outside its bitmask, attempts to transfer amounts exceeding `maxPerAction`, or attempts to drain remaining budget beyond `maxTotalBudget`.
2. **Prompt-Injected / Jailbroken LLM (Attacker A2):**
   - The LLM has been tricked via adversarial prompt injection into outputting malicious JSON structures, path traversal strings (e.g., `../../etc/passwd`), shell commands (`rm -rf /`), or malformed arguments.
3. **Privilege-Escalating Child Agent (Attacker A3):**
   - A child agent attempting to issue sub-grants with broader tool bitmasks, longer validity periods, or budgets exceeding its own allocation.
4. **Network Interceptor / Replay Attacker (Attacker A4):**
   - Intercepts legitimate signed action requests in transit and attempts to replay them across sessions, contracts, or different chains.
5. **Rogue / Stale Subtree (Attacker A5):**
   - An agent whose ancestor grant has been revoked or expired attempting to execute actions by presenting only its own unrevoked child grant ID.
6. **Compromised Gateway / Rogue Database Admin (Attacker A6):**
   - An attacker with administrative access to the off-chain Gateway server or local SQLite database attempting to alter budget records, forge grants, or steal vault assets.

---

## 3. Threat Analysis & Mitigation Matrix

| Threat ID | Threat Description | Attack Vector | Mitigation in Aegis | Enforcement Layer |
|---|---|---|---|---|
| **T-01** | **Direct Vault Draining** | Attacker calls `AgentVault.executeTransfer()` directly without holding a valid grant. | `AgentVault` verifies EIP-712 typed signature from `grant.agent`, checks `TOOL_VAULT_TRANSFER`, per-action limit, and deducts budget in `AegisPolicyManager`. Reverts on unauthorized access. | On-Chain Contract |
| **T-02** | **Tool Scope Escalation** | Agent granted `read_project_status` attempts to call `create_sandbox_branch` or `vault_transfer`. | Bitmask verification: `(requestedTool & grant.allowedTools) != 0`. Evaluated both at Gateway and in contracts. | Gateway & Contract |
| **T-03** | **Child Scope Escalation** | Parent delegates to child with tool bits not held by parent. | Attenuation check in `delegateGrant()`: `(childTools & ~parentTools) == 0`. Reverts if child has any bit not present in parent. | On-Chain Contract |
| **T-04** | **Temporal Extension** | Child grant created with `expiresAt > parent.expiresAt`, or expired grant used. | Temporal attenuation check: `childExpiresAt <= parentExpiresAt`. At authorization time: `block.timestamp <= grant.expiresAt`. | On-Chain Contract |
| **T-05** | **Per-Action Limit Bypass** | Agent attempts action with cost exceeding `grant.maxPerAction`. | Explicit check: `cost <= grant.maxPerAction`. Fails immediately if exceeded. | On-Chain Contract |
| **T-06** | **Budget Oversubscription & Double-Count on Revocation** | Parent delegates more than available capacity, or nested revocation corrupts upstream reserve accounting. | **Conservation of Budget:** $C.\text{maxTotalBudget} \le P.\text{available}$. On nested revocation of $C$, unspent budget is returned **strictly to immediate parent $P$** ($R(P) \leftarrow R(P) - \text{unspent}$), preserving ancestor invariants without double-counting. | On-Chain Contract |
| **T-07** | **Subtree Double Spending** | Child spends funds while parent concurrently spends remainder. | Atomically tracked state on-chain: child spend increments `spent` on child and all ancestors, while decrementing parent's `reservedChildBudget`. | On-Chain Contract |
| **T-08** | **Replay & Cross-Domain Attacks** | Intercepted signature replayed on another chain, contract, or re-submitted after execution. | **EIP-712 Domain Separation & Sequential Nonces:** Signature binds `chainId`, `verifyingContract`, and sequential `nonce`. Nonce increments upon authorization; expired `deadline` rejects stale submissions. | On-Chain & Gateway |
| **T-09** | **Ancestor Revocation Evasion** | Grandchild attempts action after Root or Parent is revoked. | **Full Ancestry Verification:** Authorization algorithm walks `parentGrantId` up to the root. If ANY node in the ancestry has `revoked == true`, execution is rejected at block confirmation. (Mempool races resolved by validator block ordering). | On-Chain & Gateway |
| **T-10** | **Path Traversal / Sandbox Escape** | Prompt-injected agent submits filename `../../../../app/server.key` or symlinks. | Application-level confinement: realpath canonicalization ensures files are strictly contained in `<sandbox_root>/demo/`, rejecting relative traversals and external symlinks. | Execution Gateway (App-level) |
| **T-11** | **Arbitrary Shell Execution** | Agent passes command-line options containing semicolons, pipes, or backticks to tools. | Direct binary execution via `execFile` without shell interpretation (`shell: false`). Branch names strictly match regex `^[a-zA-Z0-9][a-zA-Z0-9_\-\/]*[a-zA-Z0-9]$` and ban leading hyphens (`-`). | Execution Gateway (App-level) |
| **T-12** | **Crash Desynchronization & Retry Reconciliation** | Gateway or host crashes after consuming budget on-chain but before completing the tool. | Conservative failure handling: budget is pre-consumed before tool execution. SQLite marks action `FAILED`. Replaying the same nonce fails on-chain (`InvalidNonce`), preventing duplicate side effects. The agent recovers by submitting a new request with advanced nonce. | Gateway / SQLite |
| **T-13** | **Signature / Identity Forgery** | Attacker signs request with a random private key. | EIP-712 recovery (`ECDSA.recover(digest, signature)`): recovered address must strictly match `grant.agent`. | Gateway & Contract |
| **T-14** | **Sensitive Data Leakage** | Raw prompts, proprietary code, or keys written to blockchain events. | Privacy-preserving audit: Only hashes (`keccak256(receiptData)`) and structured identifiers are written on-chain. Prompts and raw execution outputs stay in off-chain SQLite logs. | Gateway / Contract |
| **T-15** | **Expired Budget Capital Lock** | Child grant expires with unused budget, locking parent's reserve indefinitely. | **Explicit Expired Reclamation:** Anyone can call `reclaimExpiredBudget(childGrantId)` after `block.timestamp > expiresAt` to return unspent budget to the parent. | On-Chain Contract |
| **T-16** | **Compromised Gateway Database Tampering** | Attacker alters database records to increase agent budget or forge grants. | The smart contract holds the canonical source of truth. Any modified local records that disagree with the EVM state machine fail during on-chain verification or reconciliation. | On-Chain Contract |
| **T-17** | **Receipt Anchoring Interruption** | Host tool execution succeeds, but on-chain receipt anchoring fails due to network outage or RPC timeout. | Recoverable `UNANCHORED` state: execution evidence (`resultHash`, output summary) is permanently persisted in SQLite. The action can be anchored on-chain via `POST /actions/:actionId/retry-receipt` without re-executing the tool. | Execution Gateway & Contract |
| **T-18** | **Audit Trail Tampering & Conflicting Receipts** | Attacker attempts to overwrite historical audit logs or submit conflicting receipts for an action. | Dual-table architecture separates current state (`actions`) from append-only events (`audit_events`). Duplicate receipt submissions are idempotent; conflicting receipts or requests are rejected with HTTP 409 (`ERR_CONFLICTING_RECEIPT`). | SQLite Audit Store |

---

## 4. Formal Security Invariants

The Aegis system guarantees the following 12 foundational invariants across all operations:

1. **Active Grant Invariant:** An action can be executed under grant $G$ only if $G$ exists, `revoked == false`, and $\text{now} \le \text{expiresAt}$.
2. **Active Ancestry Invariant:** For every ancestor $A \in \text{ancestry}(G)$, $A$ must exist, $A.\text{revoked} == \text{false}$, and $\text{now} \le A.\text{expiresAt}$.
3. **Tool Scope Attenuation Invariant:** For every child grant $C$ of parent $P$, $C.\text{allowedTools} \subseteq P.\text{allowedTools}$, evaluated as:
   $$(C.\text{allowedTools} \ \& \ \sim P.\text{allowedTools}) == 0$$
4. **Temporal Attenuation Invariant:** For every child grant $C$ of parent $P$, $C.\text{expiresAt} \le P.\text{expiresAt}$.
5. **Per-Action Cap Invariant:** For every child grant $C$ of parent $P$, $C.\text{maxPerAction} \le P.\text{maxPerAction}$, and every action cost $c$ satisfies $c \le G.\text{maxPerAction}$.
6. **Budget Allocation Non-Oversubscription:** For any parent grant $P$, the sum of budgets granted to active children cannot exceed $P$'s unspent and unreserved capacity:
   $$C.\text{maxTotalBudget} \le P.\text{maxTotalBudget} - P.\text{spent} - P.\text{reservedChildBudget}$$
7. **Subtree Budget Ceiling:** The cumulative spending of grant $G$ plus all its descendants cannot exceed $G.\text{maxTotalBudget}$.
8. **Budget Conservation Invariant:** At every node $k$ in the delegation tree at all times:
   $$k.\text{spent} + k.\text{reservedChildBudget} + k.\text{availableBudget} = k.\text{maxTotalBudget}$$
   with $k.\text{spent} + k.\text{reservedChildBudget} \le k.\text{maxTotalBudget}$.
9. **Replay & Domain Separation Freedom:** Every executed action consumes a unique sequential nonce bound to the grant and is signed using EIP-712 with chain ID and verifying contract.
10. **Cascading Revocation Invariant:** Once `revokeGrant(P)` is confirmed on-chain, no action under any descendant $D$ of $P$ can be authorized or executed.
11. **Smart-Contract Enforced Custody:** No test tokens can be transferred out of `AgentVault` by any off-chain entity or gateway unless validated directly by smart-contract code against `AegisPolicyManager`.
12. **Authorization-Precedes-Side-Effect:** No external or internal protected action can execute if authorization verification fails.

---

## 5. Security Assumptions & Residual Risks

### 5.1 Security Assumptions
1. **Host Security of Execution Gateway:** The Gateway server is assumed not to have root/OS-level malware that would tamper with the Node.js memory space or bypass the `ToolRunner` sandboxing logic.
2. **Standard Cryptographic Primitives:** Secp256k1 ECDSA and Keccak-256 are computationally secure.
3. **EVM Finality:** On local Anvil chains and Sepolia testnet, transactions finalized in blocks cannot be reorganized without consensus failure.

### 5.2 Residual Risks & Intentional MVP Limitations
1. **Application-Level vs. OS-Level Sandbox Boundary:** The prototype enforces path confinement, symlink defense, and shell execution prevention strictly at the *application level* (Node.js runtime). It does **not** implement kernel-level OS namespaces (e.g., Linux `cgroups`, `unshare`, or Windows Job Objects). A binary zero-day in `git.exe` or `node.exe` could execute with the permissions of the Gateway host user. In production, tools should be isolated in rootless containers or gVisor sandboxes.
2. **No Automatic Budget Refunds on Tool Failure:** If a sandboxed tool crashes halfway through execution, the pre-consumed budget is not automatically refunded to the agent. This design is chosen intentionally to avoid complex reentrancy and refund exploitation loops.
3. **Mempool Inclusion Race:** Revocation takes effect upon block inclusion. Pending unconfirmed transactions in the mempool may still be included prior to the revocation transaction if higher gas priority is paid.
