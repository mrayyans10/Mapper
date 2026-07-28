import { evaluateCondition } from "./condition-eval.js";
import {
  expandSourceContexts,
  type SourceContext,
} from "./paths.js";
import type {
  Rule,
  RuleEvaluationResult,
  RuleGroup,
  RuleMatch,
  RuleSkip,
} from "./types.js";

export interface EvaluateRulesOptions {
  /**
   * When true (default), first-match groups with >1 enabled fallback
   * skip all fallbacks and record skips (D6).
   */
  enforceSingleFallback?: boolean;
}

function sortRules(rules: Rule[]): Rule[] {
  return rules
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => {
      if (a.rule.priority !== b.rule.priority) {
        return a.rule.priority - b.rule.priority;
      }
      return a.index - b.index;
    })
    .map((x) => x.rule);
}

function isFallback(rule: Rule): boolean {
  return rule.kind === "fallback";
}

function isNormal(rule: Rule): boolean {
  return rule.kind !== "fallback";
}

/**
 * Evaluate all RuleGroups against a sample JSON document.
 * Pure function — no I/O, no UI dependencies.
 *
 * Does **not** apply childMappings or transformations (extension point only).
 */
export function evaluateRuleGroups(
  ruleGroups: RuleGroup[],
  document: unknown,
  options: EvaluateRulesOptions = {},
): RuleEvaluationResult {
  const enforceSingleFallback = options.enforceSingleFallback !== false;
  const matched: RuleMatch[] = [];
  const skipped: RuleSkip[] = [];
  let fallbackUsed = false;
  const destinations = new Set<string>();

  for (const group of ruleGroups) {
    const contexts = expandSourceContexts(document, group.sourceNode);
    for (const ctx of contexts) {
      const result = evaluateGroup(group, ctx, enforceSingleFallback);
      matched.push(...result.matched);
      skipped.push(...result.skipped);
      if (result.fallbackUsed) fallbackUsed = true;
      for (const d of result.destinations) destinations.add(d);
    }
  }

  return {
    matched,
    skipped,
    fallbackUsed,
    destinations: [...destinations],
  };
}

function evaluateGroup(
  group: RuleGroup,
  ctx: SourceContext,
  enforceSingleFallback: boolean,
): RuleEvaluationResult {
  const matched: RuleMatch[] = [];
  const skipped: RuleSkip[] = [];
  let fallbackUsed = false;
  const destinations: string[] = [];

  const ordered = sortRules(group.rules);
  const enabledFallbacks = ordered.filter((r) => r.enabled && isFallback(r));
  const fallbackBlocked =
    enforceSingleFallback &&
    group.executionMode === "first-match" &&
    enabledFallbacks.length > 1;

  if (fallbackBlocked) {
    for (const fb of enabledFallbacks) {
      skipped.push({
        ruleGroupId: group.id,
        ruleId: fb.id,
        reason:
          "Multiple enabled fallback rules in first-match group (D6); fallbacks must not execute",
        arrayIndex: ctx.arrayIndex,
      });
    }
  }

  const normals = ordered.filter((r) => isNormal(r));
  let normalMatched = false;

  for (const rule of normals) {
    if (!rule.enabled) {
      skipped.push({
        ruleGroupId: group.id,
        ruleId: rule.id,
        reason: "Rule disabled",
        arrayIndex: ctx.arrayIndex,
      });
      continue;
    }

    const decision = matchRule(rule, ctx);
    if (!decision.matches) {
      skipped.push({
        ruleGroupId: group.id,
        ruleId: rule.id,
        reason: decision.reason,
        arrayIndex: ctx.arrayIndex,
      });
      continue;
    }

    matched.push({
      ruleGroupId: group.id,
      ruleId: rule.id,
      reason: decision.reason,
      arrayIndex: ctx.arrayIndex,
    });
    destinations.push(rule.destinationNode);
    normalMatched = true;

    if (group.executionMode === "first-match") {
      // Skip remaining normals
      const remaining = normals.slice(normals.indexOf(rule) + 1);
      for (const rest of remaining) {
        if (!rest.enabled) continue;
        skipped.push({
          ruleGroupId: group.id,
          ruleId: rest.id,
          reason: "Skipped due to first-match (higher-priority rule already matched)",
          arrayIndex: ctx.arrayIndex,
        });
      }
      break;
    }
  }

  // Fallback: only when no normal rule matched
  if (!normalMatched && !fallbackBlocked) {
    const fallbacks = ordered.filter((r) => r.enabled && isFallback(r));
    if (fallbacks.length === 1) {
      const fb = fallbacks[0]!;
      matched.push({
        ruleGroupId: group.id,
        ruleId: fb.id,
        reason: "Fallback — no normal rule matched",
        arrayIndex: ctx.arrayIndex,
      });
      destinations.push(fb.destinationNode);
      fallbackUsed = true;
    } else if (fallbacks.length > 1 && group.executionMode === "all-match") {
      // D6 text focuses on first-match; for all-match still disallow multiple enabled fallbacks at runtime.
      for (const fb of fallbacks) {
        skipped.push({
          ruleGroupId: group.id,
          ruleId: fb.id,
          reason:
            "Multiple enabled fallback rules; fallbacks must not execute until resolved",
          arrayIndex: ctx.arrayIndex,
        });
      }
    }
  } else if (normalMatched) {
    for (const fb of ordered.filter((r) => isFallback(r) && r.enabled)) {
      if (fallbackBlocked) continue; // already recorded
      skipped.push({
        ruleGroupId: group.id,
        ruleId: fb.id,
        reason: "Fallback not needed — a normal rule matched",
        arrayIndex: ctx.arrayIndex,
      });
    }
  }

  return { matched, skipped, fallbackUsed, destinations };
}

function matchRule(
  rule: Rule,
  ctx: SourceContext,
): { matches: boolean; reason: string } {
  if (rule.kind === "unconditional" || rule.category === "direct") {
    return { matches: true, reason: "Unconditional rule matched" };
  }

  if (rule.kind === "conditional") {
    if (!rule.condition) {
      return {
        matches: false,
        reason: "Conditional rule missing condition expression",
      };
    }
    const result = evaluateCondition(rule.condition, ctx);
    if (result.error) {
      return {
        matches: false,
        reason: `Condition error: ${result.error}`,
      };
    }
    return result.ok
      ? { matches: true, reason: "Condition matched" }
      : { matches: false, reason: "Condition not matched" };
  }

  return { matches: false, reason: `Unsupported rule kind: ${rule.kind}` };
}

/** Evaluate a single RuleGroup (helper for tests). */
export function evaluateRuleGroup(
  group: RuleGroup,
  document: unknown,
  options?: EvaluateRulesOptions,
): RuleEvaluationResult {
  return evaluateRuleGroups([group], document, options);
}
