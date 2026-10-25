# ADR 001: The Role and Boundaries of Blockchain in Aegis

## Status
**Accepted** (Phase 0 Design Baseline — Revised Post Design Review)

## Context & Problem Statement
In *"Position: AI Agents Need Authenticated Delegation"* (ICML 2025), Tobin South et al. outline the urgent need for authenticated and auditable delegation of authority to autonomous AI agents. They propose extending web identity protocols—specifically OAuth 2.0, OpenID Connect (OIDC), and W3C Verifiable Credentials (VCs)—to issue agent identity credentials and delegation tokens.

However, standard web protocols and conventional centralized architectures (e.g., PostgreSQL + Redis + API Gateway) face practical hurdles when coordinating multi-agent systems across untrusted boundaries:
1. **Centralized Identity Bottlenecks & Insider Tampering:** In a conventional database setup, any rogue administrator, SQL injection, or compromised server credential can secretly alter grant permissions or inflate budget allocations (`UPDATE grants SET max_budget = 999999`) without cryptographic detection.
2. **Double-Spending & State Coordination:** W3C Verifiable Credentials allow decentralized off-line verification, but cannot natively prevent **budget double-spending** or concurrent over-allocation across a distributed tree of child agents without a shared, synchronized state layer.
3. **Asset Custody & Hot Wallet Vulnerabilities:** In a conventional architecture, off-chain API gateways must custody the hot wallet private keys to execute transfers. A compromised gateway compromises all funds.
4. **Non-Repudiable Revocation:** Centralized databases allow operators to retroactively alter timestamps or dispute when a revocation occurred.

We must define precisely what role the EVM blockchain plays in Aegis, contrast it with a conventional authorization database, and explicitly define what it **cannot** solve.

## Decision: Dual-Enforcement Architecture with EVM Anchor

We adopt an EVM blockchain (local Anvil chain for development/testing, Ethereum Sepolia for public testnet demonstration) as the **canonical policy registry, atomic budget ledger, and on-chain settlement anchor**, coupled with an off-chain **Execution Gateway** for external tools.

### 1. What the Blockchain Specifically Contributes
1. **Canonical, Multi-Party Grant Registry:** Provides an immutable, globally auditable record of root grants, delegations, public agent keys, and status flags that cannot be quietly tampered with by any single actor or database admin.
2. **Atomic Budget Reservation & Subtree Accounting:** The smart contract (`AegisPolicyManager.sol`) provides ACID guarantees for budget allocation. When a parent delegates to a child, budget is reserved in the exact same transaction, preventing race conditions, double-spending, or over-subscription across concurrent child agents.
3. **Block-Time Cascading Revocation:** By evaluating grant ancestry on-chain, revoking a parent grant invalidates all descendants across the entire network as soon as the transaction is included in a block, with zero reliance on centralized caches.
4. **Direct Smart-Contract Custody (`AgentVault.sol`):** For on-chain assets (mock USDC), custody is held directly by the smart contract. The contract refuses transfers unless valid EIP-712 signatures, unexhausted policy limits, and valid ancestry are verified in the EVM state machine.
5. **Tamper-Evident Receipt Commitments:** Hashes of off-chain execution outcomes can be anchored into transaction logs, proving post-hoc that a recorded execution receipt matches what was attested at block height $H$.

### 2. What Blockchain Does NOT Solve (Explicit Boundaries & Limitations)
> [!WARNING]
> **A blockchain cannot intercept or govern arbitrary off-chain API calls, OS commands, or web requests by itself.**

1. **No External Execution Interception:** If an agent attempts to run a shell command, read a local file, or call a SaaS API (e.g., GitHub, Slack), the blockchain has no native network interception capabilities.
2. **Gateway Dependency for Off-Chain Actions:** Off-chain actions must be mediated by the **Execution Gateway**. The Gateway is therefore part of the Trusted Computing Base (TCB) for external actions. If the Gateway is compromised, offline, or maliciously bypassed, the blockchain cannot stop the external action.
3. **No Veracity Proof of Off-Chain Execution:** An on-chain receipt hash proves that a specific hash was committed at a specific timestamp; it does **not** prove that the underlying external action succeeded honestly or that the AI's reasoning was safe.
4. **No "Zero-Latency" Revocation:** Revocation on a blockchain takes effect only once the transaction is included in a mined block. Transactions in the mempool before block inclusion are subject to standard miner ordering. Furthermore, off-chain tool executions actively in flight on the host operating system cannot be terminated by smart-contract state changes alone.

---

## 3. Comparison: Conventional Baseline vs. Aegis Protocol

| Architectural Property | Conventional Baseline (Postgres + Gateway) | Aegis Protocol (EVM + Gateway) | Concrete Practical Advantage |
|---|---|---|---|
| **Trust Model** | Trust in database admin & server host. | Trust in EVM bytecode execution & agent keys. | Insider tampering impossible on blockchain. |
| **Vault Asset Security** | Gateway holds hot wallet keys; single point of failure. | Smart contract custody; requires direct agent signature and unexpired grant. | Gateway breach does not compromise vault funds. |
| **Revocation Verifiability** | Internal DB flag; unverifiable by external third parties. | Public block-anchored state with emitted events. | Non-repudiable proof of revocation timestamp. |
| **Budget Conservation** | Row-level DB locks; susceptible to deadlocks or code bugs. | EVM transaction atomicity and mathematical conservation. | Formal zero-sum subtree accounting. |
| **Off-Chain Tool Sandboxing** | Relies on Gateway process isolation. | Relies on Gateway process isolation. | **Identical boundary** — blockchain does not solve OS security. |
| **Performance** | Latency $< 5$ms; zero cost. | Block time (~1s-12s); gas fees. | Baseline is faster; Aegis provides trust minimization. |

## Consequences
- **Positive:** Provable security invariants for asset management and quota conservation; clear mathematical proofs against budget overdrawing; transparent auditing.
- **Negative:** Requires gas fees for on-chain state updates (mitigated by using local Anvil / Sepolia and batching/receipt hashing); requires an off-chain Gateway service for non-blockchain interactions.
