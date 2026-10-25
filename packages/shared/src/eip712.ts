// SPDX-License-Identifier: MIT
import { keccak256, toHex, encodePacked, type Hex, type Address } from "viem";
import type { ActionRequest, ToolName } from "./types.js";
import { TOOL_BITS } from "./types.js";

export const getAegisPolicyManagerDomain = (chainId: number, verifyingContract: Address) =>
  ({
    name: "AegisPolicyManager",
    version: "1",
    chainId,
    verifyingContract,
  } as const);

export const getAgentVaultDomain = (chainId: number, verifyingContract: Address) =>
  ({
    name: "AgentVault",
    version: "1",
    chainId,
    verifyingContract,
  } as const);

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
} as const;

export const VAULT_TRANSFER_TYPES = {
  VaultTransferRequest: [
    { name: "actionId", type: "bytes32" },
    { name: "grantId", type: "bytes32" },
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

/**
 * Computes deterministic hash of params by sorting keys alphabetically
 */
export function hashParams(params: Record<string, unknown>): Hex {
  const sortedKeys = Object.keys(params).sort();
  const sortedObj: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    sortedObj[k] = params[k];
  }
  const jsonStr = JSON.stringify(sortedObj);
  return keccak256(toHex(jsonStr));
}

/**
 * Computes unique actionId
 */
export function computeActionId(
  grantId: Hex,
  nonce: bigint,
  toolBit: bigint,
  timestampOrEntropy?: bigint
): Hex {
  const entropy =
    timestampOrEntropy ??
    (BigInt(Date.now()) * 1000000n + BigInt(Math.floor(Math.random() * 1000000)));
  return keccak256(
    encodePacked(
      ["bytes32", "uint256", "uint256", "uint256"],
      [grantId, nonce, toolBit, entropy]
    )
  );
}

/**
 * Helper to build an ActionRequest struct from input parameters
 */
export function buildActionRequest(params: {
  grantId: Hex;
  toolName: ToolName;
  cost: bigint;
  paramsObj: Record<string, unknown>;
  nonce: bigint;
  deadline: bigint;
  actionId?: Hex;
}): ActionRequest {
  const toolBit = TOOL_BITS[params.toolName];
  const pHash = hashParams(params.paramsObj);
  const actId =
    params.actionId ??
    computeActionId(params.grantId, params.nonce, toolBit);

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
