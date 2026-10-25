export type Hex = `0x${string}`;
export type Address = `0x${string}`;
export declare const TOOL_BITS: {
    readonly read_project_status: bigint;
    readonly run_test_suite: bigint;
    readonly create_sandbox_branch: bigint;
    readonly write_demo_file: bigint;
    readonly vault_transfer: bigint;
};
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
export type ActionExecutionStatus = 'REQUESTED' | 'AUTHORIZED' | 'EXECUTING' | 'EXECUTED' | 'FAILED' | 'DENIED' | 'TIMEOUT';
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
