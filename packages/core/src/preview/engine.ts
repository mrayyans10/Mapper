import { resolveRuleCopyMode } from "../rule/copy-mode.js";
import { evaluateRuleGroups } from "../rule/engine.js";
import {
  getPathValue,
  getPathValues,
  isAbsolutePath,
  joinPathAware,
  parseAbsolutePath,
} from "../rule/paths.js";
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

/** Array container path for the last `[*]` in a destination (supports nested / root-array). */
function lastArrayContainerPath(destinationNode: string): string {
  const idx = destinationNode.lastIndexOf("[*]");
  if (idx === -1) return destinationNode;
  return destinationNode.slice(0, idx);
}

/**
 * Writer that appends into target arrays (P1).
 * Supports object roots (`$.…`) and root-array documents (`$[*]…`).
 */
class PreviewWriter {
  private data: unknown;

  constructor(initial: unknown) {
    if (initial === undefined) {
      this.data = {};
    } else {
      this.data = cloneJson(initial);
    }
  }

  getResult(): unknown {
    return this.data;
  }

  /**
   * Allocate/append an object element under an array destination for one match.
   * Returns the concrete element index written at the final array segment.
   */
  allocateArrayElement(arrayPath: string): number {
    if (arrayPath === "$") {
      if (!Array.isArray(this.data)) this.data = [];
      const arr = this.data as unknown[];
      const index = arr.length;
      arr.push({});
      return index;
    }

    if (!isAbsolutePath(arrayPath)) return 0;

    // Ensure parent structure exists, then append to the terminal array.
    if (arrayPath === "$[*]" || arrayPath.startsWith("$[*]")) {
      if (!Array.isArray(this.data)) this.data = [];
    } else if (
      this.data === null ||
      typeof this.data !== "object" ||
      Array.isArray(this.data)
    ) {
      this.data = {};
    }

    const segments = parseAbsolutePath(arrayPath);
    let current: unknown = this.data;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const isLast = i === segments.length - 1;

      if (seg.key === "" && seg.wildcard) {
        // Root array
        if (!Array.isArray(current)) {
          this.data = [];
          current = this.data;
        }
        if (isLast) {
          const arr = current as unknown[];
          const index = arr.length;
          arr.push({});
          return index;
        }
        // Intermediate root array: use / create index 0
        const arr = current as unknown[];
        if (arr.length === 0) arr.push({});
        if (
          typeof arr[0] !== "object" ||
          arr[0] === null ||
          Array.isArray(arr[0])
        ) {
          arr[0] = {};
        }
        current = arr[0];
        continue;
      }

      if (current === null || typeof current !== "object" || Array.isArray(current)) {
        return 0;
      }
      const obj = current as JsonObject;

      // Final segment of an array-container path is the array field (even without [*] suffix).
      if (seg.wildcard || isLast) {
        let arr = obj[seg.key];
        if (!Array.isArray(arr)) {
          arr = [];
          obj[seg.key] = arr;
        }
        if (isLast) {
          const index = (arr as unknown[]).length;
          (arr as unknown[]).push({});
          return index;
        }
        if ((arr as unknown[]).length === 0) (arr as unknown[]).push({});
        if (
          typeof (arr as unknown[])[0] !== "object" ||
          (arr as unknown[])[0] === null ||
          Array.isArray((arr as unknown[])[0])
        ) {
          (arr as unknown[])[0] = {};
        }
        current = (arr as unknown[])[0];
      } else {
        if (
          typeof obj[seg.key] !== "object" ||
          obj[seg.key] === null ||
          Array.isArray(obj[seg.key])
        ) {
          obj[seg.key] = {};
        }
        current = obj[seg.key];
      }
    }
    return 0;
  }

  writeField(
    absolutePath: string,
    value: unknown,
    concreteArrayIndex?: number,
  ): void {
    if (!isAbsolutePath(absolutePath) || absolutePath === "$") return;

    const segments = parseAbsolutePath(absolutePath);
    const wildcardIndexes = segments
      .map((seg, i) => (seg.wildcard ? i : -1))
      .filter((i) => i >= 0);
    const indexedWildcardAt =
      concreteArrayIndex !== undefined
        ? wildcardIndexes[wildcardIndexes.length - 1]
        : undefined;

    let current: unknown = this.data;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const isLast = i === segments.length - 1;

      if (seg.key === "" && seg.wildcard) {
        if (!Array.isArray(current)) {
          this.data = [];
          current = this.data;
        }
        const arr = current as unknown[];
        const idx =
          indexedWildcardAt === i && concreteArrayIndex !== undefined
            ? concreteArrayIndex
            : Math.max(0, arr.length - 1);
        while (arr.length <= idx) arr.push({});
        if (isLast) {
          arr[idx] = value;
          return;
        }
        if (
          typeof arr[idx] !== "object" ||
          arr[idx] === null ||
          Array.isArray(arr[idx])
        ) {
          arr[idx] = {};
        }
        current = arr[idx];
        continue;
      }

      if (seg.wildcard) {
        if (current === null || typeof current !== "object" || Array.isArray(current)) {
          return;
        }
        const obj = current as JsonObject;
        let arr = obj[seg.key];
        if (!Array.isArray(arr)) {
          arr = [];
          obj[seg.key] = arr;
        }
        const idx =
          indexedWildcardAt === i && concreteArrayIndex !== undefined
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
        continue;
      }

      if (isLast) {
        if (current === null || typeof current !== "object" || Array.isArray(current)) {
          return;
        }
        (current as JsonObject)[seg.key] = value;
        return;
      }

      if (current === null || typeof current !== "object" || Array.isArray(current)) {
        return;
      }
      const obj = current as JsonObject;
      if (
        typeof obj[seg.key] !== "object" ||
        obj[seg.key] === null ||
        Array.isArray(obj[seg.key])
      ) {
        obj[seg.key] = {};
      }
      current = obj[seg.key];
    }
  }

  writeNode(absolutePath: string, value: unknown): void {
    if (absolutePath === "$") return;
    if (!isAbsolutePath(absolutePath)) return;
    if (absolutePath.endsWith("[*]")) {
      const arrayPath = absolutePath.slice(0, -3);
      if (arrayPath === "$" || arrayPath === "") {
        if (!Array.isArray(this.data)) this.data = [];
        (this.data as unknown[]).push(value);
        return;
      }
      const idx = this.allocateArrayElement(arrayPath);
      // Replace the placeholder {} with the provided value
      const values = getPathValues(this.data, `${arrayPath}[*]`);
      if (values.length > idx) {
        // allocate already pushed {}; overwrite via writeField on synthetic path
        this.writeField(`${arrayPath}[*]`, value, idx);
      }
      return;
    }
    this.writeField(absolutePath, value);
  }
}

/**
 * Read a child value for the Nth expanded source element.
 * Supports nested `[*]` by using flat getPathValues indexing.
 */
function getIndexedArrayChildValue(
  document: unknown,
  sourceNodeWithStar: string,
  relativeChild: string,
  arrayIndex: number,
): unknown {
  const absolute = joinPathAware(
    sourceNodeWithStar,
    relativeChild === "" ? "." : relativeChild,
    sourceNodeWithStar.includes("[*]"),
  );
  if (sourceNodeWithStar.includes("[*]")) {
    const values = getPathValues(document, absolute);
    return values[arrayIndex];
  }
  return getPathValue(document, absolute);
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

  const initialTarget =
    options.targetDocument !== undefined
      ? options.targetDocument
      : {};
  const writer = new PreviewWriter(initialTarget);

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
      if (dest.endsWith("[*]") || match.arrayIndex !== undefined) {
        // Per-element / explicit array destination → append
        const appendPath = dest.endsWith("[*]") ? dest : `${dest}[*]`;
        writer.writeNode(appendPath, value);
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
    const destHasWildcard = /\[\*\]/.test(rule.destinationNode);
    // Use the last array container so nested `$[*].product[*].…` appends correctly.
    // When destination has no [*], the destination node itself is the array container
    // (e.g. $.PrimaryProducts) for per-element matches.
    const destArrayPath = destHasWildcard
      ? lastArrayContainerPath(rule.destinationNode)
      : rule.destinationNode;

    // Append into a target array only when the match is array-sourced or dest is explicitly array.
    const treatAsArrayItems =
      destHasWildcard ||
      match.arrayIndex !== undefined ||
      rule.sourceNode.includes("[*]");

    let targetElementIndex: number | undefined;
    if (treatAsArrayItems) {
      targetElementIndex = writer.allocateArrayElement(destArrayPath);
    }

    for (const child of rule.childMappings) {
      const absSource = joinPathAware(
        rule.sourceNode,
        child.sourcePath,
        rule.sourceNode.endsWith("[*]") || rule.sourceNode.includes("[*]"),
      );
      // Absolute target keeps properties after the last [*] (e.g. …productOffering.id).
      // If destination has no wildcard, write through `dest[*].child`.
      const targetBase = destHasWildcard
        ? rule.destinationNode
        : treatAsArrayItems
          ? destArrayPath === "$"
            ? "$[*]"
            : `${destArrayPath}[*]`
          : rule.destinationNode;
      const absTarget = joinPathAware(targetBase, child.targetPath, false);

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
    resultObject: writer.getResult(),
    traces,
    notes,
    warnings,
  };
}
