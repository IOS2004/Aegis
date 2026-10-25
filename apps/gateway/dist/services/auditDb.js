// SPDX-License-Identifier: MIT
import { DatabaseSync } from "node:sqlite";
export class AuditDatabase {
    db;
    constructor(dbPath = ":memory:") {
        this.db = new DatabaseSync(dbPath);
        this.init();
    }
    init() {
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
    recordRequest(record) {
        const now = Date.now();
        const insert = this.db.prepare(`
      INSERT INTO action_audit (
        actionId, grantId, agentAddress, toolName, cost, status, decisionReason,
        paramsJson, paramsHash, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        insert.run(record.actionId, record.grantId, record.agentAddress, record.toolName, record.cost, record.status ?? "REQUESTED", record.decisionReason ?? null, JSON.stringify(record.params), record.paramsHash, now, now);
    }
    updateStatus(actionId, status, extra) {
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
        update.run(status, extra?.decisionReason ?? null, extra?.resultHash ?? null, extra?.outputSummary ?? null, extra?.txHash ?? null, now, actionId);
    }
    getAction(actionId) {
        const query = this.db.prepare(`SELECT * FROM action_audit WHERE actionId = ?`);
        const row = query.get(actionId);
        return row ?? null;
    }
    getActionsByGrant(grantId) {
        const query = this.db.prepare(`SELECT * FROM action_audit WHERE grantId = ? ORDER BY createdAt DESC`);
        return query.all(grantId) ?? [];
    }
    getAllActions() {
        const query = this.db.prepare(`SELECT * FROM action_audit ORDER BY createdAt DESC`);
        return query.all() ?? [];
    }
    close() {
        this.db.close();
    }
}
