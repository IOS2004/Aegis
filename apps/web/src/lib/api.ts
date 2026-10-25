import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseAbiItem,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  GATEWAY_API_URL,
  RPC_URL,
  CONTRACT_ADDRESSES,
  DEMO_ACCOUNTS,
} from "./config.js";
import type { SignedActionSubmission, Grant } from "@aegis/shared";
import type { GrantNode } from "../components/GrantTree.js";

export interface ActionRecord {
  actionId: string;
  grantId: string;
  agentAddress: string;
  toolName: string;
  cost: number;
  status: string;
  decisionReason?: string;
  paramsJson: string;
  paramsHash: string;
  resultHash?: string;
  outputSummary?: string;
  txHash?: string;
  receiptTxHash?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AuditEventRecord {
  id: number;
  actionId: string;
  eventType: string;
  previousStatus?: string;
  newStatus?: string;
  dataJson?: string;
  timestamp: number;
}

export const publicClient = createPublicClient({
  transport: http(RPC_URL),
});

export const AEGIS_POLICY_MANAGER_ABI = parseAbi([
  "struct Grant { bytes32 grantId; bytes32 parentGrantId; address agent; uint256 allowedTools; uint64 expiresAt; uint256 maxPerAction; uint256 maxTotalBudget; uint256 spent; uint256 reservedChildBudget; bool revoked; bool reservationReleased; uint256 nonce; }",
  "function getGrant(bytes32 grantId) external view returns (Grant)",
  "function isGrantValid(bytes32 grantId) external view returns (bool valid, bytes32 invalidNodeId)",
  "function getAvailableBudget(bytes32 grantId) external view returns (uint256)",
  "function createRootGrant(address agent, uint256 allowedTools, uint64 expiresAt, uint256 maxPerAction, uint256 maxTotalBudget) external returns (bytes32)",
  "function delegateGrant(bytes32 parentGrantId, address childAgent, uint256 childTools, uint64 childExpiresAt, uint256 childMaxPerAction, uint256 childBudget) external returns (bytes32)",
  "function revokeGrant(bytes32 grantId) external",
  "function reclaimExpiredBudget(bytes32 childGrantId) external",
  "function commitReceipt(bytes32 actionId, bytes32 grantId, bytes32 receiptHash) external",
  "event RootGrantCreated(bytes32 indexed grantId, address indexed owner, address indexed agent, uint256 allowedTools, uint256 maxTotalBudget, uint64 expiresAt)",
  "event GrantDelegated(bytes32 indexed parentGrantId, bytes32 indexed childGrantId, address indexed childAgent, uint256 allowedTools, uint256 budget, uint64 expiresAt)",
  "event GrantRevoked(bytes32 indexed grantId, address indexed revoker, uint256 unspentReclaimed)",
  "event ReceiptCommitted(bytes32 indexed actionId, bytes32 indexed grantId, bytes32 receiptHash)",
]);

export async function fetchActions(): Promise<ActionRecord[]> {
  const res = await fetch(`${GATEWAY_API_URL}/actions`);
  if (!res.ok) throw new Error("Failed to fetch actions");
  return res.json();
}

export async function fetchUnanchoredActions(): Promise<ActionRecord[]> {
  const res = await fetch(`${GATEWAY_API_URL}/actions/unanchored`);
  if (!res.ok) throw new Error("Failed to fetch unanchored actions");
  return res.json();
}

export async function fetchActionEvents(actionId: string): Promise<AuditEventRecord[]> {
  const res = await fetch(`${GATEWAY_API_URL}/actions/${actionId}/events`);
  if (!res.ok) throw new Error("Failed to fetch action events");
  return res.json();
}

export async function retryReceiptCommitment(actionId: string): Promise<{
  success: boolean;
  receiptTxHash?: string;
  error?: string;
}> {
  const res = await fetch(`${GATEWAY_API_URL}/actions/${actionId}/retry-receipt`, {
    method: "POST",
  });
  return res.json();
}

export async function verifyReceiptApi(actionId: string, resultHash: Hex): Promise<{
  success: boolean;
  alreadyAnchored: boolean;
}> {
  const res = await fetch(`${GATEWAY_API_URL}/actions/${actionId}/receipt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resultHash }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || err.error || "Verification failed");
  }
  return res.json();
}

export async function fetchGatewayGrant(grantId: string): Promise<any> {
  const res = await fetch(`${GATEWAY_API_URL}/grants/${grantId}`);
  if (!res.ok) throw new Error("Failed to fetch grant from gateway");
  return res.json();
}

export async function submitActionToGateway(payload: SignedActionSubmission): Promise<any> {
  const res = await fetch(`${GATEWAY_API_URL}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  return { status: res.status, data };
}

export async function readOnChainGrant(grantId: Hex): Promise<{
  grant: Grant;
  availableBudget: bigint;
  isValid: boolean;
  invalidNodeId: Hex;
}> {
  const raw = (await publicClient.readContract({
    address: CONTRACT_ADDRESSES.policyManager,
    abi: AEGIS_POLICY_MANAGER_ABI,
    functionName: "getGrant",
    args: [grantId],
  } as any)) as any;

  const available = (await publicClient.readContract({
    address: CONTRACT_ADDRESSES.policyManager,
    abi: AEGIS_POLICY_MANAGER_ABI,
    functionName: "getAvailableBudget",
    args: [grantId],
  } as any)) as bigint;

  const [isValid, invalidNodeId] = (await publicClient.readContract({
    address: CONTRACT_ADDRESSES.policyManager,
    abi: AEGIS_POLICY_MANAGER_ABI,
    functionName: "isGrantValid",
    args: [grantId],
  } as any)) as [boolean, Hex];

  return {
    grant: {
      grantId: raw.grantId,
      parentGrantId: raw.parentGrantId,
      agent: raw.agent,
      allowedTools: BigInt(raw.allowedTools),
      expiresAt: BigInt(raw.expiresAt),
      maxPerAction: BigInt(raw.maxPerAction),
      maxTotalBudget: BigInt(raw.maxTotalBudget),
      spent: BigInt(raw.spent),
      reservedChildBudget: BigInt(raw.reservedChildBudget),
      revoked: raw.revoked,
      reservationReleased: raw.reservationReleased,
      nonce: BigInt(raw.nonce),
    },
    availableBudget: available,
    isValid,
    invalidNodeId,
  };
}

export async function executeRevokeOnChain(
  grantId: Hex,
  callerPrivateKey: Hex = DEMO_ACCOUNTS.owner.privateKey
): Promise<Hex> {
  const wallet = createWalletClient({
    account: privateKeyToAccount(callerPrivateKey),
    transport: http(RPC_URL),
  });

  const txHash = await wallet.writeContract({
    address: CONTRACT_ADDRESSES.policyManager,
    abi: AEGIS_POLICY_MANAGER_ABI,
    functionName: "revokeGrant",
    args: [grantId],
    account: wallet.account,
    chain: undefined,
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

export async function executeReclaimExpiredOnChain(
  childGrantId: Hex,
  callerPrivateKey: Hex = DEMO_ACCOUNTS.owner.privateKey
): Promise<Hex> {
  const wallet = createWalletClient({
    account: privateKeyToAccount(callerPrivateKey),
    transport: http(RPC_URL),
  });

  const txHash = await wallet.writeContract({
    address: CONTRACT_ADDRESSES.policyManager,
    abi: AEGIS_POLICY_MANAGER_ABI,
    functionName: "reclaimExpiredBudget",
    args: [childGrantId],
    account: wallet.account,
    chain: undefined,
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

export async function createRootGrantOnChain(
  agent: Address,
  allowedTools: bigint,
  expiresAt: bigint,
  maxPerAction: bigint,
  maxTotalBudget: bigint,
  ownerPrivateKey: Hex = DEMO_ACCOUNTS.owner.privateKey
): Promise<Hex> {
  const wallet = createWalletClient({
    account: privateKeyToAccount(ownerPrivateKey),
    transport: http(RPC_URL),
  });

  const txHash = await wallet.writeContract({
    address: CONTRACT_ADDRESSES.policyManager,
    abi: AEGIS_POLICY_MANAGER_ABI,
    functionName: "createRootGrant",
    args: [agent, allowedTools, expiresAt, maxPerAction, maxTotalBudget],
    account: wallet.account,
    chain: undefined,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  // RootGrantCreated event topic 1 is grantId
  const grantId = receipt.logs[0].topics[1] as Hex;
  return grantId;
}

export async function delegateGrantOnChain(
  parentGrantId: Hex,
  childAgent: Address,
  childTools: bigint,
  childExpiresAt: bigint,
  childMaxPerAction: bigint,
  childBudget: bigint,
  parentPrivateKey: Hex = DEMO_ACCOUNTS.agentA.privateKey
): Promise<Hex> {
  const wallet = createWalletClient({
    account: privateKeyToAccount(parentPrivateKey),
    transport: http(RPC_URL),
  });

  const txHash = await wallet.writeContract({
    address: CONTRACT_ADDRESSES.policyManager,
    abi: AEGIS_POLICY_MANAGER_ABI,
    functionName: "delegateGrant",
    args: [parentGrantId, childAgent, childTools, childExpiresAt, childMaxPerAction, childBudget],
    account: wallet.account,
    chain: undefined,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  // GrantDelegated event topic 2 is childGrantId
  const childGrantId = receipt.logs[0].topics[2] as Hex;
  return childGrantId;
}

export async function seedDemoHierarchy(): Promise<Hex[]> {
  const now = BigInt(Math.floor(Date.now() / 1000));
  // 1. Root Grant G0: Agent A, all 5 tools (0x1F), cap 100, budget 1000
  const rootId = await createRootGrantOnChain(
    DEMO_ACCOUNTS.agentA.address,
    0x1Fn,
    now + 86400n * 30n,
    100n,
    1000n
  );

  // 2. Delegated Child Grant G1: Agent B, 4 tools (0x0F, no vault), cap 50, budget 300
  const childId = await delegateGrantOnChain(
    rootId,
    DEMO_ACCOUNTS.agentB.address,
    0x0Fn,
    now + 86400n * 7n,
    50n,
    300n,
    DEMO_ACCOUNTS.agentA.privateKey
  );

  // 3. Ephemeral Sub-Child Grant G2: Agent B, 2 tools (0x03, read & test), cap 10, budget 50
  const subChildId = await delegateGrantOnChain(
    childId,
    DEMO_ACCOUNTS.agentB.address,
    0x03n,
    now + 86400n * 1n,
    10n,
    50n,
    DEMO_ACCOUNTS.agentB.privateKey
  );

  return [rootId, childId, subChildId];
}

export async function discoverGrantIds(): Promise<Hex[]> {
  try {
    const rootLogs = await publicClient.getLogs({
      address: CONTRACT_ADDRESSES.policyManager,
      event: parseAbiItem(
        "event RootGrantCreated(bytes32 indexed grantId, address indexed owner, address indexed agent, uint256 allowedTools, uint256 maxTotalBudget, uint64 expiresAt)"
      ),
      fromBlock: 0n,
      toBlock: "latest",
    });

    const delegatedLogs = await publicClient.getLogs({
      address: CONTRACT_ADDRESSES.policyManager,
      event: parseAbiItem(
        "event GrantDelegated(bytes32 indexed parentGrantId, bytes32 indexed childGrantId, address indexed childAgent, uint256 allowedTools, uint256 budget, uint64 expiresAt)"
      ),
      fromBlock: 0n,
      toBlock: "latest",
    });

    const set = new Set<Hex>();
    for (const log of rootLogs) {
      if (log.args.grantId) set.add(log.args.grantId as Hex);
    }
    for (const log of delegatedLogs) {
      if (log.args.childGrantId) set.add(log.args.childGrantId as Hex);
    }
    return Array.from(set);
  } catch (err) {
    console.warn("Could not query logs for grants:", err);
    return [];
  }
}

export async function fetchFullGrantTree(knownGrantIds?: Hex[]): Promise<GrantNode[]> {
  let ids = knownGrantIds && knownGrantIds.length > 0 ? knownGrantIds : await discoverGrantIds();
  if (ids.length === 0) return [];

  const nodesMap = new Map<string, GrantNode>();
  for (const id of ids) {
    try {
      const data = await readOnChainGrant(id);
      const isRoot =
        data.grant.parentGrantId === "0x0000000000000000000000000000000000000000000000000000000000000000";

      let label = isRoot ? "G0 (Root Grant)" : "Child Grant";
      let role = isRoot ? "Senior Orchestrator" : "Delegate Sub-Agent";

      if (data.grant.agent.toLowerCase() === DEMO_ACCOUNTS.agentA.address.toLowerCase()) {
        role = "Agent A (Senior Orchestrator)";
      } else if (data.grant.agent.toLowerCase() === DEMO_ACCOUNTS.agentB.address.toLowerCase()) {
        role = "Agent B (Sub-Agent Worker)";
      }

      nodesMap.set(id.toLowerCase(), {
        grantId: id,
        grant: data.grant,
        availableBudget: data.availableBudget,
        isValid: data.isValid,
        invalidNodeId: data.invalidNodeId as `0x${string}`,
        label,
        role,
        children: [],
      });
    } catch (e) {
      console.error(`Failed to read grant ${id}:`, e);
    }
  }

  const roots: GrantNode[] = [];
  let childCount = 1;

  for (const node of nodesMap.values()) {
    const parentId = node.grant.parentGrantId.toLowerCase();
    if (
      parentId === "0x0000000000000000000000000000000000000000000000000000000000000000" ||
      !nodesMap.has(parentId)
    ) {
      roots.push(node);
    } else {
      const parent = nodesMap.get(parentId)!;
      node.label = `G${childCount++} (Delegated Grant)`;
      parent.children.push(node);
    }
  }

  return roots;
}

