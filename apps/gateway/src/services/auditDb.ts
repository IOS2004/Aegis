import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: any };
import type { ActionExecutionStatus, ActionReceipt, Hex, ToolName } from "@aegis/shared";

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

export class AuditDatabase {
  private db: DatabaseSync;

  constructor(dbPath: string = ":memory:") {
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS action_audit (
        actionId TEXT PRIMARY KEY,
        grantId TEXT NOT NULL,
        agentAddress TEXT NOT NULL,
        toolName TEXT NOT NULL,
        cost INTEGER NOT NULL,
        status TEXT NOT NULL,
        decisionReason TEXT,
        paramsJson TEXT NOT NULL,
        paramsHash TEXT NOT NULL,
        resultHash TEXT,
        outputSummary TEXT,
        txHash TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_grantId ON action_audit(grantId);
      CREATE INDEX IF NOT EXISTS idx_status ON action_audit(status);
    `);
  }

  public recordRequest(record: {
    actionId: Hex;
    grantId: Hex;
    agentAddress: Hex;
    toolName: ToolName;
    cost: number;
    params: Record<string, unknown>;
    paramsHash: Hex;
    status?: ActionExecutionStatus;
    decisionReason?: string;
  }): void {
    const now = Date.now();
    const insert = this.db.prepare(`
      INSERT INTO action_audit (
        actionId, grantId, agentAddress, toolName, cost, status, decisionReason,
        paramsJson, paramsHash, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(actionId) DO UPDATE SET
        status = excluded.status,
        decisionReason = excluded.decisionReason,
        paramsJson = excluded.paramsJson,
        paramsHash = excluded.paramsHash,
        updatedAt = excluded.updatedAt
    `);

    insert.run(
      record.actionId,
      record.grantId,
      record.agentAddress,
      record.toolName,
      record.cost,
      record.status ?? "REQUESTED",
      record.decisionReason ?? null,
      JSON.stringify(record.params),
      record.paramsHash,
      now,
      now
    );
  }

  public updateStatus(
    actionId: Hex,
    status: ActionExecutionStatus,
    extra?: {
      decisionReason?: string;
      resultHash?: Hex;
      outputSummary?: string;
      txHash?: Hex;
    }
  ): void {
    const now = Date.now();
    const update = this.db.prepare(`
      UPDATE action_audit SET
        status = ?,
        decisionReason = COALESCE(?, decisionReason),
        resultHash = COALESCE(?, resultHash),
        outputSummary = COALESCE(?, outputSummary),
        txHash = COALESCE(?, txHash),
        updatedAt = ?
      WHERE actionId = ?
    `);

    update.run(
      status,
      extra?.decisionReason ?? null,
      extra?.resultHash ?? null,
      extra?.outputSummary ?? null,
      extra?.txHash ?? null,
      now,
      actionId
    );
  }

  public getAction(actionId: string): ActionAuditRecord | null {
    const query = this.db.prepare(`SELECT * FROM action_audit WHERE actionId = ?`);
    const row = query.get(actionId);
    return (row as unknown as ActionAuditRecord) ?? null;
  }

  public getActionsByGrant(grantId: string): ActionAuditRecord[] {
    const query = this.db.prepare(`SELECT * FROM action_audit WHERE grantId = ? ORDER BY createdAt DESC`);
    return (query.all(grantId) as unknown as ActionAuditRecord[]) ?? [];
  }

  public getAllActions(): ActionAuditRecord[] {
    const query = this.db.prepare(`SELECT * FROM action_audit ORDER BY createdAt DESC`);
    return (query.all() as unknown as ActionAuditRecord[]) ?? [];
  }

  public close(): void {
    this.db.close();
  }
}
