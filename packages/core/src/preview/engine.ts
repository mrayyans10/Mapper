import { resolveRuleCopyMode } from "../rule/copy-mode.js";
import { evaluateRuleGroups } from "../rule/engine.js";
import { getPathValue, joinPathAware } from "../rule/paths.js";
import type { Rule, RuleGroup } from "../rule/types.js";
import type { PreviewReport } from "../types.js";

export interface PreviewTraceStep {
  ruleGroupId: string;
  ruleId: string;
  action:
    | "matched"
    | "skipped"
    | "fallback"
    | "child_copy"
    | "direct_copy"
    | "route_only";
  detail: string;
  arrayIndex?: number;
  sourcePath?: string;
  targetPath?: string;
  transformationDeferred?: { type: string };
}

export interface PreviewEngineReport extends PreviewReport {
  traces: PreviewTraceStep[];
  notes: string[];
  warnings: string[];
}

export interface PreviewOptions {
  targetDocument?: unknown;
}

type JsonObject = Record<string, unknown>;

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

/** Writer that appends into target arrays (P1) instead of always using index 0. */
class PreviewWriter {
  constructor(private readonly root: JsonObject) {}

  /**
   * Allocate/append an object element under an array destination for one match.
   * Returns the concrete element index written.
   */
  allocateArrayElement(arrayPath: string): number {
    const parts = this.split(arrayPath);
    const { parent, key } = this.navigateToParent(parts);
    const existing = parent[key];
    const arr = Array.isArray(existing) ? existing : [];
    const index = arr.length;
    arr.push({});
    parent[key] = arr;
    return index;
  }

  writeField(
    absolutePath: string,
    value: unknown,
    concreteArrayIndex?: number,
  ): void {
    if (!absolutePath.startsWith("$.")) return;
    const rawParts = absolutePath.slice(2).split(".");
    const parts = rawParts.map((p) => {
      if (p.endsWith("[*]")) {
        return {
          key: p.slice(0, -3),
          array: true as const,
        };
      }
      return { key: p, array: false as const };
    });

    let current: unknown = this.root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLast = i === parts.length - 1;
      if (part.array) {
        if (typeof current !== "object" || current === null || Array.isArray(current)) {
          return;
        }
        const obj = current as JsonObject;
        let arr = obj[part.key];
        if (!Array.isArray(arr)) {
          arr = [];
          obj[part.key] = arr;
        }
        const idx =
          concreteArrayIndex !== undefined
            ? concreteArrayIndex
            : Math.max(0, (arr as unknown[]).length - 1);
        while ((arr as unknown[]).length <= idx) {
          (arr as unknown[]).push({});
        }
        if (isLast) {
          (arr as unknown[])[idx] = value;
          return;
        }
        if (
          typeof (arr as unknown[])[idx] !== "object" ||
          (arr as unknown[])[idx] === null ||
          Array.isArray((arr as unknown[])[idx])
        ) {
          (arr as unknown[])[idx] = {};
        }
        current = (arr as unknown[])[idx];
      } else if (isLast) {
        if (typeof current !== "object" || current === null || Array.isArray(current)) {
          return;
        }
        (current as JsonObject)[part.key] = value;
      } else {
        if (typeof current !== "object" || current === null || Array.isArray(current)) {
          return;
        }
        const obj = current as JsonObject;
        if (
          typeof obj[part.key] !== "object" ||
          obj[part.key] === null ||
          Array.isArray(obj[part.key])
        ) {
          obj[part.key] = {};
        }
        current = obj[part.key];
      }
    }
  }

  writeNode(absolutePath: string, value: unknown): void {
    if (absolutePath === "$") return;
    if (!absolutePath.startsWith("$.")) return;
    // Whole-node write at path (may be array append if path ends with [*])
    if (absolutePath.endsWith("[*]")) {
      const arrayPath = absolutePath.slice(0, -3);
      const parts = this.split(arrayPath);
      const { parent, key } = this.navigateToParent(parts);
      const existing = parent[key];
      const arr = Array.isArray(existing) ? existing : [];
      arr.push(value);
      parent[key] = arr;
      return;
    }
    this.writeField(absolutePath, value);
  }

  private split(absolutePath: string): string[] {
    return absolutePath.replace(/^\$\./, "").split(".");
  }

  private navigateToParent(parts: string[]): {
    parent: JsonObject;
    key: string;
  } {
    let current: JsonObject = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i]!.replace(/\[\*\]$/, "");
      if (
        typeof current[key] !== "object" ||
        current[key] === null ||
        Array.isArray(current[key])
      ) {
        current[key] = {};
      }
      current = current[key] as JsonObject;
    }
    const last = parts[parts.length - 1]!.replace(/\[\*\]$/, "");
    return { parent: current, key: last };
  }
}

function getIndexedArrayChildValue(
  document: unknown,
  sourceNodeWithStar: string,
  relativeChild: string,
  arrayIndex: number,
): unknown {
  const star = sourceNodeWithStar.indexOf("[*]");
  if (star === -1) {
    return getPathValue(
      document,
      joinPathAware(sourceNodeWithStar, relativeChild, false),
    );
  }
  const arrayPath = sourceNodeWithStar.slice(0, star);
  const arr = getPathValue(document, arrayPath);
  if (!Array.isArray(arr) || arrayIndex >= arr.length) return undefined;
  const element = arr[arrayIndex];
  if (relativeChild === "" || relativeChild === ".") return element;
  if (element === null || typeof element !== "object") return undefined;
  const parts = relativeChild.replace(/^\./, "").split(".");
  let current: unknown = element;
  for (const part of parts) {
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as JsonObject)[part];
  }
  return current;
}

/**
 * Preview Engine — simulate rule selection and structural field copies.
 * Transformations are not executed; clear warnings are emitted (P3).
 */
export function previewRuleGroups(
  ruleGroups: RuleGroup[],
  sourceDocument: unknown,
  options: PreviewOptions = {},
): PreviewEngineReport {
  const evaluation = evaluateRuleGroups(ruleGroups, sourceDocument);
  const traces: PreviewTraceStep[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];

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

  const resultObject: JsonObject =
    options.targetDocument &&
    typeof options.targetDocument === "object" &&
    options.targetDocument !== null &&
    !Array.isArray(options.targetDocument)
      ? (cloneJson(options.targetDocument) as JsonObject)
      : {};

  const writer = new PreviewWriter(resultObject);

  for (const match of evaluation.matched) {
    const rule = findRule(ruleGroups, match.ruleId);
    if (!rule) continue;

    const mode = resolveRuleCopyMode(rule);

    if (mode === "ROUTE_ONLY") {
      traces.push({
        ruleGroupId: match.ruleGroupId,
        ruleId: rule.id,
        action: "route_only",
        detail: `Route-only: selected destination ${rule.destinationNode} (no payload copy)`,
        targetPath: rule.destinationNode,
        arrayIndex: match.arrayIndex,
      });
      continue;
    }

    if (mode === "COPY_SOURCE_NODE") {
      let value: unknown;
      if (match.arrayIndex !== undefined && rule.sourceNode.includes("[*]")) {
        value = getIndexedArrayChildValue(
          sourceDocument,
          rule.sourceNode,
          "",
          match.arrayIndex,
        );
      } else {
        value = getPathValue(sourceDocument, rule.sourceNode);
      }

      const dest = rule.destinationNode;
      if (dest.endsWith("[*]")) {
        writer.writeNode(dest, value);
      } else if (match.arrayIndex !== undefined) {
        // Append into destination array container when source was per-element
        writer.writeNode(dest, value);
        // If dest is an array field, append; writeNode on non-[*] replaces.
        // Use explicit append form:
        const parts = dest.replace(/^\$\./, "").split(".");
        // Re-read and convert to append for top-level array destinations
        const top = parts[0]!;
        if (parts.length === 1) {
          const existing = resultObject[top];
          const arr = Array.isArray(existing) ? existing : [];
          // If we already wrote a non-array, convert
          if (!Array.isArray(existing)) {
            resultObject[top] = value !== undefined ? [value] : [];
          } else {
            arr.push(value);
            resultObject[top] = arr;
          }
        } else {
          writer.writeNode(dest, value);
        }
      } else {
        writer.writeNode(dest, value);
      }

      traces.push({
        ruleGroupId: match.ruleGroupId,
        ruleId: rule.id,
        action: "direct_copy",
        detail: `COPY_SOURCE_NODE: ${rule.sourceNode} → ${rule.destinationNode}`,
        sourcePath: rule.sourceNode,
        targetPath: rule.destinationNode,
        arrayIndex: match.arrayIndex,
      });
      continue;
    }

    // APPLY_CHILD_MAPPINGS
    const destIsArray =
      rule.destinationNode.endsWith("[*]") ||
      /\[\*\]/.test(rule.destinationNode);
    const destArrayPath = rule.destinationNode.endsWith("[*]")
      ? rule.destinationNode.slice(0, -3)
      : rule.destinationNode.includes("[*]")
        ? rule.destinationNode.slice(0, rule.destinationNode.indexOf("[*]"))
        : rule.destinationNode;

    // Append into a target array only when the match is array-sourced or dest is explicitly array.
    const treatAsArrayItems =
      destIsArray ||
      match.arrayIndex !== undefined ||
      rule.sourceNode.includes("[*]");

    let targetElementIndex: number | undefined;
    if (treatAsArrayItems) {
      const container = destArrayPath;
      targetElementIndex = writer.allocateArrayElement(container);
    }

    for (const child of rule.childMappings) {
      const absSource = joinPathAware(
        rule.sourceNode,
        child.sourcePath,
        rule.sourceNode.endsWith("[*]") || rule.sourceNode.includes("[*]"),
      );
      const absTarget = joinPathAware(
        treatAsArrayItems ? `${destArrayPath}[*]` : rule.destinationNode,
        child.targetPath,
        treatAsArrayItems,
      );

      let value: unknown;
      if (match.arrayIndex !== undefined && rule.sourceNode.includes("[*]")) {
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
        const warning = `WARNING: Transformation "${child.transformation.type}" on child mapping "${child.id}" (rule "${rule.id}") was NOT executed. Preview applies structural copy only.`;
        warnings.push(warning);
        notes.push(warning);
        traces.push({
          ruleGroupId: match.ruleGroupId,
          ruleId: rule.id,
          action: "child_copy",
          detail: warning,
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
          detail: `Copied ${absSource} → ${absTarget}${
            targetElementIndex !== undefined
              ? ` [targetIndex=${targetElementIndex}]`
              : ""
          }`,
          sourcePath: absSource,
          targetPath: absTarget,
          arrayIndex: match.arrayIndex,
        });
      }

      writer.writeField(absTarget, value, targetElementIndex);
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
    warnings,
  };
}
