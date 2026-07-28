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
  expandEquivalentPaths,
  expandSourceContexts,
  getPathValue,
  getPathValues,
  isAbsolutePath,
  isMappedPath,
  isRelativePath,
  joinPath,
  joinPathAware,
  lookupSchemaPath,
  markMappedPath,
  normalizeArrayPath,
  parseAbsolutePath,
  pathsEquivalent,
  resolveChildPaths,
  resolveConditionValues,
  schemaHasPath,
} from "./paths.js";

export { resolveRuleCopyMode } from "./copy-mode.js";
export type { RuleCopyMode } from "./types.js";
export type { RequiredFieldScope } from "./types.js";

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
