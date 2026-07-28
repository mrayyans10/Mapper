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
  TransformationRef,
} from "./types.js";

export {
  PROJECT_SCHEMA_VERSION_V1,
  PROJECT_SCHEMA_VERSION_V2,
} from "./types.js";

export type {
  AbsolutePath,
  RelativePath,
  ResolvedChildPaths,
  SourceContext,
} from "./paths.js";

export {
  PathError,
  expandSourceContexts,
  getPathValue,
  getPathValues,
  isAbsolutePath,
  isRelativePath,
  joinPath,
  parseAbsolutePath,
  resolveChildPaths,
  resolveConditionValues,
} from "./paths.js";

export {
  ConditionEvalError,
  evaluateCondition,
  type ConditionEvalResult,
} from "./condition-eval.js";

export {
  evaluateRuleGroup,
  evaluateRuleGroups,
  type EvaluateRulesOptions,
} from "./engine.js";

export { RULE_INVARIANTS, type RuleInvariantId } from "./invariants.js";
