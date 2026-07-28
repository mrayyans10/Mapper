import { describe, expect, it } from "vitest";
import { evaluateRuleGroup, evaluateRuleGroups } from "./engine.js";
import type { Rule, RuleGroup } from "./types.js";

function rule( partial: Partial<Rule> & Pick<Rule, "id" | "destinationNode" | "kind">): Rule {
  return {
    name: partial.name ?? partial.id,
    category: partial.category ?? "routing",
    sourceNode: partial.sourceNode ?? "$.orders",
    priority: partial.priority ?? 100,
    enabled: partial.enabled ?? true,
    childMappings: partial.childMappings ?? [],
    condition: partial.condition,
    migrationSource: partial.migrationSource,
    status: partial.status ?? "draft",
    ...partial,
  };
}

describe("evaluateRuleGroups", () => {
  it("first-match: highest priority (lowest number) wins", () => {
    const group: RuleGroup = {
      id: "g1",
      sourceNode: "$.orders",
      executionMode: "first-match",
      rules: [
        rule({
          id: "low",
          destinationNode: "$.Other",
          kind: "conditional",
          priority: 20,
          condition: {
            type: "atom",
            atom: { path: "amount", operator: ">", value: 100 },
          },
        }),
        rule({
          id: "high",
          destinationNode: "$.PriorityOrders",
          kind: "conditional",
          priority: 1,
          condition: {
            type: "atom",
            atom: { path: "amount", operator: ">", value: 1000 },
          },
        }),
      ],
    };

    const result = evaluateRuleGroup(group, { orders: { amount: 1500 } });
    expect(result.matched.map((m) => m.ruleId)).toEqual(["high"]);
    expect(result.destinations).toEqual(["$.PriorityOrders"]);
    expect(result.skipped.some((s) => s.ruleId === "low")).toBe(true);
  });

  it("first-match: uses single fallback when nothing matches", () => {
    const group: RuleGroup = {
      id: "g1",
      sourceNode: "$.orders",
      executionMode: "first-match",
      rules: [
        rule({
          id: "c1",
          destinationNode: "$.PriorityOrders",
          kind: "conditional",
          priority: 1,
          condition: {
            type: "atom",
            atom: { path: "amount", operator: ">", value: 1000 },
          },
        }),
        rule({
          id: "fb",
          destinationNode: "$.StandardOrders",
          kind: "fallback",
          priority: 99,
        }),
      ],
    };

    const result = evaluateRuleGroup(group, { orders: { amount: 10 } });
    expect(result.matched.map((m) => m.ruleId)).toEqual(["fb"]);
    expect(result.fallbackUsed).toBe(true);
  });

  it("first-match: multiple enabled fallbacks must not execute (D6)", () => {
    const group: RuleGroup = {
      id: "g1",
      sourceNode: "$.orders",
      executionMode: "first-match",
      rules: [
        rule({
          id: "c1",
          destinationNode: "$.A",
          kind: "conditional",
          priority: 1,
          condition: {
            type: "atom",
            atom: { path: "amount", operator: ">", value: 9999 },
          },
        }),
        rule({
          id: "fb1",
          destinationNode: "$.B",
          kind: "fallback",
          priority: 50,
        }),
        rule({
          id: "fb2",
          destinationNode: "$.C",
          kind: "fallback",
          priority: 60,
        }),
      ],
    };

    const result = evaluateRuleGroup(group, { orders: { amount: 1 } });
    expect(result.matched).toHaveLength(0);
    expect(result.fallbackUsed).toBe(false);
    expect(
      result.skipped.filter((s) => s.reason.includes("Multiple enabled fallback")),
    ).toHaveLength(2);
  });

  it("all-match: returns every matching conditional", () => {
    const group: RuleGroup = {
      id: "g1",
      sourceNode: "$.employee",
      executionMode: "all-match",
      rules: [
        rule({
          id: "ca",
          sourceNode: "$.employee",
          destinationNode: "$.CanadianEmployees",
          kind: "conditional",
          priority: 1,
          condition: {
            type: "atom",
            atom: { path: "country", operator: "==", value: "Canada" },
          },
        }),
        rule({
          id: "active",
          sourceNode: "$.employee",
          destinationNode: "$.ActiveEmployees",
          kind: "conditional",
          priority: 2,
          condition: {
            type: "atom",
            atom: { path: "active", operator: "==", value: true },
          },
        }),
      ],
    };

    const result = evaluateRuleGroup(group, {
      employee: { country: "Canada", active: true },
    });
    expect(result.matched.map((m) => m.ruleId).sort()).toEqual([
      "active",
      "ca",
    ]);
  });

  it("skips disabled rules", () => {
    const group: RuleGroup = {
      id: "g1",
      sourceNode: "$.orders",
      executionMode: "all-match",
      rules: [
        rule({
          id: "off",
          destinationNode: "$.X",
          kind: "unconditional",
          enabled: false,
        }),
      ],
    };
    const result = evaluateRuleGroup(group, { orders: {} });
    expect(result.matched).toHaveLength(0);
    expect(result.skipped[0]?.reason).toMatch(/disabled/i);
  });

  it("evaluates [*] source nodes per array element (D4)", () => {
    const group: RuleGroup = {
      id: "g1",
      sourceNode: "$.items[*]",
      executionMode: "first-match",
      rules: [
        rule({
          id: "primary",
          sourceNode: "$.items[*]",
          destinationNode: "$.PrimaryProducts",
          kind: "conditional",
          priority: 1,
          condition: {
            type: "atom",
            atom: { path: "productType", operator: "==", value: "P" },
          },
        }),
        rule({
          id: "fb",
          sourceNode: "$.items[*]",
          destinationNode: "$.OtherProducts",
          kind: "fallback",
          priority: 10,
        }),
      ],
    };

    const result = evaluateRuleGroup(group, {
      items: [
        { productType: "P", sku: "A" },
        { productType: "S", sku: "B" },
      ],
    });

    const primary = result.matched.find((m) => m.ruleId === "primary");
    const fallback = result.matched.find((m) => m.ruleId === "fb");
    expect(primary?.arrayIndex).toBe(0);
    expect(fallback?.arrayIndex).toBe(1);
  });

  it("all-match applies every legacy direct rule", () => {
    const groups: RuleGroup[] = [
      {
        id: "rg_legacy_a",
        sourceNode: "$.email",
        executionMode: "all-match",
        rules: [
          rule({
            id: "a",
            category: "direct",
            sourceNode: "$.email",
            destinationNode: "$.contactEmail",
            kind: "unconditional",
            priority: 1,
            migrationSource: "FIELD_MAPPING_V1",
          }),
        ],
      },
      {
        id: "rg_legacy_b",
        sourceNode: "$.age",
        executionMode: "all-match",
        rules: [
          rule({
            id: "b",
            category: "direct",
            sourceNode: "$.age",
            destinationNode: "$.years",
            kind: "unconditional",
            priority: 2,
            migrationSource: "FIELD_MAPPING_V1",
          }),
        ],
      },
    ];

    const result = evaluateRuleGroups(groups, { email: "a@b.c", age: 1 });
    expect(result.matched.map((m) => m.ruleId).sort()).toEqual(["a", "b"]);
  });
});
