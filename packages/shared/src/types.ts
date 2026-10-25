// SPDX-License-Identifier: MIT

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

export const TOOL_BITS = {
  read_project_status: 1n << 0n, // 0x0001
  run_test_suite: 1n << 1n,      // 0x0002
  create_sandbox_branch: 1n << 2n,// 0x0004
  write_demo_file: 1n << 3n,     // 0x0008
  vault_transfer: 1n << 4n,      // 0x0010
} as const;

export type ToolName = keyof typeof TOOL_BITS;

export interface Grant {
  grantId: Hex;
  parentGrantId: Hex;
  agent: Address;
  allowedTools: bigint;
  expiresAt: bigint;
  maxPerAction: bigint;
  maxTotalBudget: bigint;
  spent: bigint;
  reservedChildBudget: bigint;
  revoked: boolean;
  reservationReleased: boolean;
  nonce: bigint;
}

export interface ActionRequest {
  actionId: Hex;
  grantId: Hex;
  toolBit: bigint;
  cost: bigint;
  paramsHash: Hex;
  nonce: bigint;
  deadline: bigint;
}

export interface SignedActionSubmission {
  grantId: Hex;
  toolName: ToolName;
  cost: number;
  params: Record<string, unknown>;
  nonce: number;
  deadline: number;
  signature: Hex;
  actionId?: Hex;
}

export type ActionExecutionStatus =
  | 'REQUESTED'
  | 'AUTHORIZED'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'FAILED'
  | 'DENIED'
  | 'TIMEOUT';

export interface ActionReceipt {
  actionId: Hex;
  grantId: Hex;
  agent: Address;
  toolName: ToolName;
  cost: number;
  status: ActionExecutionStatus;
  resultHash: Hex;
  decisionReason?: string;
  outputSummary?: string;
  txHash?: Hex;
  timestamp: number;
}
