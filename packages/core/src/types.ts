/**
 * Shared domain types for Mapping Assurance.
 * Kept UI-independent so validation can run in CLI/CI later.
 */

export type InferredType =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "object"
  | "array";

export type MappingStatus = "draft" | "reviewed" | "approved";

export type IssueSeverity = "error" | "warning" | "info";

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

export interface FieldMapping {
  id: string;
  sourcePath: string;
  targetPath: string;
  transformationNote?: string;
  rationale?: string;
  status: MappingStatus;
}

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
  issues: ValidationIssue[];
}

export interface MappingProject {
  id: string;
  name: string;
  sourceJson: string;
  targetJson: string;
  sourceSchema: SchemaTree;
  targetSchema: SchemaTree;
  mappings: FieldMapping[];
  validationReport: ValidationReport | null;
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
  mappings?: FieldMapping[];
  /** Partial required overrides keyed by schema side + path */
  requiredOverrides?: {
    source?: Record<string, boolean>;
    target?: Record<string, boolean>;
  };
}
