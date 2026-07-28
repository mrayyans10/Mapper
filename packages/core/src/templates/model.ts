import type {
  ChildMapping,
  ConditionExpr,
  Rule,
  RuleCopyMode,
  RuleKind,
} from "../rule/types.js";

/** Placeholders for project-specific paths. */
export const TEMPLATE_SOURCE_PLACEHOLDER = "{{SOURCE}}";
export const TEMPLATE_DEST_PLACEHOLDER = "{{DEST}}";

export interface RuleTemplate {
  id: string;
  name: string;
  description?: string;
  /** Suggested execution mode when instantiating into a new group. */
  suggestedExecutionMode: "first-match" | "all-match";
  kind: RuleKind;
  copyMode?: RuleCopyMode;
  /** Condition with paths preferably relative or placeholder-based. */
  condition?: ConditionExpr;
  /** Child mappings (relative paths — portable). */
  childMappings: Array<Omit<ChildMapping, "id" | "status"> & { status?: ChildMapping["status"] }>;
  metadata?: Record<string, unknown>;
  rationale?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstantiateTemplateInput {
  template: RuleTemplate;
  sourceNode: string;
  destinationNode: string;
  ruleId?: string;
  name?: string;
  priority?: number;
}

/**
 * Capture a rule as a reusable template.
 * Replaces absolute source/destination nodes with placeholders.
 * Keeps relative child paths as-is.
 */
export function ruleToTemplate(
  rule: Rule,
  options: {
    name: string;
    description?: string;
    suggestedExecutionMode?: "first-match" | "all-match";
  },
): RuleTemplate {
  const now = new Date().toISOString();
  return {
    id: `tpl_${Math.random().toString(36).slice(2, 10)}`,
    name: options.name,
    description: options.description,
    suggestedExecutionMode: options.suggestedExecutionMode ?? "first-match",
    kind: rule.kind,
    copyMode: rule.copyMode,
    condition: rule.condition
      ? rewriteConditionPaths(rule.condition, rule.sourceNode)
      : undefined,
    childMappings: rule.childMappings.map((c) => ({
      sourcePath: c.sourcePath,
      targetPath: c.targetPath,
      transformationNote: c.transformationNote,
      transformation: c.transformation,
      rationale: c.rationale,
      status: c.status,
    })),
    metadata: rule.metadata,
    rationale: rule.rationale,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Instantiate a template into a concrete Rule with project paths.
 */
export function instantiateTemplate(input: InstantiateTemplateInput): Rule {
  const { template, sourceNode, destinationNode } = input;
  return {
    id: input.ruleId ?? `rule_${Math.random().toString(36).slice(2, 9)}`,
    name: input.name ?? template.name,
    category: "routing",
    sourceNode,
    destinationNode,
    kind: template.kind,
    condition: template.condition
      ? materializeConditionPaths(template.condition, sourceNode)
      : template.kind === "conditional"
        ? undefined
        : undefined,
    priority: input.priority ?? 10,
    enabled: true,
    childMappings: template.childMappings.map((c, i) => ({
      id: `child_${i}_${Math.random().toString(36).slice(2, 7)}`,
      sourcePath: c.sourcePath,
      targetPath: c.targetPath,
      transformationNote: c.transformationNote,
      transformation: c.transformation,
      rationale: c.rationale,
      status: c.status ?? "draft",
    })),
    copyMode:
      template.copyMode ??
      (template.childMappings.length > 0
        ? "APPLY_CHILD_MAPPINGS"
        : "ROUTE_ONLY"),
    metadata: {
      ...(template.metadata ?? {}),
      fromTemplateId: template.id,
      fromTemplateName: template.name,
    },
    rationale: template.rationale,
    status: "draft",
  };
}

function rewriteConditionPaths(
  expr: ConditionExpr,
  sourceNode: string,
): ConditionExpr {
  switch (expr.type) {
    case "atom": {
      let path = expr.atom.path;
      if (path.startsWith(sourceNode + ".")) {
        path = path.slice(sourceNode.length + 1);
      } else if (path === sourceNode) {
        path = ".";
      } else if (path.startsWith("$")) {
        // leave absolute foreign paths; mark with placeholder prefix note in path if under source
        if (path.startsWith(sourceNode)) {
          path = path.slice(sourceNode.length).replace(/^\./, "") || ".";
        }
      }
      return { type: "atom", atom: { ...expr.atom, path } };
    }
    case "and":
      return {
        type: "and",
        children: expr.children.map((c) => rewriteConditionPaths(c, sourceNode)),
      };
    case "or":
      return {
        type: "or",
        children: expr.children.map((c) => rewriteConditionPaths(c, sourceNode)),
      };
    case "not":
      return {
        type: "not",
        child: rewriteConditionPaths(expr.child, sourceNode),
      };
  }
}

function materializeConditionPaths(
  expr: ConditionExpr,
  sourceNode: string,
): ConditionExpr {
  switch (expr.type) {
    case "atom": {
      let path = expr.atom.path;
      if (path === TEMPLATE_SOURCE_PLACEHOLDER) path = sourceNode;
      // relative paths stay relative for evaluation against context
      return { type: "atom", atom: { ...expr.atom, path } };
    }
    case "and":
      return {
        type: "and",
        children: expr.children.map((c) =>
          materializeConditionPaths(c, sourceNode),
        ),
      };
    case "or":
      return {
        type: "or",
        children: expr.children.map((c) =>
          materializeConditionPaths(c, sourceNode),
        ),
      };
    case "not":
      return {
        type: "not",
        child: materializeConditionPaths(expr.child, sourceNode),
      };
  }
}
