# AEGIS
## Implementation Brief for an AI Coding Agent

**Project type:** Blockchain / security / autonomous-agent course project  
**Status:** Proposed specification — implement incrementally  
**Deployment target:** Local EVM chain first; public testnet for final demonstration  
**Primary objective:** Demonstrate bounded, revocable, auditable delegation of authority to AI agents.

---

## 1. Executive summary

Aegis is a prototype authorization protocol for AI agents that can perform actions on behalf of a human or organization. The user grants an agent a bounded set of permissions. The agent may delegate a narrower subset to another agent. Aegis checks the permissions before protected actions, tracks budgets and nonces, supports revocation, and produces verifiable records of authorization decisions and execution receipts.

**Core principle:** the AI proposes actions; Aegis governs which actions are authorized. Do not trust the model's own reasoning as the security boundary.

The project should use blockchain where it provides a concrete property: shared, independently verifiable permission state and contract-enforced constraints for EVM-controlled assets/actions. External actions, such as modifying a Git repository or calling a SaaS API, still require an execution gateway or target service to enforce policy. A blockchain cannot intercept arbitrary off-chain calls by itself. State this limitation clearly in the UI, report, and demo.

### Project research question

Can a prototype enforce bounded, revocable, attenuated delegation across a small hierarchy of AI agents, while making authorization state and selected action receipts independently auditable?

### Intended contribution

An implemented and tested design combining:
- Scoped agent grants with expiry and revocation.
- Delegation attenuation: children may not receive broader authority than their parents.
- Per-action and aggregate budget limits with safe accounting across a delegation tree.
- Replay-resistant action requests.
- An execution gateway for a constrained set of external tools.
- On-chain enforcement for a test token / vault operation, plus auditable receipt hashes for selected off-chain actions.
- An adversarial test harness that attempts to exceed permissions and measures what the system rejects.

Do not claim that the idea of authenticated delegation itself is new. The contribution is the concrete prototype, its security model, its blockchain integration, and empirical evaluation.

---

## 2. Research foundation: paper to read

**Tobin South et al., “Position: AI Agents Need Authenticated Delegation,” Proceedings of the 42nd International Conference on Machine Learning (ICML), PMLR 267, 2025.**

- Paper page: https://proceedings.mlr.press/v267/south25a.html
- PDF: https://raw.githubusercontent.com/mlresearch/v267/main/assets/south25a/south25a.pdf

Read this paper before finalizing architecture. Use it to understand the motivation for authenticated and auditable delegation, agent identity, scoping permissions, and chains of accountability. The paper discusses extending existing authentication and authorization infrastructure, including OAuth 2.0 and OpenID Connect.

**Important interpretation:** this is a *position paper and design roadmap*, not a specification for Aegis and not a paper proposing our exact blockchain architecture. Do not attribute blockchain choices or implementation details to the authors. Aegis is our proposed implementation direction, and should explain why on-chain policy state and smart-contract-enforced actions are useful in the chosen multi-party / independently auditable setting.

When writing the report, distinguish clearly between: (1) what the paper argues, (2) what existing standards provide, and (3) what Aegis implements and evaluates.

---

## 3. Scope and non-goals

### In scope for the MVP

1. A human owner creates a root grant for a registered agent.
2. A grant specifies tool/action scope, expiry, per-action limit, total budget and delegation rules.
3. A parent agent delegates a narrower grant to a child agent.
4. Every protected action is authorized before execution.
5. Permissions can be revoked; future protected actions are rejected after revocation takes effect.
6. Nonces prevent replay of signed action requests.
7. An on-chain vault/test-token operation demonstrates direct smart-contract enforcement.
8. A local execution gateway offers a small allowlist of harmless sandbox tools.
9. The UI presents grant ancestry, policy, spending/budget state, attempts, outcomes and transaction links.
10. Tests demonstrate both valid actions and hostile/invalid requests.

### Explicit non-goals for the MVP

- Do not create a new blockchain, consensus protocol, tokenomics system, DAO, or generic chain.
- Do not build a general-purpose autonomous agent platform.
- Do not execute arbitrary shell commands, arbitrary code, or arbitrary URLs from the agent.
- Do not put secrets, prompts, private user data, or raw sensitive payloads on-chain.
- Do not deploy to mainnet or use real funds.
- Do not claim blockchain can prove an off-chain action actually occurred or that an AI's reasoning was safe.
- Do not build a custom cryptographic proof system. Use standard libraries and existing primitives.
- Do not require a paid LLM API for the MVP. A deterministic mock agent must support reproducible tests.

---

## 4. Core demonstration scenario

Build a deliberately constrained software-maintenance scenario:

- **Owner:** creates a grant for Agent A.
- **Agent A:** can run tests and create a branch in a temporary local Git repository; it also receives limited test-token spending authority.
- **Agent B (child):** Agent A delegates only a subset of Agent A's permitted tools and budget.
- **Gateway:** exposes a fixed allowlist of sandbox actions and checks permissions before execution.
- **Attacker/test harness:** attempts an oversized token transfer, an unapproved tool, an expired grant, a replayed request, a privilege-escalating delegation, and use of a revoked grant.

The final demo should show at least:
1. An authorized action succeeds.
2. A transaction above the per-action cap fails.
3. A child cannot expand its parent's scope or expiry.
4. Replaying the same action request is rejected.
5. Revoking a grant blocks later actions that depend on it.
6. A permitted sandbox tool action executes and has a receipt / hash recorded.
7. The dashboard shows why a request was allowed or denied and links to on-chain evidence where available.

Use deterministic fixtures so every scenario can be repeated reliably.

---

## 5. Architecture

### A. On-chain contracts

Use Solidity contracts on an EVM-compatible chain. Keep the MVP small and auditable; the contracts are not intended to support every possible permission model.

**Suggested contracts:**

- `AegisPolicyManager`: creates and stores grants; checks tool scope, grant ancestry, expiry, revocation, nonce and budget conditions; handles delegation and budget accounting; emits policy and authorization events.
- `AgentVault`: holds a mock ERC-20 test token and executes only explicitly authorized transfers through contract-enforced checks. Do not fund this with real assets.
- `MockUSDC` or `MockToken`: a local test token with no real value, clearly labeled as a mock.

These can be combined if it improves simplicity. Keep interfaces and invariants clear before choosing contract boundaries.

**Minimum grant fields:**
- Unique grant ID.
- Parent grant ID (zero / sentinel for root grant).
- Agent address (public identifier for the signing key).
- Allowed tool/action scope (e.g., a bitmask of known tool IDs).
- Expiration timestamp.
- Maximum per-action cost / units.
- Maximum aggregate budget.
- Amount already consumed and any amount reserved for child grants.
- Nonce or replay-protection state.
- Revocation state / policy version.

Do not store an arbitrary natural-language policy as the authoritative security rule. The UI may accept a natural-language request, but a deterministic, reviewable, structured scope must be displayed and approved before it becomes active.

### B. Execution gateway (off-chain)

Implement a small TypeScript service that accepts signed action requests, validates their structure, consults canonical policy state, invokes the appropriate protected adapter, and records execution outcomes.

MVP allowlisted tools should be harmless and deterministic, for example:
- `read_project_status`
- `run_test_suite` (against a fixed temporary repository)
- `create_sandbox_branch`
- `write_demo_file` (only within a temporary sandbox directory)

Reject unknown tool names, arbitrary paths, arbitrary URLs, and arbitrary command strings. Validate every input against a schema. The model must not receive blockchain private keys, gateway secrets, or direct unrestricted tool credentials.

For external/off-chain actions, the gateway is part of the trusted computing base. Document that a compromised gateway could bypass its own off-chain checks if it retains unrestricted access to a downstream service. The MVP demonstrates a controlled enforcement boundary, not a universal trustless API firewall.

### C. Agent adapter

Create an `AgentAdapter` interface with:
- `MockAgentAdapter`: default, deterministic and used by tests/demo.
- `LLMAgentAdapter`: optional extension, behind configuration, with no extra authority beyond the gateway's narrow tool interface.

The model proposes a structured action. The gateway—not the model—does all policy enforcement. Never ask the LLM to decide whether its own action is authorized.

### D. Receipt and audit layer

Each request should receive an `actionId` and have a traceable lifecycle: requested, authorized/consumed, executed, failed, or denied. Store detailed non-sensitive records off-chain (SQLite for MVP). Emit on-chain events for grant changes, budget consumption associated with protected actions, revocation and receipt hashes where practical.

A receipt hash proves that a later record matches the committed hash; it does not prove the underlying off-chain claim is true. Avoid placing raw inputs, private prompts, repository contents or API secrets on-chain. Define exactly what each event attests to and who submits it.

### E. Frontend

React + TypeScript dashboard that can:
- Create/revoke a root grant.
- View agent IDs and parent-child delegation tree.
- Show scope, expiry, per-action limit, total budget, spent amount and remaining budget.
- Submit pre-scripted safe demo actions.
- Display allow/deny outcomes with clear reason codes.
- Browse audit events and open transaction links on the selected network's explorer.

The frontend must not be the security boundary; contracts and gateway enforce the rules.

### Request flow

1. The agent proposes a structured action and signs the request using an agent key, or the mock adapter supplies a deterministic identity for test scenarios.
2. Gateway validates schema, signature, nonce, and expected action format.
3. For on-chain asset actions, the smart contract independently checks policy and limits before moving the mock token.
4. For off-chain sandbox actions, the gateway checks the latest grant and ancestry, performs a pre-execution authorization/consumption step according to the finalized design, then invokes only the allowlisted tool.
5. The action result is recorded off-chain; an associated receipt hash / event is written on-chain where appropriate.
6. UI shows the decision, action outcome, authorization context and evidence.

Because an external API action and an on-chain transaction cannot be made atomically in the general case, design for crash/failure behavior explicitly. Prefer conservative budget consumption before performing a protected external action over performing the action first and only then checking authorization. Document any unused-budget/refund limitations in the MVP.

---

## 6. Permission and budget rules

Implement a deliberately small policy model. Suggested fields:

- `allowedTools`: set/bitmask of supported action types.
- `expiresAt`: grant expiry.
- `maxPerAction`: highest permitted cost/unit count for one action.
- `maxTotalBudget`: maximum aggregate budget for the grant's subtree.
- `spent`: aggregate consumed amount (including descendants, if the budget model defines it that way).
- `reservedChildBudget`: unspent budget allocated to child grants.
- `parentGrantId`, `agentAddress`, `revoked`, `nonce`.

**Required invariants:**

1. Grant must exist, be active, and be unexpired.
2. Every ancestor in the delegation chain must be active and unexpired.
3. Child tool scope must be a subset of parent tool scope.
4. Child expiry must be no later than parent expiry.
5. Child per-action cap must not exceed the parent's applicable cap.
6. A child budget must be reserved from the parent's available delegation budget; concurrent child grants must not oversubscribe it.
7. Every charge must respect the per-action and aggregate subtree limit.
8. Budget accounting across a delegation chain must be consistent, including descendants spending budget, child revocation, expiry and unused reserved allocation. Specify whether the MVP releases unused child budget automatically; do not leave this ambiguous.
9. Every signed request has a unique nonce or action ID; duplicate/replayed requests are rejected.
10. Revocation must invalidate descendant grants for future protected operations, either by checking ancestry or by a clearly specified version/epoch scheme.
11. Every protected token transfer is enforced by the contract itself, not only by a frontend check.
12. Failed authorization must not perform the protected side effect.

**Before implementation:** write the budget accounting model as pseudocode and cover it with tests. Avoid a naive approach where every child gets an independent budget that can collectively exceed the parent's cap.

---

## 7. Recommended technology stack

| Layer | Recommended choice | Reason |
|---|---|---|
| Smart contracts | Solidity | EVM ecosystem and broad tooling |
| Contract development/tests | Foundry (`forge`, `cast`, `anvil`) | Fast local chain, unit/fuzz/invariant tests |
| Contract libraries | OpenZeppelin Contracts | Established implementations for common ERC-20 and access-control primitives; still review and test integration |
| Local blockchain | Anvil | Repeatable tests without money or public network dependencies |
| Final demo network | Ethereum Sepolia | Public EVM testnet with inspectable transactions; use only test assets |
| Frontend | React + TypeScript + Vite | Clear dashboard with typed UI |
| Chain interaction | `viem`; optionally `wagmi` for wallet/connectivity hooks | Type-safe client and wallet integration |
| Gateway/backend | Node.js + TypeScript + Fastify (or Express if already familiar) | Small API and typed request validation |
| Input validation | Zod | Validate incoming action schemas at runtime |
| Off-chain audit store | SQLite | Simple local setup for a course project; store no secrets |
| Frontend/backend tests | Vitest; Playwright for a minimal UI flow if time allows | Reproducible regression testing |
| Contract analysis | Foundry fuzz/invariant tests; Slither as an optional static-analysis tool | Check attack cases and common contract risks |
| AI provider | None required for MVP; deterministic mock first | Reproducibility and no mandatory API cost |
| Package manager | pnpm workspace or npm workspaces | Monorepo management; choose one and document it |

Avoid adding a database server, Kubernetes, an indexer, account-abstraction integration, a custom chain, or a zero-knowledge system unless the core MVP is finished and the extension has a clear research justification. ERC-7715 / ERC-4337 may be discussed as related ecosystem standards or explored as a stretch goal; do not make them prerequisites for the MVP.

---

## 8. Suggested repository structure

```text
aegis/
  contracts/       # Foundry contracts, tests and deployment scripts
  apps/web/        # React + TypeScript + Vite dashboard
  apps/gateway/    # TypeScript API and controlled tool sandbox
  packages/shared/ # Schemas, types, action IDs and hash utilities
  docs/            # Architecture, threat model, permission model, ADRs, demo script
  scripts/         # Safe setup, deploy and test helpers
  .env.example     # Variable names only; no secret values
  README.md
```

If the repository already contains work, inspect it first. Do not delete, rewrite or reinitialize existing code without explaining the impact. Make small, reviewable changes.

---

## 9. Development lifecycle and milestones

### Phase 0 — Repository reconnaissance and design

- Inspect repository, environment, package managers and existing code.
- Read the paper in Section 2.
- Create `docs/architecture.md`, `docs/threat-model.md`, `docs/permission-model.md`, and a short ADR for the blockchain role.
- Write the security invariants and budget accounting pseudocode before writing contracts.
- Identify which actions are enforced on-chain versus enforced by the gateway.

**Exit criteria:** an agreed architecture, explicit trust boundaries, no ambiguous budget/revocation semantics.

### Phase 1 — Local smart-contract core

- Set up Foundry and Anvil.
- Implement grant creation, delegation, scope attenuation, expiry, revocation, nonce checking and budget accounting.
- Implement the mock ERC-20 and AgentVault transfer flow.
- Emit meaningful events without exposing sensitive payloads.
- Add unit tests, fuzz tests and invariant tests.

**Exit criteria:** contract tests prove every invariant in Section 6; no frontend required yet.

### Phase 2 — Gateway and deterministic agent

- Create typed request/response schemas and stable error codes.
- Implement agent request signing / identity checking and replay protection.
- Implement allowlisted sandbox actions; never expose arbitrary shell or network access.
- Connect gateway authorization to the local contracts.
- Record outcomes and receipt hashes; document the external-action trust boundary and crash behavior.

**Exit criteria:** scripted end-to-end scenarios pass locally, including hostile attempts.

### Phase 3 — Dashboard

- Show grants and the parent-child delegation tree.
- Create/revoke grants through wallet transactions.
- Show current budget and policy state, action history, clear denial reasons, and transaction links.
- Make network and test-token state unmistakable.

**Exit criteria:** a reviewer can operate the demonstration and understand why each action was allowed or denied.

### Phase 4 — Security hardening and evaluation

- Run contract unit, fuzz and invariant suites.
- Test concurrent requests, stale policy reads, replay, expired/revoked ancestry, over-budget grants and malicious child grants.
- Run static analysis and review its findings.
- Compare baseline vs. Aegis behavior in a reproducible attack matrix.
- Report gas usage and gateway latency; distinguish local-chain results from public-testnet results.

**Exit criteria:** tests and results can be reproduced using documented commands; all known limitations are listed.

### Phase 5 — Public testnet demonstration

- Deploy only after local tests pass.
- Use Sepolia test ETH and mock tokens only; never request real funds.
- Read deployment secrets from local environment variables; never commit them.
- Confirm contract addresses and network IDs in the UI.
- Provide explorer links only after deployment has actually succeeded.

**Exit criteria:** working demo or, if faucet/RPC availability blocks deployment, a complete local demo plus transparent explanation. Do not falsely claim public deployment.

### Phase 6 — Report and handoff

- Document architecture, design decisions, threat model, tests, experiment results and limitations.
- Include a five-minute demo script with expected outcomes.
- Provide setup commands, `.env.example`, deployment instructions and test commands.
- Add a short “what blockchain contributes / what it does not solve” section.

---

## 10. Testing and evaluation plan

Build a table-driven attack suite. Each case should include preconditions, attempted action, expected contract/gateway behavior and observed result.

Required cases:
- Valid action within scope and budget.
- Unknown tool / action outside scope.
- Per-action limit exceeded.
- Aggregate budget exceeded across multiple child agents.
- Attempt to create a child with broader tool scope.
- Attempt to create a child with a later expiration.
- Concurrent grant allocations that would oversubscribe parent budget.
- Expired grant and expired ancestor.
- Revoked grant and revoked ancestor.
- Replayed signature / nonce.
- Malformed signature or wrong signing agent.
- Gateway crashes after permission consumption but before the tool finishes.
- Tool fails after authorization; ensure the state is recorded and budget behavior follows the documented rule.
- Attempt to use unapproved filesystem path, arbitrary shell input or arbitrary URL.
- Attempt to call the mock token/vault without authorization.

Measure:
- Attack success / rejection rate for the defined attack suite.
- False rejections for valid scripted actions.
- Contract gas for grant, delegate, revoke and protected transfer operations.
- Local gateway decision latency.
- Cost/latency trade-offs when recording on-chain receipts.
- Complexity or overhead as delegation depth and agent count grow within the test bounds.

Do not present a small synthetic benchmark as proof of universal security. Describe test cases, environment, limits and reproducibility.

---

## 11. Acceptance criteria

The MVP is complete only when:

- The repository starts from documented instructions on a fresh local environment.
- `forge test` passes, including fuzz/property tests for core invariants.
- The gateway and UI can be run locally with a deterministic mock agent.
- Authorized and adversarial demo scenarios are repeatable.
- The contracts—not just UI code—enforce the protected token transfer constraints.
- Child grants cannot escalate scope, expiry or aggregate budget.
- Revocation and nonce/replay behavior are tested.
- Every external tool is allowlisted and sandboxed; no arbitrary code execution is exposed.
- The report accurately identifies the gateway as a trusted component for off-chain actions.
- A testnet deployment is made only if successful and uses test assets only.
- README includes commands, architecture, known limitations, tests, demo sequence and reference paper.

---

## 12. Rules for the AI coding agent

Follow these instructions throughout implementation:

1. **Read before coding.** Inspect existing files and read the reference paper first. If the repo has existing work, preserve it unless there is a justified migration.
2. **Plan in stages.** Start by producing the Phase 0 design files and implementation plan; then continue one milestone at a time, reporting changed files and test results at each phase.
3. **No fake security.** Do not implement permission checks only in the frontend or rely on the LLM to decide whether an action is authorized.
4. **No magical claims.** Do not claim blockchain proves off-chain actions happened, makes an AI safe, or enforces API calls that bypass the gateway.
5. **Test negative paths.** Each security feature needs rejection tests, not only successful demos.
6. **Keep it small.** Prefer the smallest complete protocol with strong tests over a large collection of unfinished features.
7. **Do not invent sources or standards.** Use the reference links below and state when behavior has not been verified.
8. **Protect secrets.** Never put API keys, signing keys or seed phrases in source control, prompts, frontend bundles, logs, or on-chain data. Include a safe `.env.example` only.
9. **No mainnet.** Do not broadcast transactions to a production network or spend real funds. Ask the user before any public testnet deployment that requires wallet access or secrets.
10. **Keep docs current.** Update setup instructions, invariants, limitations and test results with each milestone.

### Initial task to execute

Begin with Phase 0 only: inspect the repository, summarize its current state, read the paper, write the architecture/threat-model/permission-model documents, and propose the contract interfaces and budget accounting algorithm. Do not start large-scale implementation until those design artifacts are internally consistent. After that, implement Phase 1 and run the full local test suite.

---

## 13. Reference links

- Research paper: https://proceedings.mlr.press/v267/south25a.html
- Research paper PDF: https://raw.githubusercontent.com/mlresearch/v267/main/assets/south25a/south25a.pdf
- Ethereum smart contracts: https://ethereum.org/developers/docs/smart-contracts/
- Ethereum account abstraction: https://ethereum.org/roadmap/account-abstraction
- ERC-7715 — Request Permissions from Wallets (related standard; draft): https://eips.ethereum.org/EIPS/eip-7715
- Foundry: https://getfoundry.sh/
- Anvil: https://www.getfoundry.sh/anvil/index.html
- OpenZeppelin Contracts: https://docs.openzeppelin.com/contracts/
- Ethereum networks / testnets: https://ethereum.org/developers/docs/networks/
- Solidity documentation: https://docs.soliditylang.org/
- Slither: https://github.com/crytic/slither

**Closing direction:** Build Aegis as a measured security-protocol prototype, not a generic “AI + blockchain” app. Its strongest result is a clear set of security invariants, an implementation that enforces them at the correct boundaries, and reproducible evidence of how it handles attacks.
