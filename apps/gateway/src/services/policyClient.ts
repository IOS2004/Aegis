// SPDX-License-Identifier: MIT
import {
  createPublicClient,
  createWalletClient,
  http,
  verifyTypedData,
  type PublicClient,
  type WalletClient,
  type Address,
  type Hex,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  getAegisPolicyManagerDomain,
  ACTION_REQUEST_TYPES,
  getAgentVaultDomain,
  VAULT_TRANSFER_TYPES,
  type ActionRequest,
  type Grant,
} from "@aegis/shared";

export const AEGIS_POLICY_MANAGER_ABI = parseAbi([
  "struct Grant { bytes32 grantId; bytes32 parentGrantId; address agent; uint256 allowedTools; uint64 expiresAt; uint256 maxPerAction; uint256 maxTotalBudget; uint256 spent; uint256 reservedChildBudget; bool revoked; bool reservationReleased; uint256 nonce; }",
  "struct ActionRequest { bytes32 actionId; bytes32 grantId; uint256 toolBit; uint256 cost; bytes32 paramsHash; uint256 nonce; uint64 deadline; }",
  "function getGrant(bytes32 grantId) external view returns (Grant)",
  "function isGrantValid(bytes32 grantId) external view returns (bool valid, bytes32 invalidNodeId)",
  "function getAvailableBudget(bytes32 grantId) external view returns (uint256)",
  "function checkAndConsumeBudget(ActionRequest calldata request, bytes calldata signature) external",
  "function commitReceipt(bytes32 actionId, bytes32 grantId, bytes32 receiptHash) external",
  "function reclaimExpiredBudget(bytes32 childGrantId) external",
  "function DOMAIN_SEPARATOR() external view returns (bytes32)",
  "error Unauthorized()",
  "error GrantNotFound()",
  "error GrantRevokedError()",
  "error GrantExpired()",
  "error GrantNotExpired()",
  "error AlreadyRevoked()",
  "error ReservationAlreadyReleased()",
  "error CannotReclaimRoot()",
  "error AncestorRevoked(bytes32 ancestorGrantId)",
  "error AncestorExpired(bytes32 ancestorGrantId)",
  "error ToolNotPermitted(uint256 toolBit, uint256 allowedTools)",
  "error PerActionLimitExceeded(uint256 requested, uint256 maxPerAction)",
  "error SubtreeBudgetExceeded(uint256 requested, uint256 available)",
  "error InvalidNonce(uint256 expected, uint256 actual)",
  "error InvalidSignature()",
  "error SignatureExpired()",
  "error ScopeAttenuationFailed()",
  "error ExpirationAttenuationFailed()",
  "error PerActionAttenuationFailed()",
  "error BudgetAttenuationFailed()",
  "error MaxDepthExceeded()",
]);

export const AGENT_VAULT_ABI = parseAbi([
  "struct VaultTransferRequest { bytes32 actionId; bytes32 grantId; address to; uint256 amount; uint256 nonce; uint64 deadline; }",
  "function executeTransfer(VaultTransferRequest calldata request, bytes calldata signature) external returns (bool)",
  "function deposit(uint256 amount) external",
  "function token() external view returns (address)",
  "function policyManager() external view returns (address)",
]);

export interface PolicyClientConfig {
  rpcUrl: string;
  chainId: number;
  policyManagerAddress: Address;
  vaultAddress?: Address;
  relayerPrivateKey?: Hex;
}

export class PolicyClient {
  public readonly publicClient: PublicClient;
  public readonly walletClient?: WalletClient;
  public readonly policyManagerAddress: Address;
  public readonly vaultAddress?: Address;
  public readonly chainId: number;

  constructor(config: PolicyClientConfig) {
    this.chainId = config.chainId;
    this.policyManagerAddress = config.policyManagerAddress;
    this.vaultAddress = config.vaultAddress;

    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    });

    if (config.relayerPrivateKey) {
      const account = privateKeyToAccount(config.relayerPrivateKey);
      this.walletClient = createWalletClient({
        account,
        transport: http(config.rpcUrl),
      });
    }
  }

  public async getGrant(grantId: Hex): Promise<Grant> {
    const raw = (await this.publicClient.readContract({
      address: this.policyManagerAddress,
      abi: AEGIS_POLICY_MANAGER_ABI,
      functionName: "getGrant",
      args: [grantId],
    })) as any;

    return {
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
    };
  }

  public async isGrantValid(grantId: Hex): Promise<{ valid: boolean; invalidNodeId: Hex }> {
    const [valid, invalidNodeId] = (await this.publicClient.readContract({
      address: this.policyManagerAddress,
      abi: AEGIS_POLICY_MANAGER_ABI,
      functionName: "isGrantValid",
      args: [grantId],
    })) as [boolean, Hex];

    return { valid, invalidNodeId };
  }

  public async getAvailableBudget(grantId: Hex): Promise<bigint> {
    const budget = (await this.publicClient.readContract({
      address: this.policyManagerAddress,
      abi: AEGIS_POLICY_MANAGER_ABI,
      functionName: "getAvailableBudget",
      args: [grantId],
    })) as bigint;

    return budget;
  }

  public async verifyActionSignature(
    request: ActionRequest,
    signature: Hex,
    expectedSigner: Address
  ): Promise<boolean> {
    const domain = getAegisPolicyManagerDomain(this.chainId, this.policyManagerAddress);
    return await verifyTypedData({
      address: expectedSigner,
      domain,
      types: ACTION_REQUEST_TYPES,
      primaryType: "ActionRequest",
      message: request,
      signature,
    });
  }

  public async preConsumeBudget(
    request: ActionRequest,
    signature: Hex
  ): Promise<{ txHash: Hex }> {
    if (!this.walletClient || !this.walletClient.account) {
      throw new Error("Relayer wallet not configured for on-chain submission");
    }

    const txHash = await this.walletClient.writeContract({
      address: this.policyManagerAddress,
      abi: AEGIS_POLICY_MANAGER_ABI,
      functionName: "checkAndConsumeBudget",
      args: [request, signature],
      account: this.walletClient.account,
      chain: undefined,
    });

    // Wait for inclusion in block
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return { txHash };
  }

  public async commitReceipt(
    actionId: Hex,
    grantId: Hex,
    receiptHash: Hex
  ): Promise<{ txHash: Hex }> {
    if (!this.walletClient || !this.walletClient.account) {
      throw new Error("Relayer wallet not configured for on-chain submission");
    }

    const txHash = await this.walletClient.writeContract({
      address: this.policyManagerAddress,
      abi: AEGIS_POLICY_MANAGER_ABI,
      functionName: "commitReceipt",
      args: [actionId, grantId, receiptHash],
      account: this.walletClient.account,
      chain: undefined,
    });

    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return { txHash };
  }

  public async reclaimExpiredBudget(childGrantId: Hex): Promise<{ txHash: Hex }> {
    if (!this.walletClient || !this.walletClient.account) {
      throw new Error("Relayer wallet not configured for on-chain submission");
    }

    const txHash = await this.walletClient.writeContract({
      address: this.policyManagerAddress,
      abi: AEGIS_POLICY_MANAGER_ABI,
      functionName: "reclaimExpiredBudget",
      args: [childGrantId],
      account: this.walletClient.account,
      chain: undefined,
    });

    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return { txHash };
  }
}
