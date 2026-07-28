import type { ConditionAtom, ConditionExpr, ConditionOperator } from "./types.js";
import {
  type SourceContext,
  resolveConditionValues,
} from "./paths.js";

export class ConditionEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConditionEvalError";
  }
}

export interface ConditionEvalResult {
  ok: boolean;
  /** Set when the expression cannot be evaluated (invalid regex, missing value, etc.). */
  error?: string;
}

/**
 * Evaluate a condition expression against a source context.
 *
 * Coercion policy (Step 2 assumption):
 * - `==` / `!=` use Strict Equality (===) after JSON-literal normalization for primitives
 * - Relational operators require both sides to be finite numbers (no string/number coercion)
 * - String operators stringify the left value
 * - Multi-value left sides (from `[*]`): operator succeeds if **any** value matches
 */
export function evaluateCondition(
  expr: ConditionExpr,
  ctx: SourceContext,
): ConditionEvalResult {
  try {
    return { ok: evalExpr(expr, ctx) };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Condition evaluation failed";
    return { ok: false, error: message };
  }
}

function evalExpr(expr: ConditionExpr, ctx: SourceContext): boolean {
  switch (expr.type) {
    case "atom":
      return evalAtom(expr.atom, ctx);
    case "and":
      if (expr.children.length === 0) return true;
      return expr.children.every((c) => evalExpr(c, ctx));
    case "or":
      if (expr.children.length === 0) return false;
      return expr.children.some((c) => evalExpr(c, ctx));
    case "not":
      return !evalExpr(expr.child, ctx);
    default: {
      const _exhaustive: never = expr;
      throw new ConditionEvalError(
        `Unknown condition type: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

function evalAtom(atom: ConditionAtom, ctx: SourceContext): boolean {
  const op = atom.operator;
  const values = resolveConditionValues(ctx, atom.path);

  if (op === "EXISTS") {
    return values.length > 0 && values.some((v) => v !== undefined);
  }
  if (op === "NOT_EXISTS") {
    return values.length === 0 || values.every((v) => v === undefined);
  }

  if (atom.value === undefined) {
    throw new ConditionEvalError(
      `Operator ${op} requires a value (path "${atom.path}")`,
    );
  }

  if (values.length === 0) {
    return false;
  }

  return values.some((left) => compare(left, op, atom.value));
}

function compare(
  left: unknown,
  op: ConditionOperator,
  right: unknown,
): boolean {
  switch (op) {
    case "==":
      return Object.is(left, right) || softEqual(left, right);
    case "!=":
      return !(Object.is(left, right) || softEqual(left, right));
    case ">":
    case ">=":
    case "<":
    case "<=":
      return compareNumbers(left, right, op);
    case "IN":
      return Array.isArray(right) && right.some((v) => softEqual(left, v));
    case "NOT_IN":
      return Array.isArray(right) && !right.some((v) => softEqual(left, v));
    case "CONTAINS":
      return String(left).includes(String(right));
    case "STARTS_WITH":
      return String(left).startsWith(String(right));
    case "ENDS_WITH":
      return String(left).endsWith(String(right));
    case "MATCHES_REGEX": {
      try {
        return new RegExp(String(right)).test(String(left));
      } catch {
        throw new ConditionEvalError(`Invalid regular expression: ${String(right)}`);
      }
    }
    case "EXISTS":
    case "NOT_EXISTS":
      throw new ConditionEvalError(`Operator ${op} handled earlier`);
    default: {
      const _exhaustive: never = op;
      throw new ConditionEvalError(`Unsupported operator: ${_exhaustive}`);
    }
  }
}

/** Allow numeric 1 == 1 even across identical primitives; no string↔number coercion. */
function softEqual(a: unknown, b: unknown): boolean {
  return a === b;
}

function compareNumbers(
  left: unknown,
  right: unknown,
  op: ">" | ">=" | "<" | "<=",
): boolean {
  if (typeof left !== "number" || typeof right !== "number") {
    return false;
  }
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return false;
  }
  switch (op) {
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
  }
}
