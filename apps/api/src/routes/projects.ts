import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import {
  applyRequiredOverrides,
  exportMappingReportCsv,
  exportMappingReportMarkdown,
  exportMappingsJson,
  exportValidationReportJson,
  inferSchema,
  migrateProjectV1toV2,
  parseJsonDocument,
  previewRuleGroups,
  validateMappings,
  validateProjectRules,
  validateRuleGroups,
  type FieldMapping,
  type MappingProject,
  type RuleGroup,
} from "@mapping-assurance/core";
import {
  deleteProject,
  getProject,
  insertProject,
  listProjects,
  updateProjectRecord,
} from "../db/projects.js";

function onlyLegacyRuleGroups(groups: RuleGroup[]): boolean {
  if (groups.length === 0) return true;
  return groups.every((g) =>
    g.rules.every((r) => r.migrationSource === "FIELD_MAPPING_V1"),
  );
}

const mappingSchema = z.object({
  id: z.string().min(1),
  sourcePath: z.string().min(1),
  targetPath: z.string().min(1),
  transformationNote: z.string().optional(),
  rationale: z.string().optional(),
  status: z.enum(["draft", "reviewed", "approved"]),
});

const createBodySchema = z.object({
  name: z.string().min(1).max(200),
  sourceJson: z.string().min(1),
  targetJson: z.string().min(1),
});

const updateBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sourceJson: z.string().min(1).optional(),
  targetJson: z.string().min(1).optional(),
  mappings: z.array(mappingSchema).optional(),
  requiredOverrides: z
    .object({
      source: z.record(z.boolean()).optional(),
      target: z.record(z.boolean()).optional(),
    })
    .optional(),
  runValidation: z.boolean().optional(),
});

const inferBodySchema = z.object({
  sourceJson: z.string().min(1),
  targetJson: z.string().min(1),
  requiredOverrides: z
    .object({
      source: z.record(z.boolean()).optional(),
      target: z.record(z.boolean()).optional(),
    })
    .optional(),
});

const validateBodySchema = z.object({
  sourceSchema: z.object({
    rootPath: z.string(),
    nodes: z.record(z.any()),
  }),
  targetSchema: z.object({
    rootPath: z.string(),
    nodes: z.record(z.any()),
  }),
  mappings: z.array(mappingSchema).optional(),
  ruleGroups: z.array(z.any()).optional(),
  requireFallback: z.boolean().optional(),
});

const previewBodySchema = z.object({
  sourceJson: z.string().min(1),
  targetJson: z.string().optional(),
  ruleGroups: z.array(z.any()).min(1),
});

function buildSchemas(
  sourceJson: string,
  targetJson: string,
  requiredOverrides?: {
    source?: Record<string, boolean>;
    target?: Record<string, boolean>;
  },
):
  | { ok: true; sourceSchema: ReturnType<typeof inferSchema>; targetSchema: ReturnType<typeof inferSchema> }
  | { ok: false; status: number; error: string } {
  const sourceParsed = parseJsonDocument(sourceJson);
  if (!sourceParsed.ok) {
    return { ok: false, status: 400, error: `Source JSON: ${sourceParsed.error}` };
  }
  const targetParsed = parseJsonDocument(targetJson);
  if (!targetParsed.ok) {
    return { ok: false, status: 400, error: `Target JSON: ${targetParsed.error}` };
  }

  let sourceSchema = inferSchema(sourceParsed.value);
  let targetSchema = inferSchema(targetParsed.value);
  sourceSchema = applyRequiredOverrides(sourceSchema, requiredOverrides?.source);
  targetSchema = applyRequiredOverrides(targetSchema, requiredOverrides?.target);
  return { ok: true, sourceSchema, targetSchema };
}

export function createProjectsRouter(): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ projects: listProjects() });
  });

  router.get("/:id", (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    res.json({ project });
  });

  router.post("/", (req, res) => {
    const parsed = createBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const schemas = buildSchemas(parsed.data.sourceJson, parsed.data.targetJson);
    if (!schemas.ok) {
      res.status(schemas.status).json({ error: schemas.error });
      return;
    }

    const now = new Date().toISOString();
    const project: MappingProject = {
      id: randomUUID(),
      name: parsed.data.name,
      schemaVersion: 2,
      sourceJson: parsed.data.sourceJson,
      targetJson: parsed.data.targetJson,
      sourceSchema: schemas.sourceSchema,
      targetSchema: schemas.targetSchema,
      ruleGroups: [],
      mappings: [],
      validationReport: null,
      createdAt: now,
      updatedAt: now,
    };
    insertProject(project);
    res.status(201).json({ project });
  });

  router.put("/:id", (req, res) => {
    const existing = getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Project not found." });
      return;
    }

    const parsed = updateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const sourceJson = parsed.data.sourceJson ?? existing.sourceJson;
    const targetJson = parsed.data.targetJson ?? existing.targetJson;
    const mappings = (parsed.data.mappings ?? existing.mappings) as FieldMapping[];

    // Preserve existing required flags unless overrides provided
    const existingSourceRequired: Record<string, boolean> = {};
    const existingTargetRequired: Record<string, boolean> = {};
    for (const [path, node] of Object.entries(existing.sourceSchema.nodes)) {
      existingSourceRequired[path] = node.required;
    }
    for (const [path, node] of Object.entries(existing.targetSchema.nodes)) {
      existingTargetRequired[path] = node.required;
    }

    const schemas = buildSchemas(sourceJson, targetJson, {
      source: {
        ...existingSourceRequired,
        ...(parsed.data.requiredOverrides?.source ?? {}),
      },
      target: {
        ...existingTargetRequired,
        ...(parsed.data.requiredOverrides?.target ?? {}),
      },
    });
    if (!schemas.ok) {
      res.status(schemas.status).json({ error: schemas.error });
      return;
    }

    const shouldValidate =
      parsed.data.runValidation === true ||
      parsed.data.mappings !== undefined ||
      parsed.data.requiredOverrides !== undefined;

    let project: MappingProject = {
      ...existing,
      name: parsed.data.name ?? existing.name,
      sourceJson,
      targetJson,
      sourceSchema: schemas.sourceSchema,
      targetSchema: schemas.targetSchema,
      mappings,
      updatedAt: new Date().toISOString(),
    };

    // Dual-write: keep ruleGroups in sync for legacy-only projects when mappings change.
    if (
      parsed.data.mappings !== undefined &&
      onlyLegacyRuleGroups(existing.ruleGroups)
    ) {
      project = migrateProjectV1toV2(
        { ...project, schemaVersion: 1 },
        { force: true },
      );
    } else if (project.schemaVersion < 2) {
      project = migrateProjectV1toV2(project);
    }

    project.validationReport = shouldValidate
      ? project.ruleGroups.length > 0
        ? validateProjectRules(
            {
              ruleGroups: project.ruleGroups,
              sourceSchema: schemas.sourceSchema,
              targetSchema: schemas.targetSchema,
              mappings,
            },
            { includeLegacyMappingValidation: mappings.length > 0 },
          )
        : validateMappings(
            schemas.sourceSchema,
            schemas.targetSchema,
            mappings,
          )
      : existing.validationReport;

    updateProjectRecord(project);
    res.json({ project });
  });

  router.post("/:id/validate", (req, res) => {
    const existing = getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Project not found." });
      return;
    }

    const report =
      existing.ruleGroups.length > 0
        ? validateProjectRules(existing, {
            includeLegacyMappingValidation: existing.mappings.length > 0,
          })
        : validateMappings(
            existing.sourceSchema,
            existing.targetSchema,
            existing.mappings,
          );

    const project: MappingProject = {
      ...existing,
      validationReport: report,
      updatedAt: new Date().toISOString(),
    };
    updateProjectRecord(project);
    res.json({ project, report });
  });

  router.post("/:id/preview", (req, res) => {
    const existing = getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    const sourceParsed = parseJsonDocument(existing.sourceJson);
    if (!sourceParsed.ok) {
      res.status(400).json({ error: sourceParsed.error });
      return;
    }
    let targetDocument: unknown | undefined;
    if (typeof req.body?.targetJson === "string" && req.body.targetJson.trim()) {
      const targetParsed = parseJsonDocument(req.body.targetJson);
      if (!targetParsed.ok) {
        res.status(400).json({ error: targetParsed.error });
        return;
      }
      targetDocument = targetParsed.value;
    } else {
      const targetParsed = parseJsonDocument(existing.targetJson);
      if (targetParsed.ok) targetDocument = targetParsed.value;
    }

    const preview = previewRuleGroups(existing.ruleGroups, sourceParsed.value, {
      targetDocument,
    });
    res.json({ preview });
  });
  router.delete("/:id", (req, res) => {
    const ok = deleteProject(req.params.id);
    if (!ok) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    res.status(204).send();
  });

  router.get("/:id/export/:format", (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found." });
      return;
    }

    const format = req.params.format;
    const safeName = project.name.replace(/[^a-zA-Z0-9_-]+/g, "_");

    switch (format) {
      case "mappings.json": {
        res.setHeader("Content-Type", "application/json");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeName}-mappings.json"`,
        );
        res.send(exportMappingsJson(project.mappings));
        return;
      }
      case "report.json": {
        if (!project.validationReport) {
          res.status(400).json({
            error: "No validation report yet. Run validation first.",
          });
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeName}-report.json"`,
        );
        res.send(exportValidationReportJson(project.validationReport));
        return;
      }
      case "report.md": {
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeName}-report.md"`,
        );
        res.send(
          exportMappingReportMarkdown({
            name: project.name,
            mappings: project.mappings,
            validationReport: project.validationReport,
          }),
        );
        return;
      }
      case "mappings.csv": {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeName}-mappings.csv"`,
        );
        res.send(exportMappingReportCsv(project.mappings));
        return;
      }
      default:
        res.status(400).json({
          error:
            "Unknown export format. Use mappings.json, report.json, report.md, or mappings.csv.",
        });
    }
  });

  return router;
}

export function createUtilityRouter(): Router {
  const router = Router();

  router.post("/infer", (req, res) => {
    const parsed = inferBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const schemas = buildSchemas(
      parsed.data.sourceJson,
      parsed.data.targetJson,
      parsed.data.requiredOverrides,
    );
    if (!schemas.ok) {
      res.status(schemas.status).json({ error: schemas.error });
      return;
    }
    res.json({
      sourceSchema: schemas.sourceSchema,
      targetSchema: schemas.targetSchema,
    });
  });

  router.post("/validate", (req, res) => {
    const parsed = validateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const sourceSchema =
      parsed.data.sourceSchema as MappingProject["sourceSchema"];
    const targetSchema =
      parsed.data.targetSchema as MappingProject["targetSchema"];

    if (parsed.data.ruleGroups && parsed.data.ruleGroups.length > 0) {
      const ruleReport = validateRuleGroups(
        parsed.data.ruleGroups as RuleGroup[],
        sourceSchema,
        targetSchema,
        { requireFallback: parsed.data.requireFallback },
      );
      const report = validateProjectRules(
        {
          ruleGroups: parsed.data.ruleGroups as RuleGroup[],
          sourceSchema,
          targetSchema,
          mappings: parsed.data.mappings,
        },
        {
          requireFallback: parsed.data.requireFallback,
          includeLegacyMappingValidation: Boolean(parsed.data.mappings?.length),
        },
      );
      res.json({ report, ruleReport });
      return;
    }

    if (!parsed.data.mappings) {
      res.status(400).json({
        error: "Provide mappings (legacy) and/or ruleGroups for validation.",
      });
      return;
    }

    const report = validateMappings(
      sourceSchema,
      targetSchema,
      parsed.data.mappings,
    );
    res.json({ report });
  });

  router.post("/preview", (req, res) => {
    const parsed = previewBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const sourceParsed = parseJsonDocument(parsed.data.sourceJson);
    if (!sourceParsed.ok) {
      res.status(400).json({ error: `Source JSON: ${sourceParsed.error}` });
      return;
    }
    let targetDocument: unknown | undefined;
    if (parsed.data.targetJson) {
      const targetParsed = parseJsonDocument(parsed.data.targetJson);
      if (!targetParsed.ok) {
        res.status(400).json({ error: `Target JSON: ${targetParsed.error}` });
        return;
      }
      targetDocument = targetParsed.value;
    }
    const preview = previewRuleGroups(
      parsed.data.ruleGroups as RuleGroup[],
      sourceParsed.value,
      { targetDocument },
    );
    res.json({ preview });
  });

  return router;
}
