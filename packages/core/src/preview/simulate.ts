import { evaluateCondition } from "../rule/condition-eval.js";
import { resolveRuleCopyMode } from "../rule/copy-mode.js";
import { previewRuleGroups } from "../preview/engine.js";
import {
  expandSourceContexts,
  joinPathAware,
  getPathValue,
} from "../rule/paths.js";
import type { Rule, RuleGroup } from "../rule/types.js";

export interface RuleSimulationRequest {
  rule: Rule;
  /** Parent group context (sourceNode + executionMode used for framing). */
  ruleGroup: Pick<RuleGroup, "id" | "sourceNode" | "executionMode">;
  /** Full sample document OR a fragment that will be wrapped under sourceNode when needed. */
  sampleDocument: unknown;
}

export interface RuleSimulationResult {
  ruleId: string;
  ruleGroupId: string;
  condition: {
    present: boolean;
    matched: boolean | null;
    error?: string;
    detail: string;
  };
  matchedRoute: string | null;
  copyMode: string;
  childMappingsExecuted: Array<{
    id: string;
    sourcePath: string;
    targetPath: string;
    absoluteSource: string;
    absoluteTarget: string;
    value: unknown;
    transformationDeferred?: string;
  }>;
  unmappedRelativeFields: string[];
  skippedReason?: string;
  resultObject: unknown;
  warnings: string[];
  traces: Array<{ action: string; detail: string }>;
}

/**
 * Lightweight single-rule simulator (Step 5).
 * Reuses Preview engine by evaluating a synthetic one-rule group.
 */
export function simulateRule(
  request: RuleSimulationRequest,
): RuleSimulationResult {
  const { rule, ruleGroup } = request;
  const warnings: string[] = [];
  const traces: Array<{ action: string; detail: string }> = [];

  if (!rule.enabled) {
    return {
      ruleId: rule.id,
      ruleGroupId: ruleGroup.id,
      condition: {
        present: Boolean(rule.condition),
        matched: false,
        detail: "Rule is disabled",
      },
      matchedRoute: null,
      copyMode: resolveRuleCopyMode(rule),
      childMappingsExecuted: [],
      unmappedRelativeFields: [],
      skippedReason: "Rule disabled",
      resultObject: {},
      warnings,
      traces: [{ action: "skipped", detail: "Rule disabled" }],
    };
  }

  const document = coerceSampleDocument(
    request.sampleDocument,
    ruleGroup.sourceNode,
  );

  // Condition probe on first expanded context
  const contexts = expandSourceContexts(document, ruleGroup.sourceNode);
  const ctx = contexts[0] ?? { relativeRoot: undefined, document };
  let conditionMatched: boolean | null = null;
  let conditionError: string | undefined;
  let conditionDetail = "No condition (unconditional / fallback / direct)";

  if (rule.kind === "conditional" && rule.condition) {
    const evalResult = evaluateCondition(rule.condition, ctx);
    conditionMatched = evalResult.ok;
    conditionError = evalResult.error;
    conditionDetail = evalResult.error
      ? `Condition error: ${evalResult.error}`
      : evalResult.ok
        ? "Condition matched"
        : "Condition not matched";
    traces.push({ action: "condition", detail: conditionDetail });
  } else {
    conditionMatched = true;
    traces.push({ action: "condition", detail: conditionDetail });
  }

  const syntheticGroup: RuleGroup = {
    id: ruleGroup.id,
    sourceNode: ruleGroup.sourceNode,
    executionMode: "all-match",
    rules: [{ ...rule, sourceNode: ruleGroup.sourceNode, enabled: true }],
  };

  // If conditional failed, still report without running preview materialization
  if (rule.kind === "conditional" && conditionMatched === false) {
    return {
      ruleId: rule.id,
      ruleGroupId: ruleGroup.id,
      condition: {
        present: true,
        matched: false,
        error: conditionError,
        detail: conditionDetail,
      },
      matchedRoute: null,
      copyMode: resolveRuleCopyMode(rule),
      childMappingsExecuted: [],
      unmappedRelativeFields: listUnmappedFields(rule, document),
      skippedReason: conditionDetail,
      resultObject: {},
      warnings,
      traces: [
        ...traces,
        { action: "skipped", detail: "Rule did not match sample" },
      ],
    };
  }

  const preview = previewRuleGroups([syntheticGroup], document);
  warnings.push(...(preview.warnings ?? []));

  const copyMode = resolveRuleCopyMode(rule);
  const childMappingsExecuted = rule.childMappings.map((c) => {
    const absoluteSource = joinPathAware(
      ruleGroup.sourceNode,
      c.sourcePath,
      ruleGroup.sourceNode.includes("[*]"),
    );
    const absoluteTarget = joinPathAware(
      rule.destinationNode,
      c.targetPath,
      rule.destinationNode.includes("[*]") ||
        ruleGroup.sourceNode.includes("[*]"),
    );
    const value = getPathValue(document, absoluteSource);
    if (c.transformation) {
      warnings.push(
        `WARNING: Transformation "${c.transformation.type}" on child "${c.id}" was NOT executed.`,
      );
    }
    return {
      id: c.id,
      sourcePath: c.sourcePath,
      targetPath: c.targetPath,
      absoluteSource,
      absoluteTarget,
      value,
      transformationDeferred: c.transformation?.type,
    };
  });

  for (const t of preview.traces ?? []) {
    traces.push({ action: t.action, detail: t.detail });
  }

  return {
    ruleId: rule.id,
    ruleGroupId: ruleGroup.id,
    condition: {
      present: Boolean(rule.condition) || rule.kind === "conditional",
      matched: conditionMatched,
      error: conditionError,
      detail: conditionDetail,
    },
    matchedRoute: rule.destinationNode,
    copyMode,
    childMappingsExecuted,
    unmappedRelativeFields: listUnmappedFields(rule, document),
    resultObject: preview.resultObject,
    warnings,
    traces,
  };
}

function coerceSampleDocument(sample: unknown, sourceNode: string): unknown {
  // If sample already looks like a full document with the path, use as-is.
  if (sample && typeof sample === "object" && !Array.isArray(sample)) {
    const pathOk =
      sourceNode === "$" ||
      getPathValue(sample, sourceNode.replace(/\[\*]/g, "")) !== undefined ||
      sourceNode.includes("[*]");
    if (pathOk || sourceNode === "$") return sample;

    // Treat sample as the node value: wrap under sourceNode path (best-effort for simple paths).
    if (!sourceNode.includes("[*]") && sourceNode.startsWith("$.")) {
      return setValueAtPath({}, sourceNode, sample);
    }
  }
  if (!sourceNode.includes("[*]") && sourceNode.startsWith("$.")) {
    return setValueAtPath({}, sourceNode, sample);
  }
  return sample;
}

function setValueAtPath(
  root: Record<string, unknown>,
  absolutePath: string,
  value: unknown,
): Record<string, unknown> {
  const parts = absolutePath.replace(/^\$\./, "").split(".");
  let current: Record<string, unknown> = root;
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i]!;
    if (i === parts.length - 1) {
      current[key] = value;
    } else {
      if (
        typeof current[key] !== "object" ||
        current[key] === null ||
        Array.isArray(current[key])
      ) {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }
  }
  return root;
}

function listUnmappedFields(rule: Rule, document: unknown): string[] {
  // Heuristic: if relativeRoot is an object, list keys not covered by child sourcePaths.
  const contexts = expandSourceContexts(
    document,
    rule.sourceNode.includes("$") ? rule.sourceNode : `$.${rule.sourceNode}`,
  );
  const root = contexts[0]?.relativeRoot;
  if (!root || typeof root !== "object" || Array.isArray(root)) return [];
  const keys = Object.keys(root as Record<string, unknown>);
  const mapped = new Set(
    rule.childMappings.map((c) => c.sourcePath.split(".")[0] ?? c.sourcePath),
  );
  if (resolveRuleCopyMode(rule) === "COPY_SOURCE_NODE") return [];
  if (resolveRuleCopyMode(rule) === "ROUTE_ONLY") return keys;
  return keys.filter((k) => !mapped.has(k));
}
