import { describe, expect, it } from "vitest";
import { evaluateCondition } from "./condition-eval.js";
import type { SourceContext } from "./paths.js";

const ctx = (relativeRoot: unknown, document?: unknown): SourceContext => ({
  relativeRoot,
  document: document ?? { root: relativeRoot },
});

describe("evaluateCondition operators", () => {
  it("supports == and !=", () => {
    expect(
      evaluateCondition(
        { type: "atom", atom: { path: "country", operator: "==", value: "Canada" } },
        ctx({ country: "Canada" }),
      ).ok,
    ).toBe(true);
    expect(
      evaluateCondition(
        { type: "atom", atom: { path: "country", operator: "!=", value: "Canada" } },
        ctx({ country: "US" }),
      ).ok,
    ).toBe(true);
  });

  it("supports numeric comparisons without string coercion", () => {
    expect(
      evaluateCondition(
        { type: "atom", atom: { path: "amount", operator: ">", value: 1000 } },
        ctx({ amount: 1500 }),
      ).ok,
    ).toBe(true);
    expect(
      evaluateCondition(
        { type: "atom", atom: { path: "amount", operator: ">", value: 1000 } },
        ctx({ amount: "1500" }),
      ).ok,
    ).toBe(false);
  });

  it("supports IN / NOT_IN / CONTAINS / STARTS_WITH / ENDS_WITH", () => {
    expect(
      evaluateCondition(
        { type: "atom", atom: { path: "c", operator: "IN", value: ["A", "B"] } },
        ctx({ c: "B" }),
      ).ok,
    ).toBe(true);
    expect(
      evaluateCondition(
        { type: "atom", atom: { path: "c", operator: "NOT_IN", value: ["A"] } },
        ctx({ c: "B" }),
      ).ok,
    ).toBe(true);
    expect(
      evaluateCondition(
        { type: "atom", atom: { path: "n", operator: "CONTAINS", value: "map" } },
        ctx({ n: "mapping" }),
      ).ok,
    ).toBe(true);
    expect(
      evaluateCondition(
        { type: "atom", atom: { path: "n", operator: "STARTS_WITH", value: "map" } },
        ctx({ n: "mapping" }),
      ).ok,
    ).toBe(true);
    expect(
      evaluateCondition(
        { type: "atom", atom: { path: "n", operator: "ENDS_WITH", value: "ing" } },
        ctx({ n: "mapping" }),
      ).ok,
    ).toBe(true);
  });

  it("supports EXISTS / NOT_EXISTS and MATCHES_REGEX", () => {
    expect(
      evaluateCondition(
        { type: "atom", atom: { path: "x", operator: "EXISTS" } },
        ctx({ x: 1 }),
      ).ok,
    ).toBe(true);
    expect(
      evaluateCondition(
        { type: "atom", atom: { path: "missing", operator: "NOT_EXISTS" } },
        ctx({ x: 1 }),
      ).ok,
    ).toBe(true);
    expect(
      evaluateCondition(
        { type: "atom", atom: { path: "c", operator: "MATCHES_REGEX", value: "^C.*" } },
        ctx({ c: "Canada" }),
      ).ok,
    ).toBe(true);
  });

  it("returns error for invalid regex", () => {
    const result = evaluateCondition(
      { type: "atom", atom: { path: "c", operator: "MATCHES_REGEX", value: "[" } },
      ctx({ c: "x" }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid regular expression/);
  });

  it("supports AND / OR / NOT nesting", () => {
    const expr = {
      type: "and" as const,
      children: [
        {
          type: "or" as const,
          children: [
            { type: "atom" as const, atom: { path: "a", operator: "==" as const, value: 1 } },
            { type: "atom" as const, atom: { path: "a", operator: "==" as const, value: 2 } },
          ],
        },
        {
          type: "not" as const,
          child: {
            type: "atom" as const,
            atom: { path: "b", operator: "==" as const, value: true },
          },
        },
      ],
    };
    expect(evaluateCondition(expr, ctx({ a: 2, b: false })).ok).toBe(true);
    expect(evaluateCondition(expr, ctx({ a: 2, b: true })).ok).toBe(false);
  });
});
