import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type {
  FieldMapping,
  MappingProject,
  RuleGroup,
  SchemaTree,
  ValidationReport,
} from "@mapping-assurance/core";
import {
  PROJECT_SCHEMA_VERSION_V1,
  PROJECT_SCHEMA_VERSION_V2,
  migrateProjectV1toV2,
  needsMigration,
} from "@mapping-assurance/core";

export interface ProjectRow {
  id: string;
  name: string;
  source_json: string;
  target_json: string;
  source_schema: string;
  target_schema: string;
  mappings: string;
  validation_report: string | null;
  created_at: string;
  updated_at: string;
  schema_version?: number | null;
  rule_groups?: string | null;
}

let db: Database.Database | null = null;

function tryAddColumn(
  database: Database.Database,
  ddl: string,
): void {
  try {
    database.exec(ddl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/duplicate column/i.test(message)) {
      throw err;
    }
  }
}

/** Idempotent additive schema upgrades (rollback-safe). */
export function ensureProjectSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_json TEXT NOT NULL,
      target_json TEXT NOT NULL,
      source_schema TEXT NOT NULL,
      target_schema TEXT NOT NULL,
      mappings TEXT NOT NULL,
      validation_report TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  tryAddColumn(
    database,
    `ALTER TABLE projects ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1`,
  );
  tryAddColumn(
    database,
    `ALTER TABLE projects ADD COLUMN rule_groups TEXT NOT NULL DEFAULT '[]'`,
  );
}

export function getDb(dbPath?: string): Database.Database {
  if (db) return db;
  const resolved =
    dbPath ??
    process.env.MAPPING_ASSURANCE_DB ??
    path.join(process.cwd(), "data", "mapping-assurance.sqlite");
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  db = new Database(resolved);
  db.pragma("journal_mode = WAL");
  ensureProjectSchema(db);
  return db;
}

export function resetDbForTests(dbPath: string): Database.Database {
  if (db) {
    db.close();
    db = null;
  }
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  return getDb(dbPath);
}

export function rowToProject(row: ProjectRow): MappingProject {
  const mappings = JSON.parse(row.mappings) as FieldMapping[];
  const schemaVersion =
    row.schema_version === PROJECT_SCHEMA_VERSION_V2
      ? PROJECT_SCHEMA_VERSION_V2
      : PROJECT_SCHEMA_VERSION_V1;

  let ruleGroups: RuleGroup[] = [];
  if (row.rule_groups) {
    try {
      ruleGroups = JSON.parse(row.rule_groups) as RuleGroup[];
    } catch {
      ruleGroups = [];
    }
  }

  let project: MappingProject = {
    id: row.id,
    name: row.name,
    schemaVersion,
    sourceJson: row.source_json,
    targetJson: row.target_json,
    sourceSchema: JSON.parse(row.source_schema) as SchemaTree,
    targetSchema: JSON.parse(row.target_schema) as SchemaTree,
    ruleGroups,
    mappings,
    validationReport: row.validation_report
      ? (JSON.parse(row.validation_report) as ValidationReport)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  // Migrate-on-read: if still v1, or v2 with empty ruleGroups but mappings present.
  if (
    needsMigration(project) ||
    (project.schemaVersion === PROJECT_SCHEMA_VERSION_V2 &&
      project.ruleGroups.length === 0 &&
      project.mappings.length > 0)
  ) {
    project = migrateProjectV1toV2(project, {
      force:
        project.schemaVersion === PROJECT_SCHEMA_VERSION_V2 &&
        project.ruleGroups.length === 0 &&
        project.mappings.length > 0,
    });
  }

  return project;
}

export function listProjects(): MappingProject[] {
  const rows = getDb()
    .prepare(`SELECT * FROM projects ORDER BY updated_at DESC`)
    .all() as ProjectRow[];
  return rows.map(rowToProject);
}

export function getProject(id: string): MappingProject | null {
  const row = getDb()
    .prepare(`SELECT * FROM projects WHERE id = ?`)
    .get(id) as ProjectRow | undefined;
  return row ? rowToProject(row) : null;
}

function persistColumns(project: MappingProject) {
  return {
    schemaVersion: project.schemaVersion ?? PROJECT_SCHEMA_VERSION_V1,
    ruleGroupsJson: JSON.stringify(project.ruleGroups ?? []),
  };
}

export function insertProject(project: MappingProject): MappingProject {
  const { schemaVersion, ruleGroupsJson } = persistColumns(project);
  getDb()
    .prepare(
      `INSERT INTO projects (
        id, name, source_json, target_json, source_schema, target_schema,
        mappings, validation_report, created_at, updated_at,
        schema_version, rule_groups
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      project.id,
      project.name,
      project.sourceJson,
      project.targetJson,
      JSON.stringify(project.sourceSchema),
      JSON.stringify(project.targetSchema),
      JSON.stringify(project.mappings),
      project.validationReport
        ? JSON.stringify(project.validationReport)
        : null,
      project.createdAt,
      project.updatedAt,
      schemaVersion,
      ruleGroupsJson,
    );
  return project;
}

export function updateProjectRecord(project: MappingProject): MappingProject {
  const { schemaVersion, ruleGroupsJson } = persistColumns(project);
  getDb()
    .prepare(
      `UPDATE projects SET
        name = ?,
        source_json = ?,
        target_json = ?,
        source_schema = ?,
        target_schema = ?,
        mappings = ?,
        validation_report = ?,
        updated_at = ?,
        schema_version = ?,
        rule_groups = ?
      WHERE id = ?`,
    )
    .run(
      project.name,
      project.sourceJson,
      project.targetJson,
      JSON.stringify(project.sourceSchema),
      JSON.stringify(project.targetSchema),
      JSON.stringify(project.mappings),
      project.validationReport
        ? JSON.stringify(project.validationReport)
        : null,
      project.updatedAt,
      schemaVersion,
      ruleGroupsJson,
      project.id,
    );
  return project;
}

/** Persist an in-memory migrated project (dual-write). */
export function persistMigratedProject(project: MappingProject): MappingProject {
  const migrated = migrateProjectV1toV2(project);
  return updateProjectRecord({
    ...migrated,
    updatedAt: new Date().toISOString(),
  });
}

export function deleteProject(id: string): boolean {
  const result = getDb().prepare(`DELETE FROM projects WHERE id = ?`).run(id);
  return result.changes > 0;
}
