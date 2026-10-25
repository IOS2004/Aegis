import { type Hex, type Address } from "viem";
import type { ActionRequest, ToolName } from "./types.js";
export declare const getAegisPolicyManagerDomain: (chainId: number, verifyingContract: Address) => {
    readonly name: "AegisPolicyManager";
    readonly version: "1";
    readonly chainId: number;
    readonly verifyingContract: `0x${string}`;
};
export declare const getAgentVaultDomain: (chainId: number, verifyingContract: Address) => {
    readonly name: "AgentVault";
    readonly version: "1";
    readonly chainId: number;
    readonly verifyingContract: `0x${string}`;
};
export declare const ACTION_REQUEST_TYPES: {
    readonly ActionRequest: readonly [{
        readonly name: "actionId";
        readonly type: "bytes32";
    }, {
        readonly name: "grantId";
        readonly type: "bytes32";
    }, {
        readonly name: "toolBit";
        readonly type: "uint256";
    }, {
        readonly name: "cost";
        readonly type: "uint256";
    }, {
        readonly name: "paramsHash";
        readonly type: "bytes32";
    }, {
        readonly name: "nonce";
        readonly type: "uint256";
    }, {
        readonly name: "deadline";
        readonly type: "uint64";
    }];
};
export declare const VAULT_TRANSFER_TYPES: {
    readonly VaultTransferRequest: readonly [{
        readonly name: "actionId";
        readonly type: "bytes32";
    }, {
        readonly name: "grantId";
        readonly type: "bytes32";
    }, {
        readonly name: "to";
        readonly type: "address";
    }, {
        readonly name: "amount";
        readonly type: "uint256";
    }, {
        readonly name: "nonce";
        readonly type: "uint256";
    }, {
        readonly name: "deadline";
        readonly type: "uint64";
    }];
};
/**
 * Computes deterministic hash of params by sorting keys alphabetically
 */
export declare function hashParams(params: Record<string, unknown>): Hex;
/**
 * Computes unique actionId
 */
export declare function computeActionId(grantId: Hex, nonce: bigint, toolBit: bigint, timestamp: bigint): Hex;
/**
 * Helper to build an ActionRequest struct from input parameters
 */
export declare function buildActionRequest(params: {
    grantId: Hex;
    toolName: ToolName;
    cost: bigint;
    paramsObj: Record<string, unknown>;
    nonce: bigint;
    deadline: bigint;
    actionId?: Hex;
}): ActionRequest;
