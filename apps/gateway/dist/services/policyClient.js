// SPDX-License-Identifier: MIT
import { createPublicClient, createWalletClient, http, verifyTypedData, parseAbi, } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getAegisPolicyManagerDomain, ACTION_REQUEST_TYPES, } from "@aegis/shared";
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
]);
export const AGENT_VAULT_ABI = parseAbi([
    "struct VaultTransferRequest { bytes32 actionId; bytes32 grantId; address to; uint256 amount; uint256 nonce; uint64 deadline; }",
    "function executeTransfer(VaultTransferRequest calldata request, bytes calldata signature) external returns (bool)",
    "function deposit(uint256 amount) external",
    "function token() external view returns (address)",
    "function policyManager() external view returns (address)",
]);
export class PolicyClient {
    publicClient;
    walletClient;
    policyManagerAddress;
    vaultAddress;
    chainId;
    constructor(config) {
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
    async getGrant(grantId) {
        const raw = (await this.publicClient.readContract({
            address: this.policyManagerAddress,
            abi: AEGIS_POLICY_MANAGER_ABI,
            functionName: "getGrant",
            args: [grantId],
        }));
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
    async isGrantValid(grantId) {
        const [valid, invalidNodeId] = (await this.publicClient.readContract({
            address: this.policyManagerAddress,
            abi: AEGIS_POLICY_MANAGER_ABI,
            functionName: "isGrantValid",
            args: [grantId],
        }));
        return { valid, invalidNodeId };
    }
    async getAvailableBudget(grantId) {
        const budget = (await this.publicClient.readContract({
            address: this.policyManagerAddress,
            abi: AEGIS_POLICY_MANAGER_ABI,
            functionName: "getAvailableBudget",
            args: [grantId],
        }));
        return budget;
    }
    async verifyActionSignature(request, signature, expectedSigner) {
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
    async preConsumeBudget(request, signature) {
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
    async commitReceipt(actionId, grantId, receiptHash) {
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
    async reclaimExpiredBudget(childGrantId) {
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
