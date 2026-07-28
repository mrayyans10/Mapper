/**
 * Rule Platform domain model (schemaVersion >= 2).
 *
 * Approved decisions: D1–D8 (2026-07-28) with amendments.
 * Engines must stay UI-independent and JSON-generic.
 */

import type { MappingStatus } from "../types.js";

/** Project document version. Missing ⇒ treat as 1 (FieldMapping era). */
export const PROJECT_SCHEMA_VERSION_V1 = 1;
export const PROJECT_SCHEMA_VERSION_V2 = 2;

export type ExecutionMode = "first-match" | "all-match";

/**
 * Separates ordinary direct mappings from routing rules that own child mappings.
 * - `direct` — unconditional source→destination field/node mapping (incl. migrated v1)
 * - `routing` — routing/transform decision; may be conditional/fallback; owns childMappings
 */
export type RuleCategory = "direct" | "routing";

export type RuleKind = "unconditional" | "conditional" | "fallback";

export type MigrationSource = "FIELD_MAPPING_V1";

export type ConditionOperator =
  | "=="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "IN"
  | "NOT_IN"
  | "EXISTS"
  | "NOT_EXISTS"
  | "CONTAINS"
  | "STARTS_WITH"
  | "ENDS_WITH"
  | "MATCHES_REGEX";

/** Leaf condition against a path relative to the RuleGroup sourceNode context (or absolute `$...`). */
export interface ConditionAtom {
  /** Path to evaluate. May be absolute (`$.a.b`) or relative to the active source element. */
  path: string;
  operator: ConditionOperator;
  /** Required for all operators except EXISTS / NOT_EXISTS. */
  value?: unknown;
}

/**
 * Compound boolean expression.
 * Supports nested (A AND B), (A OR B), NOT A.
 */
export type ConditionExpr =
  | { type: "atom"; atom: ConditionAtom }
  | { type: "and"; children: ConditionExpr[] }
  | { type: "or"; children: ConditionExpr[] }
  | { type: "not"; child: ConditionExpr };

/**
 * Field mapping owned by a Rule.
 * Canonical paths are RELATIVE to the owning Rule's sourceNode / destinationNode (D7).
 * Absolute paths are derived for validation, preview, and export.
 */
export interface ChildMapping {
  id: string;
  /** Relative to Rule.sourceNode (canonical). */
  sourcePath: string;
  /** Relative to Rule.destinationNode (canonical). */
  targetPath: string;
  transformationNote?: string;
  /**
   * Optional transformation extension point.
   * Declared for future engines; Step 2 does **not** execute transformations.
   */
  transformation?: TransformationRef;
  rationale?: string;
  status: MappingStatus;
}

/**
 * Opaque transform reference for future execution engines.
 * `type` is an application-defined identifier (e.g. "trim", "lookup", "script").
 */
export interface TransformationRef {
  type: string;
  config?: Record<string, unknown>;
}

/**
 * A Rule is a routing or direct-mapping decision.
 *
 * For rules inside a RuleGroup, the group's `sourceNode` is the routing scope.
 * `Rule.sourceNode` mirrors that scope for self-contained evaluation/export and for
 * legacy direct rules (one group per migrated FieldMapping — no auto-grouping).
 */
export interface Rule {
  id: string;
  name: string;
  category: RuleCategory;
  /**
   * Source node for this rule.
   * Must equal parent RuleGroup.sourceNode (invariant).
   */
  sourceNode: string;
  destinationNode: string;
  kind: RuleKind;
  /** Required when kind === "conditional"; forbidden for unconditional/fallback. */
  condition?: ConditionExpr;
  /**
   * Lower number wins (D1).
   * Within a RuleGroup, rules are evaluated in ascending priority, then list order as tie-break.
   */
  priority: number;
  enabled: boolean;
  /**
   * Owned by the rule. Empty for `category: "direct"`.
   * Paths are relative to sourceNode / destinationNode (D7).
   */
  childMappings: ChildMapping[];
  /** Set when created by v1→v2 migration (D2). */
  migrationSource?: MigrationSource;
  metadata?: Record<string, unknown>;
  rationale?: string;
  status: MappingStatus;
}

/**
 * Routing scope for a single source context.
 * Execution mode is per group — not global to the project (approved extra #1).
 */
export interface RuleGroup {
  id: string;
  name?: string;
  /** Source routing context, e.g. `$.orders`, `$.subscriberList[*]`, or a leaf path for legacy direct rules. */
  sourceNode: string;
  executionMode: ExecutionMode;
  /** Ordered list; evaluation order = sort by priority asc, stable by array index. */
  rules: Rule[];
}

/** Result of selecting rules against a sample document (Preview / Rule Engine). */
export interface RuleMatch {
  ruleGroupId: string;
  ruleId: string;
  reason: string;
  /** When evaluating `[*]`, the array index of the source element (D4). */
  arrayIndex?: number;
}

export interface RuleSkip {
  ruleGroupId: string;
  ruleId: string;
  reason: string;
  arrayIndex?: number;
}

export interface RuleEvaluationResult {
  matched: RuleMatch[];
  skipped: RuleSkip[];
  fallbackUsed: boolean;
  /** Destination nodes selected for this evaluation. */
  destinations: string[];
}

/** Extended validation issue shape for the Rule Platform (engine rewrite comes later). */
export type RuleValidationIssueType =
  | "invalid_condition"
  | "duplicate_rule"
  | "conflicting_rule"
  | "overlapping_rule"
  | "unreachable_rule"
  | "missing_fallback"
  | "multiple_enabled_fallbacks"
  | "datatype_mismatch"
  | "cardinality_mismatch"
  | "array_mismatch"
  | "unmapped_required_target"
  | "unmapped_optional_target"
  | "duplicate_child_mapping"
  | "structurally_unreachable"
  | "unused_mapping"
  | "unused_source"
  | "invariant_violation"
  | "legacy_direct_with_children";

export interface RuleValidationIssue {
  severity: "error" | "warning" | "info";
  type: RuleValidationIssueType;
  ruleGroupId?: string;
  ruleId?: string;
  childMappingId?: string;
  sourcePath?: string;
  targetPath?: string;
  message: string;
  recommendedFix: string;
}
