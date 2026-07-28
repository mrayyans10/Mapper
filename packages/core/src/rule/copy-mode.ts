import type { Rule, RuleCopyMode } from "./types.js";

/**
 * Resolve effective copy mode (P2).
 * Direct legacy rules always COPY_SOURCE_NODE.
 */
export function resolveRuleCopyMode(rule: Rule): RuleCopyMode {
  if (rule.category === "direct") {
    return "COPY_SOURCE_NODE";
  }
  if (rule.copyMode) {
    return rule.copyMode;
  }
  if (rule.childMappings.length > 0) {
    return "APPLY_CHILD_MAPPINGS";
  }
  return "ROUTE_ONLY";
}
