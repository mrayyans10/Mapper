/**
 * Path helpers for Rule Platform (D7).
 * Relative child paths are canonical; absolute paths are derived.
 */

export type RelativePath = string;
export type AbsolutePath = string;

export interface ResolvedChildPaths {
  absoluteSourcePath: AbsolutePath;
  absoluteTargetPath: AbsolutePath;
}

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathError";
  }
}

/** True when path is stored in canonical relative form (must not start with `$.`). */
export function isRelativePath(path: string): boolean {
  return !path.startsWith("$");
}

/** True when path is absolute JSONPath-style (`$`, `$.…`, or root-array `$[*]…`). */
export function isAbsolutePath(path: string): boolean {
  return (
    path === "$" ||
    path.startsWith("$.") ||
    path === "$[*]" ||
    path.startsWith("$[*]")
  );
}

/**
 * Join rule node + relative child path → absolute path.
 *
 * Examples:
 *   joinPath("$.customer", "type") → "$.customer.type"
 *   joinPath("$.items[*]", "sku") → "$.items[*].sku"
 *   joinPath("$.email", "") → "$.email"
 */
export function joinPath(
  nodePath: AbsolutePath,
  relativePath: RelativePath,
): AbsolutePath {
  if (!isAbsolutePath(nodePath)) {
    throw new PathError(
      `joinPath expects an absolute node path, got "${nodePath}"`,
    );
  }
  const rel = relativePath.trim();
  if (rel === "" || rel === ".") {
    return nodePath;
  }
  if (rel.startsWith("$")) {
    throw new PathError(
      `Relative path must not be absolute; got "${relativePath}"`,
    );
  }
  const cleaned = rel.replace(/^\./, "");
  if (nodePath === "$") {
    return `$.${cleaned}`;
  }
  return `${nodePath}.${cleaned}`;
}

export function resolveChildPaths(
  sourceNode: AbsolutePath,
  destinationNode: AbsolutePath,
  child: { sourcePath: string; targetPath: string },
): ResolvedChildPaths {
  return {
    absoluteSourcePath: joinPath(sourceNode, child.sourcePath),
    absoluteTargetPath: joinPath(destinationNode, child.targetPath),
  };
}

interface PathSegment {
  key: string;
  wildcard: boolean;
}

/** Parse `$.a.b[*].c` or root-array `$[*].a` into segments. */
export function parseAbsolutePath(path: string): PathSegment[] {
  if (!isAbsolutePath(path)) {
    throw new PathError(`Expected absolute path, got "${path}"`);
  }
  if (path === "$") return [];

  // Root-array document: `$[*]` or `$[*].product[*].id`
  if (path === "$[*]" || path.startsWith("$[*]")) {
    const rest = path.startsWith("$[*].")
      ? path.slice("$[*].".length)
      : path === "$[*]"
        ? ""
        : path.slice("$[*]".length);
    const rootSeg: PathSegment = { key: "", wildcard: true };
    if (!rest) return [rootSeg];
    return [
      rootSeg,
      ...rest.split(".").map((part) => {
        if (part.endsWith("[*]")) {
          return { key: part.slice(0, -3), wildcard: true };
        }
        return { key: part, wildcard: false };
      }),
    ];
  }

  const body = path.slice(2); // strip "$."
  if (!body) return [];
  return body.split(".").map((part) => {
    if (part.endsWith("[*]")) {
      return { key: part.slice(0, -3), wildcard: true };
    }
    return { key: part, wildcard: false };
  });
}

/**
 * Collect all values at an absolute path.
 * `[*]` expands to every array element (D4 support).
 * Root-array paths (`$[*]…`) expand the document root when it is an array.
 */
export function getPathValues(root: unknown, absolutePath: string): unknown[] {
  const segments = parseAbsolutePath(absolutePath);
  let current: unknown[] = [root];
  for (const seg of segments) {
    const next: unknown[] = [];
    for (const node of current) {
      if (seg.key === "" && seg.wildcard) {
        // Root-array segment from `$[*]…`
        if (Array.isArray(node)) next.push(...node);
        continue;
      }
      if (node === null || typeof node !== "object") continue;
      if (Array.isArray(node)) continue;
      const record = node as Record<string, unknown>;
      if (!(seg.key in record)) continue;
      const child = record[seg.key];
      if (seg.wildcard) {
        if (Array.isArray(child)) {
          next.push(...child);
        }
      } else {
        next.push(child);
      }
    }
    current = next;
  }
  return current;
}

/** First value at path, or undefined. */
export function getPathValue(
  root: unknown,
  absolutePath: string,
): unknown | undefined {
  const values = getPathValues(root, absolutePath);
  return values[0];
}

export interface SourceContext {
  /** Object/value used as relative-path root for conditions. */
  relativeRoot: unknown;
  /** Document root for absolute paths. */
  document: unknown;
  arrayIndex?: number;
}

/**
 * Expand a RuleGroup sourceNode into evaluation contexts.
 * Paths containing `[*]` yield one context per array element (D4).
 */
export function expandSourceContexts(
  document: unknown,
  sourceNode: string,
): SourceContext[] {
  if (!isAbsolutePath(sourceNode)) {
    throw new PathError(
      `sourceNode must be absolute JSONPath-style, got "${sourceNode}"`,
    );
  }

  if (!sourceNode.includes("[*]")) {
    const values = getPathValues(document, sourceNode);
    if (values.length === 0) {
      return [{ relativeRoot: undefined, document }];
    }
    // Non-wildcard: use the first match as relative root (object or primitive).
    return [{ relativeRoot: values[0], document }];
  }

  // Split into prefix before first [*] and optional suffix after.
  // MVP: support a single [*] in sourceNode.
  const starCount = (sourceNode.match(/\[\*\]/g) ?? []).length;
  if (starCount !== 1) {
    throw new PathError(
      `sourceNode may contain at most one [*] in Step 2; got "${sourceNode}"`,
    );
  }

  const starIndex = sourceNode.indexOf("[*]");
  const arrayPath = sourceNode.slice(0, starIndex); // e.g. $.items
  const suffix = sourceNode.slice(starIndex + 3); // e.g. "" or ".nested"

  const arrays = getPathValues(document, arrayPath);
  const contexts: SourceContext[] = [];
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    arr.forEach((element, index) => {
      let relativeRoot: unknown = element;
      if (suffix.startsWith(".")) {
        const subPath = `$${suffix}`; // treat suffix as relative from element via synthetic
        // suffix is like `.foo.bar` — resolve on element
        relativeRoot = getPathValueOnObject(element, suffix.slice(1));
      } else if (suffix !== "") {
        relativeRoot = getPathValueOnObject(element, suffix);
      }
      contexts.push({ relativeRoot, document, arrayIndex: index });
    });
  }
  if (contexts.length === 0) {
    return [{ relativeRoot: undefined, document }];
  }
  return contexts;
}

function getPathValueOnObject(
  root: unknown,
  dottedPath: string,
): unknown | undefined {
  if (!dottedPath) return root;
  const parts = dottedPath.split(".");
  let current: unknown = root;
  for (const part of parts) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Resolve a condition path against a source context.
 * Absolute (`$.…`) → document root; relative → context.relativeRoot.
 */
export function resolveConditionValues(
  ctx: SourceContext,
  path: string,
): unknown[] {
  if (isAbsolutePath(path)) {
    return getPathValues(ctx.document, path);
  }
  const cleaned = path.replace(/^\./, "");
  if (cleaned === "" || path === ".") {
    return [ctx.relativeRoot];
  }
  // Evaluate relative path as if relativeRoot were the document root.
  return getPathValues(ctx.relativeRoot, `$.${cleaned}`);
}

/**
 * Canonicalize path for equivalence checks (V2).
 * `$.arr`, `$.arr[*]`, and child forms under arrays are normalized consistently:
 * - trailing `[*]` retained for item roots
 * - `$.arr.field` and `$.arr[*].field` share the same coverage key `$.arr[*].field`
 */
export function normalizeArrayPath(path: string): string {
  if (!isAbsolutePath(path) || path === "$") return path;
  const segments = parseAbsolutePath(path);
  const out: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const next = segments[i + 1];
    // If this segment is followed by a property and is not already wildcard,
    // we cannot know it's an array without schema — keep as-is.
    // Coverage expansion handles schema-aware cases separately.
    if (seg.wildcard) {
      out.push(`${seg.key}[*]`);
    } else {
      out.push(seg.key);
    }
    void next;
  }
  return out.length === 0 ? "$" : `$.${out.join(".")}`;
}

/**
 * Expand equivalent path forms for coverage / schema lookup (V2).
 * Includes both with and without `[*]` between parent and child.
 */
export function expandEquivalentPaths(path: string): string[] {
  if (!isAbsolutePath(path) || path === "$") return [path];
  const variants = new Set<string>([path, normalizeArrayPath(path)]);

  // Insert [*] before each property segment after an array-looking parent name.
  // Also strip [*] forms.
  const body = path.startsWith("$.") ? path.slice(2) : path;
  const parts = body.split(".");
  // Variant: add [*] to segments that lack it when a following segment exists
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    if (!p.endsWith("[*]")) {
      const next = [...parts];
      next[i] = `${p}[*]`;
      variants.add(`$.${next.join(".")}`);
    }
  }
  // Variant: remove [*]
  const stripped = parts.map((p) => p.replace(/\[\*\]$/, ""));
  variants.add(`$.${stripped.join(".")}`);

  // Parent array forms
  if (path.endsWith("[*]")) {
    variants.add(path.slice(0, -3));
  } else {
    variants.add(`${path}[*]`);
  }

  return [...variants];
}

/** True if two absolute paths refer to the same location under array-path normalization. */
export function pathsEquivalent(a: string, b: string): boolean {
  const ea = new Set(expandEquivalentPaths(a));
  for (const x of expandEquivalentPaths(b)) {
    if (ea.has(x)) return true;
  }
  return false;
}

/**
 * Join with optional schema-aware array insertion (V2).
 * When `parentIsArray` and parent path lacks `[*]`, inserts `[*]` before the relative child.
 */
export function joinPathAware(
  nodePath: AbsolutePath,
  relativePath: RelativePath,
  parentIsArray?: boolean,
): AbsolutePath {
  let base = nodePath;
  // Only append [*] when the caller says this node is an array AND the path
  // does not already use array syntax (including root-array `$[*]…`).
  if (
    parentIsArray &&
    !base.endsWith("[*]") &&
    base !== "$" &&
    !base.includes("[*]")
  ) {
    base = `${base}[*]`;
  }
  return joinPath(base, relativePath);
}

export function lookupSchemaPath(
  paths: Iterable<string>,
  absolutePath: string,
): string | undefined {
  const set = paths instanceof Set ? paths : new Set(paths);
  for (const candidate of expandEquivalentPaths(absolutePath)) {
    if (set.has(candidate)) return candidate;
  }
  return undefined;
}

export function schemaHasPath(
  schemaPaths: Iterable<string>,
  absolutePath: string,
): boolean {
  return lookupSchemaPath(schemaPaths, absolutePath) !== undefined;
}

export function markMappedPath(mapped: Set<string>, absolutePath: string): void {
  for (const v of expandEquivalentPaths(absolutePath)) {
    mapped.add(v);
  }
}

export function isMappedPath(mapped: Set<string>, absolutePath: string): boolean {
  return lookupSchemaPath(mapped, absolutePath) !== undefined;
}
