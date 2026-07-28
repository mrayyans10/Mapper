import type { InferredType, SchemaNode, SchemaTree } from "../types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function inferType(value: unknown): InferredType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (isPlainObject(value)) return "object";
  return "null";
}

function nodeName(path: string): string {
  if (path === "$") return "$";
  const parts = path.split(".");
  const last = parts[parts.length - 1] ?? path;
  return last.replace(/\[\*\]/g, "[*]");
}

function parentOf(path: string): string | null {
  if (path === "$") return null;
  // $.a.b.c -> $.a.b ; $.items[*].id -> $.items[*] ; $.items[*] -> $.items ; $.items -> $
  if (path.endsWith("[*]")) {
    return path.slice(0, -3);
  }
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return "$";
  return path.slice(0, lastDot);
}

/**
 * Infer a schema tree from a sample JSON value.
 *
 * Assumptions (documented in README):
 * - Paths use JSONPath-style notation with [*] for array items.
 * - Array item schemas are merged across sample elements (union of keys / first non-null primitive).
 * - `required` defaults to false; callers/UI may flip it.
 */
export function inferSchema(value: unknown, rootPath = "$"): SchemaTree {
  const nodes: Record<string, SchemaNode> = {};

  function ensureNode(
    path: string,
    type: InferredType,
    exampleValue: unknown,
    isInsideArray: boolean,
  ): SchemaNode {
    const existing = nodes[path];
    if (existing) {
      // Prefer a more specific non-null type when merging array samples.
      if (existing.type === "null" && type !== "null") {
        existing.type = type;
        existing.exampleValue = exampleValue;
      }
      return existing;
    }
    const node: SchemaNode = {
      path,
      name: nodeName(path),
      type,
      isInsideArray,
      parentPath: parentOf(path),
      childPaths: [],
      exampleValue,
      required: false,
    };
    nodes[path] = node;
    const parent = node.parentPath;
    if (parent && nodes[parent] && !nodes[parent].childPaths.includes(path)) {
      nodes[parent].childPaths.push(path);
    }
    return node;
  }

  function walk(current: unknown, path: string, isInsideArray: boolean): void {
    const type = inferType(current);
    ensureNode(path, type, current, isInsideArray);

    if (type === "object" && isPlainObject(current)) {
      for (const [key, child] of Object.entries(current)) {
        const childPath = `${path}.${key}`;
        // Ensure parent exists before linking children
        ensureNode(path, "object", current, isInsideArray);
        walk(child, childPath, isInsideArray);
        const parent = nodes[path];
        if (parent && !parent.childPaths.includes(childPath)) {
          parent.childPaths.push(childPath);
        }
      }
    } else if (type === "array" && Array.isArray(current)) {
      const itemPath = `${path}[*]`;
      ensureNode(path, "array", current, isInsideArray);
      if (current.length === 0) {
        ensureNode(itemPath, "null", null, true);
        const parent = nodes[path];
        if (parent && !parent.childPaths.includes(itemPath)) {
          parent.childPaths.push(itemPath);
        }
        return;
      }
      for (const item of current) {
        walk(item, itemPath, true);
      }
      const parent = nodes[path];
      if (parent && !parent.childPaths.includes(itemPath)) {
        parent.childPaths.push(itemPath);
      }
    }
  }

  walk(value, rootPath, false);

  // Sort child paths for deterministic output
  for (const node of Object.values(nodes)) {
    node.childPaths.sort();
  }

  return { rootPath, nodes };
}

export function parseJsonDocument(raw: string): {
  ok: true;
  value: unknown;
} | {
  ok: false;
  error: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "JSON document is empty." };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid JSON";
    return { ok: false, error: `Invalid JSON syntax: ${message}` };
  }
}

export function applyRequiredOverrides(
  tree: SchemaTree,
  overrides: Record<string, boolean> | undefined,
): SchemaTree {
  if (!overrides) return tree;
  const nodes: Record<string, SchemaNode> = {};
  for (const [path, node] of Object.entries(tree.nodes)) {
    nodes[path] = {
      ...node,
      required: path in overrides ? Boolean(overrides[path]) : node.required,
      childPaths: [...node.childPaths],
    };
  }
  return { rootPath: tree.rootPath, nodes };
}

export function listLeafishFields(tree: SchemaTree): SchemaNode[] {
  return Object.values(tree.nodes).filter(
    (n) => n.path !== "$" && n.type !== "object" && n.type !== "array",
  );
}

export function listMappableFields(tree: SchemaTree): SchemaNode[] {
  // Everything except the synthetic root is mappable for MVP.
  return Object.values(tree.nodes).filter((n) => n.path !== "$");
}
