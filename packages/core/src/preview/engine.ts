import { evaluateRuleGroups } from "../rule/engine.js";
import { getPathValue, joinPath } from "../rule/paths.js";
import type { Rule, RuleGroup } from "../rule/types.js";
import type { PreviewReport } from "../types.js";

export interface PreviewTraceStep {
  ruleGroupId: string;
  ruleId: string;
  action: "matched" | "skipped" | "fallback" | "child_copy" | "direct_copy";
  detail: string;
  arrayIndex?: number;
  sourcePath?: string;
  targetPath?: string;
  /** Present when a transformation ref exists but was not executed. */
  transformationDeferred?: { type: string };
}

export interface PreviewEngineReport extends PreviewReport {
  traces: PreviewTraceStep[];
  /** Warnings about deferred behavior (e.g. transformations not applied). */
  notes: string[];
}

export interface PreviewOptions {
  /**
   * Optional target document skeleton. When omitted, destinations are built as
   * a new object graph from matched rules / child copies.
   */
  targetDocument?: unknown;
}

function setAtPath(root: Record<string, unknown>, absolutePath: string, value: unknown): void {
  if (absolutePath === "$") return;
  if (!absolutePath.startsWith("$.")) return;
  const parts = absolutePath.slice(2).split(".");
  let current: Record<string, unknown> = root;
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i]!;
    const isWildcard = raw.endsWith("[*]");
    const key = isWildcard ? raw.slice(0, -3) : raw;
    if (i === parts.length - 1) {
      if (isWildcard) {
        // MVP: write into index 0 of the array for preview illustration.
        const existing = current[key];
        const arr = Array.isArray(existing) ? [...existing] : [];
        arr[0] = value;
        current[key] = arr;
      } else {
        current[key] = value;
      }
      return;
    }
    if (isWildcard) {
      const existing = current[key];
      const arr = Array.isArray(existing) ? existing : [];
      if (!arr[0] || typeof arr[0] !== "object") {
        arr[0] = {};
      }
      current[key] = arr;
      current = arr[0] as Record<string, unknown>;
    } else {
      const next = current[key];
      if (!next || typeof next !== "object" || Array.isArray(next)) {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findRule(ruleGroups: RuleGroup[], ruleId: string): Rule | undefined {
  for (const g of ruleGroups) {
    const found = g.rules.find((r) => r.id === ruleId);
    if (found) return found;
  }
  return undefined;
}

/**
 * Preview Engine — simulate rule selection and structural field copies.
 * Does **not** execute `ChildMapping.transformation` (extension point only).
 */
export function previewRuleGroups(
  ruleGroups: RuleGroup[],
  sourceDocument: unknown,
  options: PreviewOptions = {},
): PreviewEngineReport {
  const evaluation = evaluateRuleGroups(ruleGroups, sourceDocument);
  const traces: PreviewTraceStep[] = [];
  const notes: string[] = [];

  for (const m of evaluation.matched) {
    traces.push({
      ruleGroupId: m.ruleGroupId,
      ruleId: m.ruleId,
      action: m.reason.startsWith("Fallback") ? "fallback" : "matched",
      detail: m.reason,
      arrayIndex: m.arrayIndex,
    });
  }
  for (const s of evaluation.skipped) {
    traces.push({
      ruleGroupId: s.ruleGroupId,
      ruleId: s.ruleId,
      action: "skipped",
      detail: s.reason,
      arrayIndex: s.arrayIndex,
    });
  }

  const resultObject: Record<string, unknown> =
    options.targetDocument &&
    typeof options.targetDocument === "object" &&
    options.targetDocument !== null &&
    !Array.isArray(options.targetDocument)
      ? (cloneJson(options.targetDocument) as Record<string, unknown>)
      : {};

  for (const match of evaluation.matched) {
    const rule = findRule(ruleGroups, match.ruleId);
    if (!rule) continue;

    if (rule.category === "direct" || rule.childMappings.length === 0) {
      // Direct / route-only: copy source node value onto destination node.
      const value = getPathValue(sourceDocument, rule.sourceNode);
      setAtPath(resultObject, rule.destinationNode, value);
      traces.push({
        ruleGroupId: match.ruleGroupId,
        ruleId: rule.id,
        action: "direct_copy",
        detail: `Copied ${rule.sourceNode} → ${rule.destinationNode}`,
        sourcePath: rule.sourceNode,
        targetPath: rule.destinationNode,
        arrayIndex: match.arrayIndex,
      });
      continue;
    }

    for (const child of rule.childMappings) {
      const absSource = joinPath(rule.sourceNode, child.sourcePath);
      const absTarget = joinPath(rule.destinationNode, child.targetPath);

      // For array-indexed matches, prefer reading from the matched element when
      // sourceNode contains [*] and child path is relative.
      let value: unknown;
      if (match.arrayIndex !== undefined && rule.sourceNode.includes("[*]")) {
        const elementPath = rule.sourceNode.replace(
          "[*]",
          /* approximate: use getPathValue on full abs path which expands [*] */
          "[*]",
        );
        void elementPath;
        // Read via absolute path — getPathValue returns first; for correct index,
        // resolve the array then index.
        value = getIndexedArrayChildValue(
          sourceDocument,
          rule.sourceNode,
          child.sourcePath,
          match.arrayIndex,
        );
      } else {
        value = getPathValue(sourceDocument, absSource);
      }

      if (child.transformation) {
        notes.push(
          `Transformation "${child.transformation.type}" on child ${child.id} was not executed (extension point only).`,
        );
        traces.push({
          ruleGroupId: match.ruleGroupId,
          ruleId: rule.id,
          action: "child_copy",
          detail: `Copied ${absSource} → ${absTarget} without applying transformation`,
          sourcePath: absSource,
          targetPath: absTarget,
          arrayIndex: match.arrayIndex,
          transformationDeferred: { type: child.transformation.type },
        });
      } else {
        traces.push({
          ruleGroupId: match.ruleGroupId,
          ruleId: rule.id,
          action: "child_copy",
          detail: `Copied ${absSource} → ${absTarget}`,
          sourcePath: absSource,
          targetPath: absTarget,
          arrayIndex: match.arrayIndex,
        });
      }
      setAtPath(resultObject, absTarget, value);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    matchedRules: evaluation.matched.map((m) => ({
      ruleGroupId: m.ruleGroupId,
      ruleId: m.ruleId,
      reason: m.reason,
      arrayIndex: m.arrayIndex,
    })),
    skippedRules: evaluation.skipped.map((s) => ({
      ruleGroupId: s.ruleGroupId,
      ruleId: s.ruleId,
      reason: s.reason,
      arrayIndex: s.arrayIndex,
    })),
    fallbackUsed: evaluation.fallbackUsed,
    destinations: evaluation.destinations,
    resultObject,
    traces,
    notes,
  };
}

function getIndexedArrayChildValue(
  document: unknown,
  sourceNodeWithStar: string,
  relativeChild: string,
  arrayIndex: number,
): unknown {
  const star = sourceNodeWithStar.indexOf("[*]");
  if (star === -1) {
    return getPathValue(document, joinPath(sourceNodeWithStar, relativeChild));
  }
  const arrayPath = sourceNodeWithStar.slice(0, star);
  const arr = getPathValue(document, arrayPath);
  if (!Array.isArray(arr) || arrayIndex >= arr.length) return undefined;
  const element = arr[arrayIndex];
  if (relativeChild === "" || relativeChild === ".") return element;
  if (element === null || typeof element !== "object") return undefined;
  // Walk relative path on element
  const parts = relativeChild.replace(/^\./, "").split(".");
  let current: unknown = element;
  for (const part of parts) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
