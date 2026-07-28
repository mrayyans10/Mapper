import type {
  FieldMapping,
  InferredType,
  SchemaNode,
  SchemaTree,
  ValidationIssue,
  ValidationReport,
  ValidationSummary,
} from "../types.js";

const PRIMITIVES: ReadonlySet<InferredType> = new Set([
  "string",
  "number",
  "boolean",
  "null",
]);

function isPrimitive(type: InferredType): boolean {
  return PRIMITIVES.has(type);
}

function areCompatiblePrimitives(a: InferredType, b: InferredType): boolean {
  if (a === "null" || b === "null") return true;
  return a === b;
}

function parentObjectPaths(path: string): string[] {
  const parents: string[] = [];
  let current = path;
  while (true) {
    if (current.endsWith("[*]")) {
      current = current.slice(0, -3);
    } else {
      const lastDot = current.lastIndexOf(".");
      if (lastDot === -1) break;
      current = current.slice(0, lastDot);
    }
    if (current === "$" || current === "") break;
    parents.push(current);
  }
  return parents;
}

function isMapped(path: string, mapped: Set<string>): boolean {
  return mapped.has(path);
}

/**
 * Deterministic mapping validation engine.
 * Pure function — no I/O, safe for CLI/CI reuse.
 */
export function validateMappings(
  sourceSchema: SchemaTree,
  targetSchema: SchemaTree,
  mappings: FieldMapping[],
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const mappedTargets = new Set(mappings.map((m) => m.targetPath));
  const mappedSources = new Set(mappings.map((m) => m.sourcePath));

  const targetByPath = targetSchema.nodes;
  const sourceByPath = sourceSchema.nodes;

  // --- Unmapped required / optional target fields ---
  for (const node of Object.values(targetByPath)) {
    if (node.path === "$") continue;
    // Only consider leaf-ish and structural fields the user may map.
    // Skip synthetic array item containers that are purely structural? We include all non-root.
    if (mappedTargets.has(node.path)) continue;

    if (node.required) {
      issues.push({
        severity: "error",
        issueType: "unmapped_required_target",
        targetPath: node.path,
        explanation: `Required target field "${node.path}" (${node.type}) has no mapping.`,
        suggestedAction:
          "Map a compatible source field to this target path, or mark it as optional if it is not mandatory.",
      });
    } else {
      issues.push({
        severity: "info",
        issueType: "unmapped_optional_target",
        targetPath: node.path,
        explanation: `Optional target field "${node.path}" (${node.type}) is unmapped.`,
        suggestedAction:
          "Map a source field if this value should be populated, or leave unmapped intentionally.",
      });
    }
  }

  // --- Unused source fields ---
  for (const node of Object.values(sourceByPath)) {
    if (node.path === "$") continue;
    if (mappedSources.has(node.path)) continue;
    issues.push({
      severity: "info",
      issueType: "unused_source",
      sourcePath: node.path,
      explanation: `Source field "${node.path}" (${node.type}) is not used in any mapping.`,
      suggestedAction:
        "Map it to a target field if needed, or ignore if the source field is intentionally unused.",
    });
  }

  // --- Per-mapping structural / type checks ---
  const targetsSeen = new Map<string, string[]>(); // target -> source paths
  const sourcesSeen = new Map<string, string[]>(); // source -> target paths

  for (const mapping of mappings) {
    const source = sourceByPath[mapping.sourcePath];
    const target = targetByPath[mapping.targetPath];

    if (!source) {
      issues.push({
        severity: "error",
        issueType: "primitive_datatype_conflict",
        sourcePath: mapping.sourcePath,
        targetPath: mapping.targetPath,
        explanation: `Source path "${mapping.sourcePath}" does not exist in the inferred source schema.`,
        suggestedAction: "Re-infer the source schema or correct the mapping source path.",
      });
      continue;
    }
    if (!target) {
      issues.push({
        severity: "error",
        issueType: "primitive_datatype_conflict",
        sourcePath: mapping.sourcePath,
        targetPath: mapping.targetPath,
        explanation: `Target path "${mapping.targetPath}" does not exist in the inferred target schema.`,
        suggestedAction: "Re-infer the target schema or correct the mapping target path.",
      });
      continue;
    }

    // Track duplicates
    const tList = targetsSeen.get(mapping.targetPath) ?? [];
    tList.push(mapping.sourcePath);
    targetsSeen.set(mapping.targetPath, tList);

    const sList = sourcesSeen.get(mapping.sourcePath) ?? [];
    sList.push(mapping.targetPath);
    sourcesSeen.set(mapping.sourcePath, sList);

    // Array vs non-array
    if (source.type === "array" && target.type !== "array") {
      issues.push({
        severity: "error",
        issueType: "array_to_non_array_conflict",
        sourcePath: source.path,
        targetPath: target.path,
        explanation: `Array source "${source.path}" is mapped to non-array target "${target.path}" (${target.type}).`,
        suggestedAction:
          "Map this array to an array target, or map individual array item fields instead.",
      });
    } else if (source.type !== "array" && target.type === "array") {
      issues.push({
        severity: "error",
        issueType: "array_to_non_array_conflict",
        sourcePath: source.path,
        targetPath: target.path,
        explanation: `Non-array source "${source.path}" (${source.type}) is mapped to array target "${target.path}".`,
        suggestedAction:
          "Map an array source to this target, or map to an array item field path.",
      });
    } else if (source.type === "array" && target.type === "array") {
      issues.push({
        severity: "warning",
        issueType: "array_to_non_array_conflict",
        sourcePath: source.path,
        targetPath: target.path,
        explanation: `Array "${source.path}" is mapped to array "${target.path}". Element-level mapping and cardinality need manual review.`,
        suggestedAction:
          "Confirm item schemas and add explicit mappings for array item fields.",
      });
    }

    // Object to primitive / primitive to object
    if (source.type === "object" && isPrimitive(target.type)) {
      issues.push({
        severity: "error",
        issueType: "object_to_primitive_conflict",
        sourcePath: source.path,
        targetPath: target.path,
        explanation: `Object source "${source.path}" is mapped to primitive target "${target.path}" (${target.type}).`,
        suggestedAction:
          "Map individual object properties to primitive targets instead of the object itself.",
      });
    } else if (isPrimitive(source.type) && target.type === "object") {
      issues.push({
        severity: "error",
        issueType: "object_to_primitive_conflict",
        sourcePath: source.path,
        targetPath: target.path,
        explanation: `Primitive source "${source.path}" (${source.type}) is mapped to object target "${target.path}".`,
        suggestedAction:
          "Map to a specific property under the target object, or map an object source.",
      });
    }

    // Primitive datatype conflicts
    if (isPrimitive(source.type) && isPrimitive(target.type)) {
      if (!areCompatiblePrimitives(source.type, target.type)) {
        issues.push({
          severity: "error",
          issueType: "primitive_datatype_conflict",
          sourcePath: source.path,
          targetPath: target.path,
          explanation: `Datatype conflict: source "${source.path}" is ${source.type} but target "${target.path}" is ${target.type}.`,
          suggestedAction:
            "Choose a compatible source field, or document a transformation note describing the conversion.",
        });
      }
    }
  }

  // --- Duplicate target mappings ---
  for (const [targetPath, sources] of targetsSeen) {
    if (sources.length > 1) {
      issues.push({
        severity: "warning",
        issueType: "duplicate_target_mapping",
        targetPath,
        explanation: `Target "${targetPath}" is mapped from multiple sources: ${sources.join(", ")}.`,
        suggestedAction:
          "Keep a single source mapping, or clarify merge/priority rules in the transformation note.",
      });
    }
  }

  // --- Source mapped to multiple incompatible targets ---
  for (const [sourcePath, targets] of sourcesSeen) {
    if (targets.length <= 1) continue;
    const source = sourceByPath[sourcePath];
    const targetTypes = targets
      .map((t) => targetByPath[t]?.type)
      .filter((t): t is InferredType => Boolean(t));
    const uniqueTypes = new Set(targetTypes);
    const incompatible =
      uniqueTypes.size > 1 &&
      !(uniqueTypes.size === 2 && uniqueTypes.has("null"));

    if (incompatible || targets.length > 1) {
      issues.push({
        severity: incompatible ? "error" : "warning",
        issueType: "source_multi_target_conflict",
        sourcePath,
        explanation: `Source "${sourcePath}" (${source?.type ?? "unknown"}) maps to multiple targets: ${targets.join(", ")}.`,
        suggestedAction:
          incompatible
            ? "Split into separate source fields or remove incompatible target mappings."
            : "Confirm that fan-out to multiple targets is intentional.",
      });
    }
  }

  // --- Structurally unreachable child mappings ---
  // If a required parent object/array on the target is unmapped, child mappings are unreachable.
  for (const mapping of mappings) {
    const parents = parentObjectPaths(mapping.targetPath);
    for (const parentPath of parents) {
      const parent = targetByPath[parentPath];
      if (!parent) continue;
      if (parent.type !== "object" && parent.type !== "array") continue;
      if (!parent.required) continue;
      if (isMapped(parentPath, mappedTargets)) continue;

      issues.push({
        severity: "error",
        issueType: "structurally_unreachable",
        sourcePath: mapping.sourcePath,
        targetPath: mapping.targetPath,
        explanation: `Mapping to "${mapping.targetPath}" may be structurally unreachable because required parent "${parentPath}" (${parent.type}) is unmapped.`,
        suggestedAction: `Add a mapping for parent "${parentPath}", or mark the parent as optional if the structure is created implicitly.`,
      });
      break; // one parent issue per mapping is enough
    }
  }

  const summary = summarize(issues);
  return {
    generatedAt: new Date().toISOString(),
    summary,
    issues,
  };
}

function summarize(issues: ValidationIssue[]): ValidationSummary {
  const count = (type: ValidationIssue["issueType"]) =>
    issues.filter((i) => i.issueType === type).length;

  return {
    requiredTargetFieldsMissing: count("unmapped_required_target"),
    optionalTargetFieldsUnmapped: count("unmapped_optional_target"),
    datatypeConflicts:
      count("primitive_datatype_conflict") + count("object_to_primitive_conflict"),
    arraysNeedingManualReview: issues.filter(
      (i) =>
        i.issueType === "array_to_non_array_conflict" &&
        i.severity === "warning",
    ).length,
    potentialDuplicateMappings: count("duplicate_target_mapping"),
    unusedSourceFields: count("unused_source"),
    structurallyUnreachable: count("structurally_unreachable"),
    errorCount: issues.filter((i) => i.severity === "error").length,
    warningCount: issues.filter((i) => i.severity === "warning").length,
    infoCount: issues.filter((i) => i.severity === "info").length,
  };
}

export function getNode(
  tree: SchemaTree,
  path: string,
): SchemaNode | undefined {
  return tree.nodes[path];
}
