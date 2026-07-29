import type {
  FieldMapping,
  InferredType,
  SchemaTree,
  ValidationIssue,
  ValidationReport,
} from "../types.js";
import { evaluateCondition } from "../rule/condition-eval.js";
import {
  expandEquivalentPaths,
  isAbsolutePath,
  isMappedPath,
  isRelativePath,
  joinPathAware,
  markMappedPath,
  PathError,
  schemaHasPath,
} from "../rule/paths.js";
import type {
  ConditionExpr,
  Rule,
  RuleGroup,
  RuleValidationIssue,
  RuleValidationIssueType,
} from "../rule/types.js";
import { resolveRuleCopyMode } from "../rule/copy-mode.js";
import { validateMappings } from "./engine.js";

export interface RuleValidationSummary {
  errorCount: number;
  warningCount: number;
  infoCount: number;
  byType: Partial<Record<RuleValidationIssueType, number>>;
}

export interface RuleValidationReport {
  generatedAt: string;
  summary: RuleValidationSummary;
  issues: RuleValidationIssue[];
}

export interface ValidateRuleGroupsOptions {
  /** When true, first-match groups with conditionals must have an enabled fallback. */
  requireFallback?: boolean;
}

const PRIMITIVES = new Set<InferredType>([
  "string",
  "number",
  "boolean",
  "null",
]);

function issue(
  partial: Omit<RuleValidationIssue, "severity" | "issueKey"> & {
    severity?: RuleValidationIssue["severity"];
  },
): RuleValidationIssue {
  const built: RuleValidationIssue = {
    severity: partial.severity ?? "error",
    type: partial.type,
    ruleGroupId: partial.ruleGroupId,
    ruleId: partial.ruleId,
    childMappingId: partial.childMappingId,
    sourcePath: partial.sourcePath,
    targetPath: partial.targetPath,
    scope: partial.scope,
    message: partial.message,
    recommendedFix: partial.recommendedFix,
  };
  built.issueKey = buildIssueKey(built);
  return built;
}

export function buildIssueKey(i: {
  type: string;
  ruleId?: string;
  childMappingId?: string;
  sourcePath?: string;
  targetPath?: string;
  scope?: string;
}): string {
  return [
    i.type,
    i.scope ?? "",
    i.ruleId ?? "",
    i.childMappingId ?? "",
    i.sourcePath ?? "",
    i.targetPath ?? "",
  ].join("|");
}

function conditionSignature(expr: ConditionExpr | undefined): string {
  return JSON.stringify(expr ?? null);
}

function sortByPriority(rules: Rule[]): Rule[] {
  return rules
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) =>
      a.rule.priority !== b.rule.priority
        ? a.rule.priority - b.rule.priority
        : a.index - b.index,
    )
    .map((x) => x.rule);
}

function parentObjectPaths(path: string): string[] {
  const parents: string[] = [];
  let current = path;
  while (true) {
    if (current.endsWith("[*]")) {
      current = current.slice(0, -3);
    } else {
      const lastDot = current.lastIndexOf(".");
      if (lastDot === -1) break;
      current = current.slice(0, lastDot);
    }
    if (current === "$" || current === "") break;
    parents.push(current);
  }
  return parents;
}

function summarize(issues: RuleValidationIssue[]): RuleValidationSummary {
  const byType: Partial<Record<RuleValidationIssueType, number>> = {};
  for (const i of issues) {
    byType[i.type] = (byType[i.type] ?? 0) + 1;
  }
  return {
    errorCount: issues.filter((i) => i.severity === "error").length,
    warningCount: issues.filter((i) => i.severity === "warning").length,
    infoCount: issues.filter((i) => i.severity === "info").length,
    byType,
  };
}

function nodeType(
  schema: SchemaTree,
  path: string,
): InferredType | undefined {
  for (const candidate of expandEquivalentPaths(path)) {
    const t = schema.nodes[candidate]?.type;
    if (t) return t;
  }
  return undefined;
}

function areCompatiblePrimitives(a: InferredType, b: InferredType): boolean {
  if (a === "null" || b === "null") return true;
  return a === b;
}

function validateConditionShape(
  expr: ConditionExpr,
  ruleGroupId: string,
  ruleId: string,
  issues: RuleValidationIssue[],
): void {
  if (!expr || typeof expr !== "object" || !("type" in expr)) {
    issues.push(
      issue({
        type: "invalid_condition",
        ruleGroupId,
        ruleId,
        message: "Condition expression is missing or not an object.",
        recommendedFix:
          'Use { type: "atom", atom: { path, operator, value? } } (or and/or/not).',
      }),
    );
    return;
  }

  switch (expr.type) {
    case "atom": {
      const atom = expr.atom;
      if (!atom || typeof atom !== "object") {
        issues.push(
          issue({
            type: "invalid_condition",
            ruleGroupId,
            ruleId,
            message:
              'Atom condition is missing `atom` (expected { type: "atom", atom: { path, operator, value? } }).',
            recommendedFix:
              "Nest path/operator/value under `atom`; do not put them on the expression root.",
          }),
        );
        return;
      }
      if (typeof atom.operator !== "string" || !atom.operator) {
        issues.push(
          issue({
            type: "invalid_condition",
            ruleGroupId,
            ruleId,
            message: "Condition atom is missing a valid operator.",
            recommendedFix: "Set atom.operator (e.g. ==, EXISTS, IN).",
          }),
        );
        return;
      }
      if (
        atom.operator !== "EXISTS" &&
        atom.operator !== "NOT_EXISTS" &&
        atom.value === undefined
      ) {
        issues.push(
          issue({
            type: "invalid_condition",
            ruleGroupId,
            ruleId,
            message: `Operator ${atom.operator} requires a value (path "${atom.path}").`,
            recommendedFix: "Provide a comparison value for the condition atom.",
          }),
        );
      }
      if (atom.operator === "MATCHES_REGEX" && typeof atom.value === "string") {
        try {
          // eslint-disable-next-line no-new
          new RegExp(atom.value);
        } catch {
          issues.push(
            issue({
              type: "invalid_condition",
              ruleGroupId,
              ruleId,
              message: `Invalid regular expression: ${atom.value}`,
              recommendedFix: "Fix the MATCHES_REGEX pattern.",
            }),
          );
        }
      }
      if (atom.operator === "IN" || atom.operator === "NOT_IN") {
        if (!Array.isArray(atom.value)) {
          issues.push(
            issue({
              type: "invalid_condition",
              ruleGroupId,
              ruleId,
              message: `Operator ${atom.operator} requires an array value.`,
              recommendedFix: "Pass an array of allowed/disallowed values.",
            }),
          );
        }
      }
      // Dry-run evaluation against empty context to catch structural errors.
      evaluateCondition(expr, {
        relativeRoot: {},
        document: {},
      });
      return;
    }
    case "and":
    case "or": {
      const children = Array.isArray(expr.children) ? expr.children : null;
      if (!children) {
        issues.push(
          issue({
            type: "invalid_condition",
            ruleGroupId,
            ruleId,
            message: `${expr.type.toUpperCase()} expression is missing a children array.`,
            recommendedFix: `Use { type: "${expr.type}", children: [...] }.`,
          }),
        );
        return;
      }
      if (children.length === 0) {
        issues.push(
          issue({
            severity: "warning",
            type: "invalid_condition",
            ruleGroupId,
            ruleId,
            message: `Empty ${expr.type.toUpperCase()} expression.`,
            recommendedFix: "Add at least one child condition.",
          }),
        );
      }
      for (const child of children) {
        validateConditionShape(child, ruleGroupId, ruleId, issues);
      }
      return;
    }
    case "not":
      if (!expr.child) {
        issues.push(
          issue({
            type: "invalid_condition",
            ruleGroupId,
            ruleId,
            message: "NOT expression is missing child.",
            recommendedFix: 'Use { type: "not", child: <ConditionExpr> }.',
          }),
        );
        return;
      }
      validateConditionShape(expr.child, ruleGroupId, ruleId, issues);
      return;
    default:
      issues.push(
        issue({
          type: "invalid_condition",
          ruleGroupId,
          ruleId,
          message: `Unknown condition type: ${JSON.stringify((expr as { type?: unknown }).type)}.`,
          recommendedFix: 'Use type "atom", "and", "or", or "not".',
        }),
      );
  }
}

/**
 * Rule-aware validation engine.
 * Pure / framework-independent.
 */
export function validateRuleGroups(
  ruleGroups: RuleGroup[],
  sourceSchema: SchemaTree,
  targetSchema: SchemaTree,
  options: ValidateRuleGroupsOptions = {},
): RuleValidationReport {
  const issues: RuleValidationIssue[] = [];
  const seenRuleIds = new Set<string>();

  const mappedSources = new Set<string>();
  const mappedTargets = new Set<string>();

  for (const group of ruleGroups) {
    const ruleIdsInGroup = new Set<string>();
    const enabledFallbacks = group.rules.filter(
      (r) => r.enabled && r.kind === "fallback",
    );

    if (
      group.executionMode === "first-match" &&
      enabledFallbacks.length > 1
    ) {
      for (const fb of enabledFallbacks) {
        issues.push(
          issue({
            type: "multiple_enabled_fallbacks",
            ruleGroupId: group.id,
            ruleId: fb.id,
            message:
              "Multiple enabled fallback rules in a first-match RuleGroup (D6).",
            recommendedFix:
              "Keep exactly one enabled fallback per first-match group.",
          }),
        );
      }
    }

    if (
      group.executionMode === "all-match" &&
      enabledFallbacks.length > 1
    ) {
      for (const fb of enabledFallbacks) {
        issues.push(
          issue({
            severity: "error",
            type: "multiple_enabled_fallbacks",
            ruleGroupId: group.id,
            ruleId: fb.id,
            message:
              "Multiple enabled fallback rules in an all-match RuleGroup.",
            recommendedFix: "Keep at most one enabled fallback per group.",
          }),
        );
      }
    }

    const hasEnabledConditional = group.rules.some(
      (r) => r.enabled && r.kind === "conditional",
    );
    if (
      options.requireFallback &&
      group.executionMode === "first-match" &&
      hasEnabledConditional &&
      enabledFallbacks.length === 0
    ) {
      issues.push(
        issue({
          severity: "warning",
          type: "missing_fallback",
          ruleGroupId: group.id,
          message:
            "First-match group has conditional rules but no enabled fallback.",
          recommendedFix: "Add an enabled fallback rule for unmatched cases.",
        }),
      );
    }

    const ordered = sortByPriority(group.rules);

    // Unreachable: after an enabled unconditional normal rule in first-match,
    // later normal rules cannot run.
    if (group.executionMode === "first-match") {
      let blocked = false;
      for (const rule of ordered) {
        if (!rule.enabled) continue;
        if (rule.kind === "fallback") continue;
        if (blocked) {
          issues.push(
            issue({
              severity: "warning",
              type: "definitely_unreachable_rule",
              ruleGroupId: group.id,
              ruleId: rule.id,
              message:
                "DEFINITELY_UNREACHABLE_RULE: in first-match mode this rule cannot run because an earlier enabled unconditional (or direct) rule always matches. Other unreachable cases are not yet proven.",
              recommendedFix:
                "Raise this rule's priority, disable the earlier unconditional rule, or switch execution mode.",
            }),
          );
          continue;
        }
        if (rule.kind === "unconditional" || rule.category === "direct") {
          blocked = true;
        }
      }
    }

    // Duplicate / conflict / overlap within group
    for (let i = 0; i < group.rules.length; i++) {
      for (let j = i + 1; j < group.rules.length; j++) {
        const a = group.rules[i]!;
        const b = group.rules[j]!;
        if (!a.enabled || !b.enabled) continue;
        if (a.kind === "fallback" || b.kind === "fallback") continue;

        const sameCond =
          conditionSignature(a.condition) === conditionSignature(b.condition) &&
          a.kind === b.kind;
        const bothUncond =
          (a.kind === "unconditional" || a.category === "direct") &&
          (b.kind === "unconditional" || b.category === "direct");

        if (
          sameCond &&
          a.destinationNode === b.destinationNode &&
          a.sourceNode === b.sourceNode
        ) {
          issues.push(
            issue({
              severity: "warning",
              type: "duplicate_rule",
              ruleGroupId: group.id,
              ruleId: b.id,
              message: `Duplicate rule of "${a.id}" (same source, destination, kind, condition).`,
              recommendedFix: "Remove the duplicate or differentiate the rules.",
            }),
          );
        } else if (bothUncond && a.destinationNode !== b.destinationNode) {
          issues.push(
            issue({
              severity: "error",
              type: "conflicting_rule",
              ruleGroupId: group.id,
              ruleId: b.id,
              message: `Conflicting unconditional rules "${a.id}" and "${b.id}" route to different destinations.`,
              recommendedFix:
                "Keep a single unconditional route, or make them conditional/exclusive.",
            }),
          );
        } else if (
          a.kind === "conditional" &&
          b.kind === "conditional" &&
          sameCond &&
          a.destinationNode !== b.destinationNode
        ) {
          issues.push(
            issue({
              severity: "warning",
              type: "overlapping_rule",
              ruleGroupId: group.id,
              ruleId: b.id,
              message: `Potential overlapping rules "${a.id}" and "${b.id}" share the same condition but different destinations. Overlap is not statically provable beyond identical condition signatures — use Preview with sample data for runtime evidence (V1).`,
              recommendedFix:
                "Differentiate conditions, rely on first-match priority intentionally, or confirm via Preview.",
            }),
          );
        }
      }
    }

    for (const rule of group.rules) {
      if (ruleIdsInGroup.has(rule.id)) {
        issues.push(
          issue({
            type: "invariant_violation",
            ruleGroupId: group.id,
            ruleId: rule.id,
            message: `Duplicate Rule.id "${rule.id}" within RuleGroup.`,
            recommendedFix: "Ensure Rule ids are unique within the group.",
          }),
        );
      }
      ruleIdsInGroup.add(rule.id);

      if (seenRuleIds.has(rule.id)) {
        issues.push(
          issue({
            type: "invariant_violation",
            ruleGroupId: group.id,
            ruleId: rule.id,
            message: `Duplicate Rule.id "${rule.id}" across the project.`,
            recommendedFix: "Use project-wide unique Rule ids.",
          }),
        );
      }
      seenRuleIds.add(rule.id);

      if (rule.sourceNode !== group.sourceNode) {
        issues.push(
          issue({
            type: "invariant_violation",
            ruleGroupId: group.id,
            ruleId: rule.id,
            message: `Rule.sourceNode "${rule.sourceNode}" must equal RuleGroup.sourceNode "${group.sourceNode}" (INV-G1).`,
            recommendedFix: "Align Rule.sourceNode with its RuleGroup.",
          }),
        );
      }

      if (rule.category === "direct") {
        if (rule.kind !== "unconditional") {
          issues.push(
            issue({
              type: "invariant_violation",
              ruleGroupId: group.id,
              ruleId: rule.id,
              message: "Direct rules must be unconditional (INV-R1).",
              recommendedFix: "Set kind to unconditional or category to routing.",
            }),
          );
        }
        if (rule.condition) {
          issues.push(
            issue({
              type: "invariant_violation",
              ruleGroupId: group.id,
              ruleId: rule.id,
              message: "Direct rules must not have a condition (INV-R1).",
              recommendedFix: "Remove the condition.",
            }),
          );
        }
        if (rule.childMappings.length > 0) {
          issues.push(
            issue({
              type: "legacy_direct_with_children",
              ruleGroupId: group.id,
              ruleId: rule.id,
              message: "Direct rules must not own childMappings (INV-R1).",
              recommendedFix:
                "Move child mappings under a routing rule, or clear children.",
            }),
          );
        }
      }

      if (rule.migrationSource === "FIELD_MAPPING_V1" && rule.category !== "direct") {
        issues.push(
          issue({
            type: "invariant_violation",
            ruleGroupId: group.id,
            ruleId: rule.id,
            message: "FIELD_MAPPING_V1 migrationSource requires category direct (INV-R5).",
            recommendedFix: "Set category to direct or clear migrationSource.",
          }),
        );
      }

      if (rule.kind === "fallback" && rule.category !== "routing") {
        issues.push(
          issue({
            type: "invariant_violation",
            ruleGroupId: group.id,
            ruleId: rule.id,
            message: "Fallback rules must have category routing (INV-R4).",
            recommendedFix: "Set category to routing.",
          }),
        );
      }

      if (rule.kind === "conditional") {
        if (!rule.condition) {
          issues.push(
            issue({
              type: "invalid_condition",
              ruleGroupId: group.id,
              ruleId: rule.id,
              message: "Conditional rule is missing a condition expression.",
              recommendedFix: "Add a ConditionExpr or change kind.",
            }),
          );
        } else {
          validateConditionShape(rule.condition, group.id, rule.id, issues);
        }
      } else if (rule.condition) {
        issues.push(
          issue({
            type: "invalid_condition",
            ruleGroupId: group.id,
            ruleId: rule.id,
            message: `Rule kind "${rule.kind}" must not include a condition.`,
            recommendedFix: "Remove condition or set kind to conditional.",
          }),
        );
      }

      if (!Number.isFinite(rule.priority)) {
        issues.push(
          issue({
            type: "invariant_violation",
            ruleGroupId: group.id,
            ruleId: rule.id,
            message: "Rule priority must be a finite number (INV-R7).",
            recommendedFix: "Set a numeric priority (lower wins).",
          }),
        );
      }

      // Track covered paths for direct rules
      if (rule.category === "direct" || resolveRuleCopyMode(rule) === "COPY_SOURCE_NODE") {
        markMappedPath(mappedSources, rule.sourceNode);
        markMappedPath(mappedTargets, rule.destinationNode);
      }
      if (resolveRuleCopyMode(rule) === "ROUTE_ONLY") {
        // Route records destination as structurally selected, not field-covered.
        markMappedPath(mappedTargets, rule.destinationNode);
      }

      const destIsArray =
        targetSchema.nodes[rule.destinationNode]?.type === "array" ||
        targetSchema.nodes[`${rule.destinationNode}[*]`]?.type === "object" ||
        Boolean(
          Object.keys(targetSchema.nodes).some(
            (p) =>
              p.startsWith(`${rule.destinationNode}[*]`) ||
              p.startsWith(`${rule.destinationNode}.`),
          ),
        );
      // Prefer schema array type when available
      const destNodeType =
        targetSchema.nodes[rule.destinationNode]?.type ??
        (targetSchema.nodes[`${rule.destinationNode}[*]`] ? "array" : undefined);
      const parentIsArray = destNodeType === "array" || destIsArray && !rule.destinationNode.endsWith("[*]");

      // Child mappings
      const childTargets = new Set<string>();
      const childSources = new Set<string>();
      for (const child of rule.childMappings) {
        if (!isRelativePath(child.sourcePath) || !isRelativePath(child.targetPath)) {
          issues.push(
            issue({
              type: "invariant_violation",
              ruleGroupId: group.id,
              ruleId: rule.id,
              childMappingId: child.id,
              sourcePath: child.sourcePath,
              targetPath: child.targetPath,
              message:
                "Child mapping paths must be relative (must not start with $.) (INV-R6).",
              recommendedFix: "Store paths relative to the Rule nodes.",
            }),
          );
          continue;
        }

        let absSource: string;
        let absTarget: string;
        try {
          const srcIsArray =
            sourceSchema.nodes[rule.sourceNode]?.type === "array";
          absSource = joinPathAware(
            rule.sourceNode,
            child.sourcePath,
            srcIsArray || rule.sourceNode.endsWith("[*]"),
          );
          absTarget = joinPathAware(
            rule.destinationNode,
            child.targetPath,
            parentIsArray || rule.destinationNode.endsWith("[*]"),
          );
        } catch (err) {
          issues.push(
            issue({
              type: "invariant_violation",
              ruleGroupId: group.id,
              ruleId: rule.id,
              childMappingId: child.id,
              message:
                err instanceof PathError
                  ? err.message
                  : "Failed to resolve child mapping paths.",
              recommendedFix: "Fix Rule node paths and relative child paths.",
            }),
          );
          continue;
        }

        markMappedPath(mappedSources, absSource);
        markMappedPath(mappedTargets, absTarget);
        // Parent destination container is covered when children are mapped (V2).
        markMappedPath(mappedTargets, rule.destinationNode);

        if (childTargets.has(absTarget)) {
          issues.push(
            issue({
              type: "duplicate_child_mapping",
              ruleGroupId: group.id,
              ruleId: rule.id,
              childMappingId: child.id,
              targetPath: absTarget,
              message: `Duplicate child mapping target "${absTarget}" within rule.`,
              recommendedFix: "Keep a single child mapping per target path.",
            }),
          );
        }
        childTargets.add(absTarget);

        if (childSources.has(absSource)) {
          issues.push(
            issue({
              severity: "info",
              type: "duplicate_child_mapping",
              ruleGroupId: group.id,
              ruleId: rule.id,
              childMappingId: child.id,
              sourcePath: absSource,
              message: `Source path "${absSource}" is used by multiple child mappings in this rule.`,
              recommendedFix: "Confirm intentional fan-out of the same source field.",
            }),
          );
        }
        childSources.add(absSource);

        const srcType = nodeType(sourceSchema, absSource);
        const tgtType = nodeType(targetSchema, absTarget);

        if (!srcType) {
          issues.push(
            issue({
              severity: "warning",
              type: "unused_mapping",
              ruleGroupId: group.id,
              ruleId: rule.id,
              childMappingId: child.id,
              sourcePath: absSource,
              message: `Child source path "${absSource}" is not in the inferred source schema.`,
              recommendedFix: "Re-infer schema or correct the relative path.",
            }),
          );
        }
        if (!tgtType) {
          issues.push(
            issue({
              severity: "warning",
              type: "unused_mapping",
              ruleGroupId: group.id,
              ruleId: rule.id,
              childMappingId: child.id,
              targetPath: absTarget,
              message: `Child target path "${absTarget}" is not in the inferred target schema.`,
              recommendedFix: "Re-infer schema or correct the relative path.",
            }),
          );
        }

        if (srcType && tgtType) {
          if (srcType === "array" && tgtType !== "array") {
            issues.push(
              issue({
                type: "array_mismatch",
                ruleGroupId: group.id,
                ruleId: rule.id,
                childMappingId: child.id,
                sourcePath: absSource,
                targetPath: absTarget,
                message: `Array source mapped to non-array target (${tgtType}).`,
                recommendedFix: "Map to an array target or map item fields.",
              }),
            );
          } else if (srcType !== "array" && tgtType === "array") {
            issues.push(
              issue({
                type: "array_mismatch",
                ruleGroupId: group.id,
                ruleId: rule.id,
                childMappingId: child.id,
                sourcePath: absSource,
                targetPath: absTarget,
                message: `Non-array source (${srcType}) mapped to array target.`,
                recommendedFix: "Map an array source or an item field path.",
              }),
            );
          } else if (srcType === "array" && tgtType === "array") {
            issues.push(
              issue({
                severity: "warning",
                type: "cardinality_mismatch",
                ruleGroupId: group.id,
                ruleId: rule.id,
                childMappingId: child.id,
                sourcePath: absSource,
                targetPath: absTarget,
                message:
                  "Array-to-array mapping needs manual cardinality/item review.",
                recommendedFix: "Confirm item schemas and add item-level child mappings.",
              }),
            );
          }

          if (
            PRIMITIVES.has(srcType) &&
            PRIMITIVES.has(tgtType) &&
            !areCompatiblePrimitives(srcType, tgtType)
          ) {
            issues.push(
              issue({
                type: "datatype_mismatch",
                ruleGroupId: group.id,
                ruleId: rule.id,
                childMappingId: child.id,
                sourcePath: absSource,
                targetPath: absTarget,
                message: `Datatype mismatch: source ${srcType} vs target ${tgtType}.`,
                recommendedFix:
                  "Choose compatible fields or attach a transformation note/ref for later execution.",
              }),
            );
          }

          if (
            (srcType === "object" && PRIMITIVES.has(tgtType)) ||
            (PRIMITIVES.has(srcType) && tgtType === "object")
          ) {
            issues.push(
              issue({
                type: "datatype_mismatch",
                ruleGroupId: group.id,
                ruleId: rule.id,
                childMappingId: child.id,
                sourcePath: absSource,
                targetPath: absTarget,
                message: `Object/primitive structural mismatch (${srcType} → ${tgtType}).`,
                recommendedFix: "Map object properties individually.",
              }),
            );
          }
        }

        // Structurally unreachable under destination: required parent unmapped
        for (const parentPath of parentObjectPaths(absTarget)) {
          const parent = targetSchema.nodes[parentPath];
          if (!parent) continue;
          if (parent.type !== "object" && parent.type !== "array") continue;
          if (!parent.required) continue;
          if (isMappedPath(mappedTargets, parentPath)) continue;
          // Parent might be the rule destination itself
          if (parentPath === rule.destinationNode) continue;
          issues.push(
            issue({
              type: "structurally_unreachable",
              ruleGroupId: group.id,
              ruleId: rule.id,
              childMappingId: child.id,
              targetPath: absTarget,
              message: `Child target "${absTarget}" may be unreachable because required parent "${parentPath}" is unmapped.`,
              recommendedFix: `Map parent "${parentPath}" or mark it optional.`,
            }),
          );
          break;
        }
      }

      // Direct rule schema presence
      if (rule.category === "direct") {
        if (
          !schemaHasPath(Object.keys(sourceSchema.nodes), rule.sourceNode) &&
          isAbsolutePath(rule.sourceNode)
        ) {
          issues.push(
            issue({
              severity: "warning",
              type: "unused_mapping",
              ruleGroupId: group.id,
              ruleId: rule.id,
              sourcePath: rule.sourceNode,
              message: `Direct rule source "${rule.sourceNode}" is not in the inferred source schema.`,
              recommendedFix: "Re-infer schema or correct the source path.",
            }),
          );
        }
        if (!schemaHasPath(Object.keys(targetSchema.nodes), rule.destinationNode)) {
          issues.push(
            issue({
              severity: "warning",
              type: "unused_mapping",
              ruleGroupId: group.id,
              ruleId: rule.id,
              targetPath: rule.destinationNode,
              message: `Direct rule destination "${rule.destinationNode}" is not in the inferred target schema.`,
              recommendedFix: "Re-infer schema or correct the destination path.",
            }),
          );
        } else {
          const s = nodeType(sourceSchema, rule.sourceNode);
          const t = nodeType(targetSchema, rule.destinationNode);
          if (s && t && PRIMITIVES.has(s) && PRIMITIVES.has(t) && !areCompatiblePrimitives(s, t)) {
            issues.push(
              issue({
                type: "datatype_mismatch",
                ruleGroupId: group.id,
                ruleId: rule.id,
                sourcePath: rule.sourceNode,
                targetPath: rule.destinationNode,
                message: `Datatype mismatch on direct rule: ${s} → ${t}.`,
                recommendedFix: "Map compatible types or document a future transformation.",
              }),
            );
          }
          if (s && t && ((s === "array") !== (t === "array"))) {
            issues.push(
              issue({
                type: "array_mismatch",
                ruleGroupId: group.id,
                ruleId: rule.id,
                sourcePath: rule.sourceNode,
                targetPath: rule.destinationNode,
                message: `Array mismatch on direct rule: ${s} → ${t}.`,
                recommendedFix: "Align array vs non-array endpoints.",
              }),
            );
          }
        }
      }
    }
  }

  // --- V3 scoped required / optional / unused ---
  type DestInfo = {
    ruleGroupId: string;
    ruleId: string;
    destinationNode: string;
    conditional: boolean;
  };
  const destinations: DestInfo[] = [];
  for (const group of ruleGroups) {
    for (const rule of group.rules) {
      if (!rule.enabled) continue;
      destinations.push({
        ruleGroupId: group.id,
        ruleId: rule.id,
        destinationNode: rule.destinationNode,
        conditional: rule.kind === "conditional",
      });
    }
  }

  function underDestination(fieldPath: string, destinationNode: string): boolean {
    for (const fp of expandEquivalentPaths(fieldPath)) {
      for (const dp of expandEquivalentPaths(destinationNode)) {
        if (fp === dp || fp.startsWith(`${dp}.`) || fp.startsWith(`${dp}[*]`)) {
          return true;
        }
        // destination $.arr vs field $.arr[*].x
        if (dp.endsWith("[*]") && (fp === dp.slice(0, -3) || fp.startsWith(`${dp}.`) || fp.startsWith(`${dp.slice(0, -3)}[*]`))) {
          return true;
        }
        if (!dp.endsWith("[*]") && (fp.startsWith(`${dp}[*]`) || fp.startsWith(`${dp}.`))) {
          return true;
        }
      }
    }
    return false;
  }

  for (const node of Object.values(targetSchema.nodes)) {
    if (node.path === "$") continue;
    if (isMappedPath(mappedTargets, node.path)) continue;

    const owning = destinations.filter((d) =>
      underDestination(node.path, d.destinationNode),
    );

    if (!node.required) {
      if (owning.length === 0) {
        issues.push(
          issue({
            severity: "info",
            type: "unmapped_optional_target",
            scope: "project",
            targetPath: node.path,
            message: `Optional target field "${node.path}" is unmapped (project-wide).`,
            recommendedFix: "Map intentionally or leave unmapped.",
          }),
        );
      }
      continue;
    }

    if (owning.length === 0) {
      issues.push(
        issue({
          type: "unmapped_required_target",
          scope: "project",
          targetPath: node.path,
          message: `Required target field "${node.path}" (${node.type}) is unmapped project-wide (not under any rule destination).`,
          recommendedFix: "Add a rule/child mapping covering this field, or mark it optional.",
        }),
      );
      continue;
    }

    for (const owner of owning) {
      if (owner.conditional) {
        issues.push(
          issue({
            severity: "warning",
            type: "unmapped_required_target",
            scope: "conditional_route",
            ruleGroupId: owner.ruleGroupId,
            ruleId: owner.ruleId,
            targetPath: node.path,
            message: `Required field "${node.path}" is unmapped under conditional route "${owner.ruleId}" → ${owner.destinationNode}. It is required only when that route executes — not universally missing.`,
            recommendedFix:
              "Add a child mapping on this rule, or accept the gap for non-matching samples.",
          }),
        );
      } else {
        issues.push(
          issue({
            type: "unmapped_required_target",
            scope: "route",
            ruleGroupId: owner.ruleGroupId,
            ruleId: owner.ruleId,
            targetPath: node.path,
            message: `Required field "${node.path}" is unmapped within route "${owner.ruleId}" → ${owner.destinationNode}.`,
            recommendedFix: "Map this field under the route's child mappings or direct rule.",
          }),
        );
      }
    }
  }

  for (const node of Object.values(sourceSchema.nodes)) {
    if (node.path === "$") continue;
    if (isMappedPath(mappedSources, node.path)) continue;
    issues.push(
      issue({
        severity: "info",
        type: "unused_source",
        scope: "project",
        sourcePath: node.path,
        message: `Source field "${node.path}" is not used by any rule or child mapping.`,
        recommendedFix: "Map it under a rule or ignore intentionally.",
      }),
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: summarize(issues),
    issues,
  };
}

/** Adapt rule issues into legacy ValidationIssue shape for older consumers. */
export function ruleIssuesToLegacyIssues(
  ruleIssues: RuleValidationIssue[],
): ValidationIssue[] {
  return ruleIssues.map((r) => ({
    severity: r.severity,
    issueType: mapLegacyIssueType(r.type),
    sourcePath: r.sourcePath,
    targetPath: r.targetPath,
    explanation: r.ruleId
      ? `[${r.type}] rule ${r.ruleId}: ${r.message}`
      : `[${r.type}] ${r.message}`,
    suggestedAction: r.recommendedFix,
  }));
}

function mapLegacyIssueType(
  type: RuleValidationIssueType,
): ValidationIssue["issueType"] {
  switch (type) {
    case "unmapped_required_target":
      return "unmapped_required_target";
    case "unmapped_optional_target":
      return "unmapped_optional_target";
    case "unused_source":
      return "unused_source";
    case "datatype_mismatch":
      return "primitive_datatype_conflict";
    case "array_mismatch":
    case "cardinality_mismatch":
      return "array_to_non_array_conflict";
    case "duplicate_child_mapping":
    case "duplicate_rule":
      return "duplicate_target_mapping";
    case "structurally_unreachable":
      return "structurally_unreachable";
    case "definitely_unreachable_rule":
    case "unreachable_rule":
      return "structurally_unreachable";
    case "conflicting_rule":
    case "overlapping_rule":
      return "source_multi_target_conflict";
    default:
      return "primitive_datatype_conflict";
  }
}

function legacyIssueKey(i: ValidationIssue): string {
  return buildIssueKey({
    type: i.issueType,
    sourcePath: i.sourcePath,
    targetPath: i.targetPath,
  });
}

/**
 * Validate a project using ruleGroups as the canonical path (V5).
 * When mappings are migrated equivalents, suppress duplicate legacy issues.
 */
export function validateProjectRules(
  project: {
    ruleGroups: RuleGroup[];
    sourceSchema: SchemaTree;
    targetSchema: SchemaTree;
    mappings?: FieldMapping[];
  },
  options?: ValidateRuleGroupsOptions & {
    includeLegacyMappingValidation?: boolean;
  },
): ValidationReport {
  const ruleReport = validateRuleGroups(
    project.ruleGroups,
    project.sourceSchema,
    project.targetSchema,
    options,
  );

  const issues = ruleIssuesToLegacyIssues(ruleReport.issues);
  const seen = new Set(issues.map(legacyIssueKey));
  // Also index by path pair for cross-type dedupe
  const pathPairs = new Set(
    ruleReport.issues.map(
      (r) => `${r.sourcePath ?? ""}=>${r.targetPath ?? ""}`,
    ),
  );

  const hasMigratedRules = project.ruleGroups.some((g) =>
    g.rules.some((r) => r.migrationSource === "FIELD_MAPPING_V1"),
  );

  // V5: prefer canonical rule validation; only add legacy issues that are not
  // represented, and skip entirely when mappings are fully covered by migrated rules.
  const shouldMergeLegacy =
    options?.includeLegacyMappingValidation === true &&
    project.mappings &&
    project.mappings.length > 0 &&
    !hasMigratedRules;

  if (shouldMergeLegacy) {
    const legacy = validateMappings(
      project.sourceSchema,
      project.targetSchema,
      project.mappings!,
    );
    for (const li of legacy.issues) {
      const key = legacyIssueKey(li);
      const pair = `${li.sourcePath ?? ""}=>${li.targetPath ?? ""}`;
      if (seen.has(key) || pathPairs.has(pair)) continue;
      // Soft dedupe on target-only required/unmapped
      if (
        li.targetPath &&
        ruleReport.issues.some(
          (r) =>
            r.targetPath === li.targetPath &&
            (r.type === "unmapped_required_target" ||
              r.type === "unmapped_optional_target"),
        )
      ) {
        continue;
      }
      seen.add(key);
      issues.push(li);
    }
  }

  const summary = {
    requiredTargetFieldsMissing: ruleReport.issues.filter(
      (i) => i.type === "unmapped_required_target" && i.scope === "project",
    ).length,
    optionalTargetFieldsUnmapped: ruleReport.issues.filter(
      (i) => i.type === "unmapped_optional_target",
    ).length,
    datatypeConflicts: ruleReport.issues.filter(
      (i) => i.type === "datatype_mismatch",
    ).length,
    arraysNeedingManualReview: ruleReport.issues.filter(
      (i) =>
        i.type === "cardinality_mismatch" ||
        (i.type === "array_mismatch" && i.severity === "warning"),
    ).length,
    potentialDuplicateMappings: ruleReport.issues.filter(
      (i) =>
        i.type === "duplicate_child_mapping" || i.type === "duplicate_rule",
    ).length,
    unusedSourceFields: ruleReport.issues.filter((i) => i.type === "unused_source")
      .length,
    structurallyUnreachable: ruleReport.issues.filter(
      (i) =>
        i.type === "structurally_unreachable" ||
        i.type === "definitely_unreachable_rule",
    ).length,
    errorCount: issues.filter((i) => i.severity === "error").length,
    warningCount: issues.filter((i) => i.severity === "warning").length,
    infoCount: issues.filter((i) => i.severity === "info").length,
  };

  return {
    generatedAt: ruleReport.generatedAt,
    summary,
    issues,
    ruleIssues: ruleReport.issues,
  };
}
