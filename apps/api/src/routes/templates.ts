import { Router } from "express";
import type { Database } from "better-sqlite3";
import {
  ruleToTemplate,
  instantiateTemplate,
  type Rule,
  type RuleTemplate,
} from "@mapping-assurance/core";
import {
  listTemplates,
  getTemplate,
  upsertTemplate,
  deleteTemplate,
} from "../db/templates.js";

export function createTemplatesRouter(_db: Database): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ templates: listTemplates() });
  });

  router.get("/:id", (req, res) => {
    const row = getTemplate(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json(row);
  });

  router.post("/", (req, res) => {
    const body = req.body as {
      name?: string;
      description?: string;
      suggestedExecutionMode?: "first-match" | "all-match";
      rule?: Rule;
      template?: RuleTemplate;
    };

    let template: RuleTemplate;
    if (body.template) {
      template = {
        ...body.template,
        name: body.name ?? body.template.name,
        description: body.description ?? body.template.description,
        suggestedExecutionMode:
          body.suggestedExecutionMode ?? body.template.suggestedExecutionMode,
      };
    } else if (body.rule && body.name) {
      template = ruleToTemplate(body.rule, {
        name: body.name,
        description: body.description,
        suggestedExecutionMode: body.suggestedExecutionMode,
      });
    } else {
      res.status(400).json({ error: "Provide template or rule+name" });
      return;
    }

    const saved = upsertTemplate(template);
    res.status(201).json(saved);
  });

  router.put("/:id", (req, res) => {
    const existing = getTemplate(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    const body = req.body as Partial<RuleTemplate> & { rule?: Rule };
    let next: RuleTemplate;
    if (body.rule) {
      next = {
        ...ruleToTemplate(body.rule, {
          name: body.name ?? existing.name,
          description: body.description ?? existing.description,
          suggestedExecutionMode:
            body.suggestedExecutionMode ?? existing.suggestedExecutionMode,
        }),
        id: existing.id,
        createdAt: existing.createdAt,
      };
    } else {
      next = {
        ...existing,
        ...body,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
    }
    res.json(upsertTemplate(next));
  });

  router.delete("/:id", (req, res) => {
    const ok = deleteTemplate(req.params.id);
    if (!ok) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.status(204).send();
  });

  router.post("/:id/instantiate", (req, res) => {
    const row = getTemplate(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    const body = req.body as {
      sourceNodePath?: string;
      destinationNodePath?: string;
      sourceNode?: string;
      destinationNode?: string;
      name?: string;
      priority?: number;
    };
    const sourceNode = body.sourceNode ?? body.sourceNodePath;
    const destinationNode = body.destinationNode ?? body.destinationNodePath;
    if (!sourceNode || !destinationNode) {
      res.status(400).json({
        error: "sourceNode and destinationNode are required",
      });
      return;
    }
    const rule = instantiateTemplate({
      template: row,
      sourceNode,
      destinationNode,
      name: body.name,
      priority: body.priority,
    });
    res.json({ rule });
  });

  return router;
}
