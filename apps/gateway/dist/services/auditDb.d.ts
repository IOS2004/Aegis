import type { ActionExecutionStatus, Hex, ToolName } from "@aegis/shared";
export interface ActionAuditRecord {
    actionId: string;
    grantId: string;
    agentAddress: string;
    toolName: string;
    cost: number;
    status: ActionExecutionStatus;
    decisionReason?: string;
    paramsJson: string;
    paramsHash: string;
    resultHash?: string;
    outputSummary?: string;
    txHash?: string;
    createdAt: number;
    updatedAt: number;
}
export declare class AuditDatabase {
    private db;
    constructor(dbPath?: string);
    private init;
    recordRequest(record: {
        actionId: Hex;
        grantId: Hex;
        agentAddress: Hex;
        toolName: ToolName;
        cost: number;
        params: Record<string, unknown>;
        paramsHash: Hex;
        status?: ActionExecutionStatus;
        decisionReason?: string;
    }): void;
    updateStatus(actionId: Hex, status: ActionExecutionStatus, extra?: {
        decisionReason?: string;
        resultHash?: Hex;
        outputSummary?: string;
        txHash?: Hex;
    }): void;
    getAction(actionId: string): ActionAuditRecord | null;
    getActionsByGrant(grantId: string): ActionAuditRecord[];
    getAllActions(): ActionAuditRecord[];
    close(): void;
}
