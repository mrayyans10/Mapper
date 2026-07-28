export type {
  ChildMapping,
  ConditionAtom,
  ConditionExpr,
  ConditionOperator,
  ExecutionMode,
  MigrationSource,
  Rule,
  RuleCategory,
  RuleEvaluationResult,
  RuleGroup,
  RuleKind,
  RuleMatch,
  RuleSkip,
  RuleValidationIssue,
  RuleValidationIssueType,
} from "./types.js";

export {
  PROJECT_SCHEMA_VERSION_V1,
  PROJECT_SCHEMA_VERSION_V2,
} from "./types.js";

export type {
  AbsolutePath,
  JoinPathFn,
  RelativePath,
  ResolvedChildPaths,
} from "./paths.js";

export { RULE_INVARIANTS, type RuleInvariantId } from "./invariants.js";
