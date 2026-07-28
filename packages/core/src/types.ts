/**
 * Shared domain types for Mapping Assurance.
 * Kept UI-independent so validation can run in CLI/CI later.
 */

import type { RuleGroup, RuleValidationIssue } from "./rule/types.js";
import {
  PROJECT_SCHEMA_VERSION_V1,
  PROJECT_SCHEMA_VERSION_V2,
} from "./rule/types.js";

export type InferredType =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "object"
  | "array";

export type MappingStatus = "draft" | "reviewed" | "approved";

export type IssueSeverity = "error" | "warning" | "info";

/** @deprecated Prefer RuleValidationIssueType for schemaVersion >= 2. */
export type IssueType =
  | "unmapped_required_target"
  | "unmapped_optional_target"
  | "unused_source"
  | "primitive_datatype_conflict"
  | "object_to_primitive_conflict"
  | "array_to_non_array_conflict"
  | "duplicate_target_mapping"
  | "source_multi_target_conflict"
  | "structurally_unreachable";

/** JSONPath-style path: $.a.b, $.items[*], $.items[*].id */
export interface SchemaNode {
  path: string;
  name: string;
  type: InferredType;
  isInsideArray: boolean;
  parentPath: string | null;
  childPaths: string[];
  exampleValue: unknown;
  /** User-editable for sample JSON; defaults to false. */
  required: boolean;
}

export interface SchemaTree {
  rootPath: string;
  nodes: Record<string, SchemaNode>;
}

/**
 * Legacy v1 atomic mapping (schemaVersion 1).
 * Migrated to unconditional `category: "direct"` Rules with
 * `migrationSource: "FIELD_MAPPING_V1"` (D2). Do not create new ones in v2 UI.
 */
export interface FieldMapping {
  id: string;
  sourcePath: string;
  targetPath: string;
  transformationNote?: string;
  rationale?: string;
  status: MappingStatus;
}

/** @deprecated Prefer RuleValidationIssue for schemaVersion >= 2. */
export interface ValidationIssue {
  severity: IssueSeverity;
  issueType: IssueType;
  sourcePath?: string;
  targetPath?: string;
  explanation: string;
  suggestedAction: string;
}

export interface ValidationSummary {
  requiredTargetFieldsMissing: number;
  optionalTargetFieldsUnmapped: number;
  datatypeConflicts: number;
  arraysNeedingManualReview: number;
  potentialDuplicateMappings: number;
  unusedSourceFields: number;
  structurallyUnreachable: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export interface ValidationReport {
  generatedAt: string;
  summary: ValidationSummary;
  /** Legacy v1 issues and/or adapted messages during transition. */
  issues: ValidationIssue[];
  /** Rule Platform issues (schemaVersion >= 2). */
  ruleIssues?: RuleValidationIssue[];
}

/**
 * Preview report shape (engine implemented in a later tranche).
 */
export interface PreviewReport {
  generatedAt: string;
  matchedRules: Array<{
    ruleGroupId: string;
    ruleId: string;
    reason: string;
    arrayIndex?: number;
  }>;
  skippedRules: Array<{
    ruleGroupId: string;
    ruleId: string;
    reason: string;
    arrayIndex?: number;
  }>;
  fallbackUsed: boolean;
  destinations: string[];
  resultObject: unknown;
}

export interface MappingProject {
  id: string;
  name: string;
  /**
   * Document version.
   * 1 = FieldMapping[] only (legacy).
   * 2 = ruleGroups is canonical; mappings retained for rollback safety until retired.
   */
  schemaVersion: typeof PROJECT_SCHEMA_VERSION_V1 | typeof PROJECT_SCHEMA_VERSION_V2;
  sourceJson: string;
  targetJson: string;
  sourceSchema: SchemaTree;
  targetSchema: SchemaTree;
  /**
   * Canonical v2 model: routing scopes with ordered rules.
   * Empty array allowed for brand-new projects before rules are added.
   */
  ruleGroups: RuleGroup[];
  /**
   * Legacy v1 mappings. Retained after migration for rollback-safe DB dual-write.
   * Readers at v2 should prefer ruleGroups; writers may keep this in sync until v3.
   */
  mappings: FieldMapping[];
  validationReport: ValidationReport | null;
  previewReport?: PreviewReport | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  sourceJson: string;
  targetJson: string;
}

export interface UpdateProjectInput {
  name?: string;
  sourceJson?: string;
  targetJson?: string;
  /** @deprecated Prefer ruleGroups for v2. */
  mappings?: FieldMapping[];
  ruleGroups?: RuleGroup[];
  /** Partial required overrides keyed by schema side + path */
  requiredOverrides?: {
    source?: Record<string, boolean>;
    target?: Record<string, boolean>;
  };
}

export {
  PROJECT_SCHEMA_VERSION_V1,
  PROJECT_SCHEMA_VERSION_V2,
};
