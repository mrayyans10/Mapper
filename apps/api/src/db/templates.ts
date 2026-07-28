import Database from "better-sqlite3";
import type { RuleTemplate } from "@mapping-assurance/core";
import { getDb } from "./projects.js";

export function ensureTemplateSchema(database?: Database.Database): void {
  const db = database ?? getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS rule_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function listTemplates(): RuleTemplate[] {
  ensureTemplateSchema();
  const rows = getDb()
    .prepare(`SELECT payload FROM rule_templates ORDER BY updated_at DESC`)
    .all() as Array<{ payload: string }>;
  return rows.map((r) => JSON.parse(r.payload) as RuleTemplate);
}

export function getTemplate(id: string): RuleTemplate | null {
  ensureTemplateSchema();
  const row = getDb()
    .prepare(`SELECT payload FROM rule_templates WHERE id = ?`)
    .get(id) as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as RuleTemplate) : null;
}

export function upsertTemplate(template: RuleTemplate): RuleTemplate {
  ensureTemplateSchema();
  const existing = getTemplate(template.id);
  const now = new Date().toISOString();
  const next: RuleTemplate = {
    ...template,
    createdAt: existing?.createdAt ?? template.createdAt ?? now,
    updatedAt: now,
  };
  getDb()
    .prepare(
      `INSERT INTO rule_templates (id, name, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
    )
    .run(
      next.id,
      next.name,
      JSON.stringify(next),
      next.createdAt,
      next.updatedAt,
    );
  return next;
}

export function deleteTemplate(id: string): boolean {
  ensureTemplateSchema();
  const result = getDb()
    .prepare(`DELETE FROM rule_templates WHERE id = ?`)
    .run(id);
  return result.changes > 0;
}
