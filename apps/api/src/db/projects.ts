import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type {
  FieldMapping,
  MappingProject,
  SchemaTree,
  ValidationReport,
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
}

let db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (db) return db;
  const resolved =
    dbPath ??
    process.env.MAPPING_ASSURANCE_DB ??
    path.join(process.cwd(), "data", "mapping-assurance.sqlite");
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  db = new Database(resolved);
  db.pragma("journal_mode = WAL");
  db.exec(`
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
  return {
    id: row.id,
    name: row.name,
    sourceJson: row.source_json,
    targetJson: row.target_json,
    sourceSchema: JSON.parse(row.source_schema) as SchemaTree,
    targetSchema: JSON.parse(row.target_schema) as SchemaTree,
    mappings: JSON.parse(row.mappings) as FieldMapping[],
    validationReport: row.validation_report
      ? (JSON.parse(row.validation_report) as ValidationReport)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProjects(): MappingProject[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM projects ORDER BY updated_at DESC`,
    )
    .all() as ProjectRow[];
  return rows.map(rowToProject);
}

export function getProject(id: string): MappingProject | null {
  const row = getDb()
    .prepare(`SELECT * FROM projects WHERE id = ?`)
    .get(id) as ProjectRow | undefined;
  return row ? rowToProject(row) : null;
}

export function insertProject(project: MappingProject): MappingProject {
  getDb()
    .prepare(
      `INSERT INTO projects (
        id, name, source_json, target_json, source_schema, target_schema,
        mappings, validation_report, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    );
  return project;
}

export function updateProjectRecord(project: MappingProject): MappingProject {
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
        updated_at = ?
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
      project.id,
    );
  return project;
}

export function deleteProject(id: string): boolean {
  const result = getDb().prepare(`DELETE FROM projects WHERE id = ?`).run(id);
  return result.changes > 0;
}
