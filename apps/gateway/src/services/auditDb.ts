// SPDX-License-Identifier: MIT
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: any };
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

import fs from "node:fs";
import path from "node:path";

export class AuditDatabase {
  private db: DatabaseSync;

  constructor(dbPath: string = ":memory:") {
    if (dbPath !== ":memory:") {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS actions (
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
        receiptTxHash TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actionId TEXT NOT NULL,
        eventType TEXT NOT NULL,
        previousStatus TEXT,
        newStatus TEXT,
        dataJson TEXT,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (actionId) REFERENCES actions(actionId)
      );

      CREATE INDEX IF NOT EXISTS idx_actions_grantId ON actions(grantId);
      CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);
      CREATE INDEX IF NOT EXISTS idx_events_actionId ON audit_events(actionId);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON audit_events(timestamp);
    `);
  }

  public appendEvent(event: {
    actionId: string;
    eventType: string;
    previousStatus?: string;
    newStatus?: string;
    dataJson?: string;
  }): void {
    const now = Date.now();
    const insert = this.db.prepare(`
      INSERT INTO audit_events (actionId, eventType, previousStatus, newStatus, dataJson, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      event.actionId,
      event.eventType,
      event.previousStatus ?? null,
      event.newStatus ?? null,
      event.dataJson ?? null,
      now
    );
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
  }): ActionAuditRecord {
    const existing = this.getAction(record.actionId);
    const now = Date.now();

    if (existing) {
      // Check if this is an idempotent duplicate or a conflicting request
      const isSame =
        existing.grantId.toLowerCase() === record.grantId.toLowerCase() &&
        existing.toolName === record.toolName &&
        existing.cost === record.cost &&
        existing.paramsHash.toLowerCase() === record.paramsHash.toLowerCase();

      if (isSame) {
        this.appendEvent({
          actionId: record.actionId,
          eventType: "DUPLICATE_REQUEST_RECORDED",
          previousStatus: existing.status,
          newStatus: existing.status,
          dataJson: JSON.stringify({ message: "Idempotent duplicate action request received" }),
        });
        return existing;
      } else {
        this.appendEvent({
          actionId: record.actionId,
          eventType: "CONFLICTING_REQUEST_REJECTED",
          previousStatus: existing.status,
          newStatus: existing.status,
          dataJson: JSON.stringify({
            existing: {
              grantId: existing.grantId,
              toolName: existing.toolName,
              cost: existing.cost,
              paramsHash: existing.paramsHash,
            },
            attempted: {
              grantId: record.grantId,
              toolName: record.toolName,
              cost: record.cost,
              paramsHash: record.paramsHash,
            },
          }),
        });
        throw new Error(
          `ERR_ACTION_ID_CONFLICT: Action with ID ${record.actionId} already exists with conflicting parameters`
        );
      }
    }

    const initialStatus = record.status ?? "REQUESTED";
    const insert = this.db.prepare(`
      INSERT INTO actions (
        actionId, grantId, agentAddress, toolName, cost, status, decisionReason,
        paramsJson, paramsHash, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      record.actionId,
      record.grantId,
      record.agentAddress,
      record.toolName,
      record.cost,
      initialStatus,
      record.decisionReason ?? null,
      JSON.stringify(record.params),
      record.paramsHash,
      now,
      now
    );

    this.appendEvent({
      actionId: record.actionId,
      eventType: "REQUEST_RECORDED",
      previousStatus: undefined,
      newStatus: initialStatus,
      dataJson: JSON.stringify({
        toolName: record.toolName,
        cost: record.cost,
        decisionReason: record.decisionReason,
      }),
    });

    return this.getAction(record.actionId)!;
  }

  public updateStatus(
    actionId: Hex | string,
    status: ActionExecutionStatus,
    extra?: {
      decisionReason?: string;
      resultHash?: Hex;
      outputSummary?: string;
      txHash?: Hex;
      receiptTxHash?: Hex;
    }
  ): void {
    const existing = this.getAction(actionId);
    const now = Date.now();

    const update = this.db.prepare(`
      UPDATE actions SET
        status = ?,
        decisionReason = COALESCE(?, decisionReason),
        resultHash = COALESCE(?, resultHash),
        outputSummary = COALESCE(?, outputSummary),
        txHash = COALESCE(?, txHash),
        receiptTxHash = COALESCE(?, receiptTxHash),
        updatedAt = ?
      WHERE actionId = ?
    `);

    update.run(
      status,
      extra?.decisionReason ?? null,
      extra?.resultHash ?? null,
      extra?.outputSummary ?? null,
      extra?.txHash ?? null,
      extra?.receiptTxHash ?? null,
      now,
      actionId
    );

    this.appendEvent({
      actionId,
      eventType: "STATUS_CHANGED",
      previousStatus: existing?.status,
      newStatus: status,
      dataJson: extra ? JSON.stringify(extra) : null,
    });
  }

  /**
   * Idempotent receipt registration.
   * - If no receipt is present: sets resultHash, records event.
   * - If same resultHash is present: idempotent no-op / updates receiptTxHash if newly available.
   * - If conflicting resultHash is present: throws ERR_CONFLICTING_RECEIPT and logs security event.
   */
  public recordReceipt(
    actionId: Hex | string,
    resultHash: Hex | string,
    extra?: {
      outputSummary?: string;
      receiptTxHash?: Hex;
      status?: ActionExecutionStatus;
    }
  ): { success: boolean; alreadyAnchored: boolean } {
    const action = this.getAction(actionId);
    if (!action) {
      throw new Error(`ERR_ACTION_NOT_FOUND: Action ${actionId} does not exist`);
    }

    const now = Date.now();

    if (action.resultHash) {
      if (action.resultHash.toLowerCase() === resultHash.toLowerCase()) {
        // Idempotent duplicate
        if (extra?.receiptTxHash && !action.receiptTxHash) {
          const update = this.db.prepare(`
            UPDATE actions SET
              receiptTxHash = ?,
              status = ?,
              updatedAt = ?
            WHERE actionId = ?
          `);
          update.run(extra.receiptTxHash, extra.status ?? "EXECUTED", now, actionId);
        }

        this.appendEvent({
          actionId,
          eventType: "DUPLICATE_RECEIPT_SUBMITTED",
          previousStatus: action.status,
          newStatus: extra?.status ?? action.status,
          dataJson: JSON.stringify({ resultHash, isDuplicate: true }),
        });

        return { success: true, alreadyAnchored: Boolean(action.receiptTxHash || extra?.receiptTxHash) };
      } else {
        // Conflicting receipt! Reject immediately and preserve original execution evidence!
        this.appendEvent({
          actionId,
          eventType: "CONFLICTING_RECEIPT_REJECTED",
          previousStatus: action.status,
          newStatus: action.status,
          dataJson: JSON.stringify({
            existingResultHash: action.resultHash,
            attemptedResultHash: resultHash,
          }),
        });
        throw new Error(
          `ERR_CONFLICTING_RECEIPT: Action ${actionId} already has immutable resultHash ${action.resultHash}, conflicting with ${resultHash}`
        );
      }
    }

    const newStatus = extra?.status ?? (extra?.receiptTxHash ? "EXECUTED" : "UNANCHORED");
    const update = this.db.prepare(`
      UPDATE actions SET
        resultHash = ?,
        outputSummary = COALESCE(?, outputSummary),
        receiptTxHash = COALESCE(?, receiptTxHash),
        status = ?,
        updatedAt = ?
      WHERE actionId = ?
    `);

    update.run(
      resultHash,
      extra?.outputSummary ?? null,
      extra?.receiptTxHash ?? null,
      newStatus,
      now,
      actionId
    );

    this.appendEvent({
      actionId,
      eventType: extra?.receiptTxHash ? "RECEIPT_ANCHORED" : "RECEIPT_RECORDED_UNANCHORED",
      previousStatus: action.status,
      newStatus,
      dataJson: JSON.stringify({ resultHash, extra }),
    });

    return { success: true, alreadyAnchored: Boolean(extra?.receiptTxHash) };
  }

  public getAction(actionId: string): ActionAuditRecord | null {
    const query = this.db.prepare(`SELECT * FROM actions WHERE actionId = ?`);
    const row = query.get(actionId);
    return (row as unknown as ActionAuditRecord) ?? null;
  }

  public getEventsForAction(actionId: string): AuditEventRecord[] {
    const query = this.db.prepare(`SELECT * FROM audit_events WHERE actionId = ? ORDER BY id ASC`);
    return (query.all(actionId) as unknown as AuditEventRecord[]) ?? [];
  }

  public getAllEvents(): AuditEventRecord[] {
    const query = this.db.prepare(`SELECT * FROM audit_events ORDER BY id DESC`);
    return (query.all() as unknown as AuditEventRecord[]) ?? [];
  }

  public getActionsByGrant(grantId: string): ActionAuditRecord[] {
    const query = this.db.prepare(`SELECT * FROM actions WHERE grantId = ? ORDER BY createdAt DESC`);
    return (query.all(grantId) as unknown as ActionAuditRecord[]) ?? [];
  }

  public getAllActions(): ActionAuditRecord[] {
    const query = this.db.prepare(`SELECT * FROM actions ORDER BY createdAt DESC`);
    return (query.all() as unknown as ActionAuditRecord[]) ?? [];
  }

  public getUnanchoredActions(): ActionAuditRecord[] {
    const query = this.db.prepare(`
      SELECT * FROM actions
      WHERE status = 'UNANCHORED' OR (resultHash IS NOT NULL AND receiptTxHash IS NULL AND status != 'FAILED' AND status != 'DENIED')
      ORDER BY createdAt DESC
    `);
    return (query.all() as unknown as ActionAuditRecord[]) ?? [];
  }

  public close(): void {
    this.db.close();
  }
}
