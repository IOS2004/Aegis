// SPDX-License-Identifier: MIT
import { keccak256, toHex, encodePacked } from "viem";
import { TOOL_BITS } from "./types.js";
export const getAegisPolicyManagerDomain = (chainId, verifyingContract) => ({
    name: "AegisPolicyManager",
    version: "1",
    chainId,
    verifyingContract,
});
export const getAgentVaultDomain = (chainId, verifyingContract) => ({
    name: "AgentVault",
    version: "1",
    chainId,
    verifyingContract,
});
export const ACTION_REQUEST_TYPES = {
    ActionRequest: [
        { name: "actionId", type: "bytes32" },
        { name: "grantId", type: "bytes32" },
        { name: "toolBit", type: "uint256" },
        { name: "cost", type: "uint256" },
        { name: "paramsHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint64" },
    ],
};
export const VAULT_TRANSFER_TYPES = {
    VaultTransferRequest: [
        { name: "actionId", type: "bytes32" },
        { name: "grantId", type: "bytes32" },
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint64" },
    ],
};
/**
 * Computes deterministic hash of params by sorting keys alphabetically
 */
export function hashParams(params) {
    const sortedKeys = Object.keys(params).sort();
    const sortedObj = {};
    for (const k of sortedKeys) {
        sortedObj[k] = params[k];
    }
    const jsonStr = JSON.stringify(sortedObj);
    return keccak256(toHex(jsonStr));
}
/**
 * Computes unique actionId
 */
export function computeActionId(grantId, nonce, toolBit, timestamp) {
    return keccak256(encodePacked(["bytes32", "uint256", "uint256", "uint256"], [grantId, nonce, toolBit, timestamp]));
}
/**
 * Helper to build an ActionRequest struct from input parameters
 */
export function buildActionRequest(params) {
    const toolBit = TOOL_BITS[params.toolName];
    const pHash = hashParams(params.paramsObj);
    const actId = params.actionId ??
        computeActionId(params.grantId, params.nonce, toolBit, BigInt(Math.floor(Date.now() / 1000)));
    return {
        actionId: actId,
        grantId: params.grantId,
        toolBit,
        cost: params.cost,
        paramsHash: pHash,
        nonce: params.nonce,
        deadline: params.deadline,
    };
}
