# Aegis: Permission, Budget Accounting, and Cryptographic Specification

## 1. Core Data Structures and Definitions

### 1.1 Tool Scopes and Bitmask Encoding
Permissions in Aegis are machine-readable and encoded as a `uint256` bitmask. Each bit index corresponds to a specific, immutable tool or action capability:

| Tool Name | Bit Index | Bitmask (Hex) | Description | Enforcement Point |
|---|---|---|---|---|
| `TOOL_READ_STATUS` | 0 | `0x0001` | Read sandbox status and workspace metadata | Execution Gateway |
| `TOOL_RUN_TESTS` | 1 | `0x0002` | Execute pre-configured test suite in sandbox | Execution Gateway |
| `TOOL_CREATE_BRANCH` | 2 | `0x0004` | Create a new git branch in sandbox repo | Execution Gateway |
| `TOOL_WRITE_FILE` | 3 | `0x0008` | Write to allowlisted scratch/demo directory | Execution Gateway |
| `TOOL_VAULT_TRANSFER` | 4 | `0x0010` | Authorize mock USDC transfer from `AgentVault` | Smart Contract (`AgentVault`) |

A grant's `allowedTools` field is a bitwise combination of these flags.

### 1.2 On-Chain Grant Structure (`AegisPolicyManager.sol`)

```solidity
struct Grant {
    bytes32 grantId;              // Unique identifier (hash of root parameters or parent + child nonce)
    bytes32 parentGrantId;        // Sentinel bytes32(0) if this is a Root Grant
    address agent;                // Public Ethereum address corresponding to agent signing key
    uint256 allowedTools;         // Bitmask of permitted tool capabilities
    uint64 expiresAt;             // Unix timestamp after which grant is invalid
    uint256 maxPerAction;         // Maximum cost/units permissible for a single action
    uint256 maxTotalBudget;       // Maximum cumulative budget allocated to this grant's subtree
    uint256 spent;                // Cumulative units spent by this grant and its descendants
    uint256 reservedChildBudget;  // Budget committed to unreleased direct child grants
    bool revoked;                 // Explicit revocation flag
    bool reservationReleased;     // Explicit flag indicating whether reservation has been released back to parent
    uint256 nonce;                // Sequential nonce for replay protection
}
```

---

## 2. Standardized EIP-712 Cryptographic Signatures

To avoid ad-hoc or vulnerable signature schemes, Aegis adopts **EIP-712 typed structured data signing** with explicit chain ID and verifying-contract domain separation.

### 2.1 EIP-712 Domain Separator
```solidity
bytes32 public constant DOMAIN_TYPEHASH = keccak256(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
);
```
- `name`: `"AegisPolicyManager"` (or `"AgentVault"`)
- `version`: `"1"`
- `chainId`: `block.chainid` (dynamically evaluated to prevent cross-chain replay across testnets/forks)
- `verifyingContract`: `address(this)` (prevents cross-contract signature replay)

### 2.2 Typed Data Structures

#### 1. Off-Chain Action Authorization (`ActionRequest`):
Used by the Execution Gateway to verify requests and pre-consume budget in `AegisPolicyManager`:
```solidity
bytes32 public constant ACTION_REQUEST_TYPEHASH = keccak256(
    "ActionRequest(bytes32 actionId,bytes32 grantId,uint256 toolBit,uint256 cost,bytes32 paramsHash,uint256 nonce,uint64 deadline)"
);
```
- `actionId`: Unique client-generated action identifier (`keccak256(abi.encodePacked(grantId, nonce, toolBit, timestamp))`).
- `grantId`: The specific grant authorizing this action (binds action strictly to grant).
- `toolBit`: Tool bitmask flag (e.g., `0x0002` for `TOOL_RUN_TESTS`).
- `cost`: Budget units requested for this action.
- `paramsHash`: `keccak256(canonicalParamsJson)` (cryptographically binds tool arguments without putting plaintext on-chain).
- `nonce`: The current sequential nonce of `grantId`.
- `deadline`: Unix timestamp after which the signature is expired and invalid.

#### 2. On-Chain Vault Transfer (`VaultTransferRequest`):
Used directly by `AgentVault.sol` to execute token transfers:
```solidity
bytes32 public constant VAULT_TRANSFER_TYPEHASH = keccak256(
    "VaultTransferRequest(bytes32 actionId,bytes32 grantId,address to,uint256 amount,uint256 nonce,uint64 deadline)"
);
```

### 2.3 Signature Verification Procedure
For any signed request `(request, signature)`:
1. Verify `block.timestamp <= request.deadline`, reverting with `ERR_SIGNATURE_EXPIRED` if violated.
2. Verify `request.nonce == grants[request.grantId].nonce`, reverting with `ERR_INVALID_NONCE` if violated.
3. Compute EIP-712 digest:
   $$\text{digest} = \text{keccak256}(\text{"\x19\x01"} \parallel \text{DOMAIN\_SEPARATOR} \parallel \text{hashStruct}(\text{request}))$$
4. Recover signer via `ECDSA.recover(digest, signature)`.
5. Require `signer == grants[request.grantId].agent`, reverting with `ERR_INVALID_SIGNATURE` if violated.
6. Upon successful authorization/consumption, atomically increment `grants[request.grantId].nonce++`.

---

## 3. Delegation & Scope Attenuation Rules

When parent grant $P$ delegates to child grant $C$, the contract enforces monotonic attenuation:

1. **Tool Scope Attenuation:** $(C.\text{allowedTools} \ \& \ \sim P.\text{allowedTools}) == 0$
2. **Temporal Attenuation:** $C.\text{expiresAt} \le P.\text{expiresAt}$
3. **Per-Action Cap Attenuation:** $C.\text{maxPerAction} \le P.\text{maxPerAction}$
4. **Budget Capacity Attenuation:**
   $$P.\text{available} = P.\text{maxTotalBudget} - P.\text{spent} - P.\text{reservedChildBudget}$$
   $$C.\text{maxTotalBudget} \le P.\text{available}$$
   Upon creation:
   $$P.\text{reservedChildBudget} \leftarrow P.\text{reservedChildBudget} + C.\text{maxTotalBudget}$$
   $$C.\text{spent} \leftarrow 0, \quad C.\text{reservedChildBudget} \leftarrow 0, \quad C.\text{reservationReleased} \leftarrow \text{false}$$

---

## 4. Formal Budget Accounting & Reservation-Release Semantics

### 4.1 Explicit Reservation State & Contributing Child Allocations

A central requirement of the accounting model is making the **reservation-release state** unambiguous.

Every grant $k$ maintains:
- $B(k) \in \mathbb{N}$: `maxTotalBudget` (immutable upper ceiling for $k$'s entire subtree)
- $S(k) \in \mathbb{N}$: `spent` (aggregate cumulative budget spent by $k$ directly and all descendants in $k$'s subtree)
- $R(k) \in \mathbb{N}$: `reservedChildBudget` (total budget committed to direct children whose reservations have not yet been released)
- $A(k) \in \mathbb{N}$: `availableBudget` = $B(k) - S(k) - R(k)$

#### Which Child Allocations Contribute to $R(k)$?
$R(k)$ is formally defined as:
$$R(k) = \sum_{C \in \text{directChildren}(k), \ \neg C.\text{reservationReleased}} (B(C) - S(C))$$

We classify all possible child states and their contribution to parent reserve $R(k)$:

| Child Status | `revoked` | `block.timestamp > expiresAt` | `reservationReleased` | Contribution to $R(k)$ | Explanation |
|---|---|---|---|---|---|
| **Active & Valid** | `false` | `false` | `false` | **$B(C) - S(C)$** | Child is active and authorized to spend. |
| **Expired (Pending Reclamation)** | `false` | `true` | `false` | **$B(C) - S(C)$** | Child cannot spend, but its budget remains reserved in $P$ until explicit reclamation confirms release. Prevents over-allocation. |
| **Revoked & Released** | `true` | Any | `true` | **$0$** | Reservation was released upon revocation; unspent capacity returned to $P$. |
| **Expired & Reclaimed** | `true` | `true` | `true` | **$0$** | Reservation was released via `reclaimExpiredBudget`; unspent capacity returned to $P$. |

### 4.2 Invariants Maintained at Every State Transition

At every node $k$ in the delegation hierarchy across all transitions:
1. **Conservation Invariant:** $S(k) + R(k) + A(k) = B(k)$
2. **Capacity Invariant:** $S(k) + R(k) \le B(k) \iff A(k) \ge 0$
3. **Subtree Expenditure Conservation:**
   $$\forall \text{ancestor } A \text{ of } C: \quad S(A) \leftarrow S(A) + c, \quad R(A) \leftarrow R(A) - c$$
   $$(S(A) + c) + (R(A) - c) + A(A) = S(A) + R(A) + A(A) = B(A)$$
   Ancestors' available budget $A(A)$ is strictly invariant to child spending!
4. **Single-Release Guarantee:** A child grant's reservation can be released **exactly once**. Once `reservationReleased == true`, any repeated call to revoke or reclaim reverts immediately.

---

## 5. State Transition Algorithms

### Algorithm 1: Create Root Grant
```python
def create_root_grant(agent, allowed_tools, expires_at, max_per_action, max_total_budget):
    require(msg.sender == owner, "ERR_UNAUTHORIZED_CALLER")
    require(expires_at > current_time(), "ERR_INVALID_EXPIRY")
    require(max_total_budget > 0, "ERR_INVALID_BUDGET")

    grant_id = keccak256(agent, allowed_tools, expires_at, block_number())
    grants[grant_id] = Grant(
        grantId = grant_id,
        parentGrantId = bytes32(0),
        agent = agent,
        allowedTools = allowed_tools,
        expiresAt = expires_at,
        maxPerAction = max_per_action,
        maxTotalBudget = max_total_budget,
        spent = 0,
        reservedChildBudget = 0,
        revoked = False,
        reservationReleased = False,
        nonce = 0
    )
    emit RootGrantCreated(grant_id, agent, max_total_budget)
    return grant_id
```

### Algorithm 2: Delegate Child Grant
```python
def delegate_grant(parent_id, child_agent, child_tools, child_expires_at, child_max_per_action, child_budget):
    parent = grants[parent_id]
    require(parent.grantId != 0, "ERR_PARENT_NOT_FOUND")
    require(!parent.revoked, "ERR_PARENT_REVOKED")
    require(current_time() <= parent.expiresAt, "ERR_PARENT_EXPIRED")
    require(msg.sender == parent.agent or msg.sender == owner, "ERR_UNAUTHORIZED_DELEGATOR")

    # Monotonic attenuation checks
    require((child_tools & ~parent.allowedTools) == 0, "ERR_SCOPE_ATTENUATION_FAILED")
    require(child_expires_at <= parent.expiresAt, "ERR_EXPIRATION_ATTENUATION_FAILED")
    require(child_max_per_action <= parent.maxPerAction, "ERR_PER_ACTION_ATTENUATION_FAILED")

    # Parent capacity check
    parent_available = parent.maxTotalBudget - parent.spent - parent.reservedChildBudget
    require(child_budget <= parent_available, "ERR_BUDGET_EXCEEDED")

    # Reserve allocation on parent
    parent.reservedChildBudget += child_budget

    child_id = keccak256(parent_id, child_agent, parent.nonce)
    parent.nonce += 1

    grants[child_id] = Grant(
        grantId = child_id,
        parentGrantId = parent_id,
        agent = child_agent,
        allowedTools = child_tools,
        expiresAt = child_expires_at,
        maxPerAction = child_max_per_action,
        maxTotalBudget = child_budget,
        spent = 0,
        reservedChildBudget = 0,
        revoked = False,
        reservationReleased = False,
        nonce = 0
    )
    emit GrantDelegated(parent_id, child_id, child_agent, child_budget)
    return child_id
```

### Algorithm 3: Spend Budget
```python
def spend_budget(grant_id, cost):
    grant = grants[grant_id]
    available = grant.maxTotalBudget - grant.spent - grant.reservedChildBudget
    require(cost <= available, "ERR_SUBTREE_BUDGET_EXCEEDED")

    grant.spent += cost

    # Walk ancestors and shift reserved budget to spent
    curr_id = grant.parentGrantId
    while curr_id != bytes32(0):
        ancestor = grants[curr_id]
        require(ancestor.reservedChildBudget >= cost, "ERR_CORRUPT_RESERVE")
        ancestor.reservedChildBudget -= cost
        ancestor.spent += cost
        curr_id = ancestor.parentGrantId
```

### Algorithm 4: Revoke Grant & Release Reservation
```python
def revoke_grant(grant_id):
    grant = grants[grant_id]
    require(grant.grantId != 0, "ERR_GRANT_NOT_FOUND")
    require(!grant.revoked, "ERR_ALREADY_REVOKED")

    # Authorization
    if grant.parentGrantId == bytes32(0):
        require(msg.sender == owner, "ERR_UNAUTHORIZED_REVOKER")
    else:
        parent = grants[grant.parentGrantId]
        require(msg.sender == parent.agent or msg.sender == owner, "ERR_UNAUTHORIZED_REVOKER")

    grant.revoked = True

    # Release reservation strictly once
    if grant.parentGrantId != bytes32(0) and not grant.reservationReleased:
        parent = grants[grant.parentGrantId]
        unspent_child_budget = grant.maxTotalBudget - grant.spent
        grant.reservationReleased = True
        
        # If parent itself is NOT revoked, credit parent's reserved budget
        # (If parent was already revoked, parent's entire capacity was already returned to grandparent)
        if not parent.revoked:
            parent.reservedChildBudget -= unspent_child_budget

    emit GrantRevoked(grant_id, msg.sender)
```

### Algorithm 5: Reclaim Expired Budget
```python
def reclaim_expired_budget(child_grant_id):
    child = grants[child_grant_id]
    require(child.grantId != 0, "ERR_GRANT_NOT_FOUND")
    require(child.parentGrantId != bytes32(0), "ERR_CANNOT_RECLAIM_ROOT")
    require(current_time() > child.expiresAt, "ERR_GRANT_NOT_EXPIRED")
    require(!child.reservationReleased, "ERR_RESERVATION_ALREADY_RELEASED")

    child.revoked = True
    child.reservationReleased = True

    parent = grants[child.parentGrantId]
    unspent = child.maxTotalBudget - child.spent

    # Credit immediate parent if parent is not already revoked
    if not parent.revoked and unspent > 0:
        parent.reservedChildBudget -= unspent

    emit ExpiredBudgetReclaimed(child_grant_id, child.parentGrantId, unspent, msg.sender)
```

---

## 6. Corrected Step-by-Step Numerical Trace

| Step | Operation & Details | Root Grant ($G_0$) State | Agent A ($G_1$) State | Agent B ($G_2$) State | State Invariant Check |
|---|---|---|---|---|---|
| **0** | **Owner creates Root $G_0$** (1000) | $B=1000$<br/>$S=0, R=0$<br/>**$A=1000$** | — | — | $G_0: 0+0+1000 = 1000$ ✓ |
| **1** | **$G_0$ delegates to $G_1$** (400) | $B=1000$<br/>$S=0, R=400$<br/>**$A=600$** | $B=400$<br/>$S=0, R=0$<br/>**$A=400$** | — | $G_0: 400+600 = 1000$ ✓<br/>$G_1: 0+400 = 400$ ✓ |
| **2** | **$G_1$ delegates to $G_2$** (150) | $B=1000$<br/>$S=0, R=400$<br/>**$A=600$** | $B=400$<br/>$S=0, R=150$<br/>**$A=250$** | $B=150$<br/>$S=0, R=0$<br/>**$A=150$** | $G_0: 400+600 = 1000$ ✓<br/>$G_1: 150+250 = 400$ ✓<br/>$G_2: 0+150 = 150$ ✓ |
| **3** | **$G_2$ spends 20** | $B=1000$<br/>$S=20, R=380$<br/>**$A=600$** | $B=400$<br/>$S=20, R=130$<br/>**$A=250$** | $B=150$<br/>$S=20, R=0$<br/>**$A=130$** | $G_0: 20+380+600 = 1000$ ✓<br/>$G_1: 20+130+250 = 400$ ✓<br/>$G_2: 20+130 = 150$ ✓ |
| **4** | **$G_2$ attempts `vault_transfer`** | Unchanged | Unchanged | Unchanged | **REJECTED (`ERR_TOOL_NOT_PERMITTED`)** |
| **5** | **$G_2$ attempts cost 60** | Unchanged | Unchanged | Unchanged | **REJECTED (`ERR_PER_ACTION_EXCEEDED`)** |
| **6** | **$G_1$ revokes $G_2$**<br/>$G_2$ unspent: $150-20=130$.<br/>$G_2.\text{reservationReleased} \leftarrow \text{true}$.<br/>$G_1$ reclaims 130: $R(G_1) \leftarrow 130-130=0$.<br/>**$G_0$ is UNCHANGED!** | **$B=1000$<br/>$S=20, R=380$<br/>**$A=600$** | **$B=400$<br/>$S=20, R=0$<br/>**$A=380$** | **REVOKED & RELEASED**<br/>$B=150, S=20$ | $G_0: 20+380+600 = 1000$ ✓<br/>$G_1: 20+0+380 = 400$ ✓<br/>No double-counting! |
| **7** | **$G_2$ attempts action** | Unchanged | Unchanged | Unchanged | **REJECTED (`ERR_GRANT_REVOKED`)** |
| **8** | **Owner revokes $G_1$**<br/>$G_1$ unspent: $400-20=380$.<br/>$G_1.\text{reservationReleased} \leftarrow \text{true}$.<br/>$G_0$ reclaims 380: $R(G_0) \leftarrow 380-380=0$. | **$B=1000$<br/>$S=20, R=0$<br/>**$A=980$** | **REVOKED & RELEASED**<br/>$B=400, S=20$ | REVOKED | $G_0: 20+0+980 = 1000$ ✓<br/>Conservation preserved! |

---

## 7. Concrete State-Transition Test Cases

The following five test cases verify the edge-case behavior of the accounting engine:

### Test Case 1: Single-Release Guarantee
- **Setup:** Parent $P$ ($B=1000$) delegates $B=200$ to Child $C$. $R(P) = 200, A(P) = 800$.
- **Action:** Call `revokeGrant(C)`.
- **Expected Outcome 1:** $C.\text{reservationReleased} \leftarrow \text{true}$, $P.\text{reservedChildBudget}$ decreases by 200 to 0. $A(P) = 1000$.
- **Action 2:** Call `revokeGrant(C)` or `reclaimExpiredBudget(C)` a second time.
- **Expected Outcome 2:** Transaction reverts with `ReservationAlreadyReleased` or `AlreadyRevoked`. $P.\text{reservedChildBudget}$ remains 0. Double-crediting is impossible.

### Test Case 2: Ancestor Revocation Followed by Descendant Reclamation
- **Setup:** $G_0$ ($B=1000$) delegates 400 to $G_1$. $G_1$ delegates 150 to $G_2$. $G_2$ spends 20.
- **Action 1:** $G_2$ expires (`block.timestamp > G2.expiresAt`).
- **Action 2:** Owner calls `revokeGrant(G1)`.
  - $G_1$ unspent = $400 - 20 = 380$.
  - $G_0$ reclaims 380: $R(G_0) \leftarrow 380 - 380 = 0$, $A(G_0) = 980$.
  - $G_1.\text{revoked} = \text{true}, G_1.\text{reservationReleased} = \text{true}$.
- **Action 3:** Someone calls `reclaimExpiredBudget(G2)`.
  - Child $G_2$ checks immediate parent $G_1$. Because $G_1.\text{revoked} == \text{true}$ (and $G_0$ already reclaimed $G_1$'s entire unspent budget), $G_0$ is **never touched**.
  - $G_2.\text{reservationReleased} \leftarrow \text{true}$.
  - $G_0$ state remains strictly $B=1000, S=20, R=0, A=980$. No double-credit.

### Test Case 3: Expired Allocation Conservation Prior to Reclamation
- **Setup:** Parent $P$ ($B=500$) delegates 200 to Child $C$ with `expiresAt = T`. $R(P) = 200, A(P) = 300$.
- **Action 1:** Warp time to $T + 10$.
  - Child $C$ attempts to spend 10: **REVERTS** (`GrantExpired`).
  - Parent $P$ attempts to delegate 350 to Child $C_2$: **REVERTS** (`SubtreeBudgetExceeded`, since $A(P) = 300$).
  - Proves: $C$'s 200 remains reserved in $P$, preventing oversubscription before confirmation.
- **Action 2:** Call `reclaimExpiredBudget(C)`.
  - $P.\text{reservedChildBudget}$ decreases by 200 to 0. $A(P)$ increases to 500.
  - Parent $P$ now delegates 350 to $C_2$: **SUCCEEDS**.

### Test Case 4: Order-Independence of Delegation and Reclamation
- **Scenario A (Reclaim then Delegate):**
  - $P$ ($B=500, R=200, A=300$). $C_1$ expires with 200 unspent.
  - Step 1: Reclaim $C_1 \implies R(P)=0, A(P)=500$.
  - Step 2: Delegate 400 to $C_2 \implies R(P)=400, A(P)=100$. (Valid: $400 \le 500$).
- **Scenario B (Delegate then Reclaim):**
  - $P$ ($B=500, R=200, A=300$). $C_1$ expires with 200 unspent.
  - Step 1: Attempt to delegate 400 to $C_2 \implies$ **REVERTS** ($400 > A(P)=300$).
  - Step 2: Delegate 250 to $C_2 \implies R(P)=450, A(P)=50$. (Valid: $250 \le 300$).
  - Step 3: Reclaim $C_1 \implies R(P) \leftarrow 450 - 200 = 250, A(P) \leftarrow 500 - 0 - 250 = 250$.
- **Conclusion:** Parent capacity can never be exceeded regardless of transaction ordering.

### Test Case 5: Invariant Preservation Across Full Lifecycle
After every single operation (create, delegate, spend, revoke, reclaim):
- Assert: `grant.spent + grant.reservedChildBudget + availableBudget == grant.maxTotalBudget`
- Assert: `grant.spent + grant.reservedChildBudget <= grant.maxTotalBudget`
- Assert: `grant.nonce` strictly monotonically increments upon spending
- Assert: All unrevoked descendants have valid unrevoked and unexpired ancestry.
