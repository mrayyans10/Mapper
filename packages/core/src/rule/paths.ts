/**
 * Path helpers for Rule Platform (D7).
 * Relative child paths are canonical; absolute paths are derived.
 *
 * Implementation of join/resolve comes with the Rule Engine tranche.
 * Types and contracts are fixed here for Step 1.
 */

/** A relative segment path like `status` or `address.city` (no leading `$.`). */
export type RelativePath = string;

/** Absolute JSONPath-style path like `$.subscriberList[*].status`. */
export type AbsolutePath = string;

export interface ResolvedChildPaths {
  absoluteSourcePath: AbsolutePath;
  absoluteTargetPath: AbsolutePath;
}

/**
 * Contract: join rule node + relative child path → absolute path.
 * Examples:
 *   joinPath("$.customer", "type") → "$.customer.type"
 *   joinPath("$.items[*]", "sku") → "$.items[*].sku"
 *   joinPath("$.email", "") → "$.email"
 */
export type JoinPathFn = (
  nodePath: AbsolutePath,
  relativePath: RelativePath,
) => AbsolutePath;
