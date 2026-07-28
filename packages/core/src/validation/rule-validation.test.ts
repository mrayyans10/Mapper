import { describe, expect, it } from "vitest";
import { inferSchema } from "../schema/infer.js";
import type { Rule, RuleGroup } from "../rule/types.js";
import { validateRuleGroups } from "./rule-validation.js";

function rule(
  partial: Partial<Rule> &
    Pick<Rule, "id" | "destinationNode" | "kind" | "sourceNode">,
): Rule {
  return {
    name: partial.name ?? partial.id,
    category: partial.category ?? "routing",
    priority: partial.priority ?? 10,
    enabled: partial.enabled ?? true,
    childMappings: partial.childMappings ?? [],
    status: partial.status ?? "draft",
    condition: partial.condition,
    migrationSource: partial.migrationSource,
    ...partial,
  };
}

describe("validateRuleGroups", () => {
  const source = inferSchema({
    orders: { amount: 1500 },
    email: "a@b.c",
    age: 36,
    items: [{ productType: "P", sku: "A1" }],
  });
  const target = inferSchema({
    PriorityOrders: { amount: 1500 },
    contactEmail: "a@b.c",
    years: 36,
    PrimaryProducts: [{ productCode: "A1" }],
    tier: "gold",
  });

  it("flags multiple enabled fallbacks in first-match (D6)", () => {
    const groups: RuleGroup[] = [
      {
        id: "g1",
        sourceNode: "$.orders",
        executionMode: "first-match",
        rules: [
          rule({
            id: "c1",
            sourceNode: "$.orders",
            destinationNode: "$.PriorityOrders",
            kind: "conditional",
            condition: {
              type: "atom",
              atom: { path: "amount", operator: ">", value: 1000 },
            },
          }),
          rule({
            id: "fb1",
            sourceNode: "$.orders",
            destinationNode: "$.PriorityOrders",
            kind: "fallback",
            priority: 50,
          }),
          rule({
            id: "fb2",
            sourceNode: "$.orders",
            destinationNode: "$.PriorityOrders",
            kind: "fallback",
            priority: 60,
          }),
        ],
      },
    ];
    const report = validateRuleGroups(groups, source, target);
    expect(
      report.issues.filter((i) => i.type === "multiple_enabled_fallbacks"),
    ).toHaveLength(2);
  });

  it("detects invalid conditional without expression", () => {
    const groups: RuleGroup[] = [
      {
        id: "g1",
        sourceNode: "$.orders",
        executionMode: "first-match",
        rules: [
          rule({
            id: "bad",
            sourceNode: "$.orders",
            destinationNode: "$.PriorityOrders",
            kind: "conditional",
          }),
        ],
      },
    ];
    const report = validateRuleGroups(groups, source, target);
    expect(report.issues.some((i) => i.type === "invalid_condition")).toBe(
      true,
    );
  });

  it("detects unreachable rules after unconditional in first-match", () => {
    const groups: RuleGroup[] = [
      {
        id: "g1",
        sourceNode: "$.orders",
        executionMode: "first-match",
        rules: [
          rule({
            id: "u",
            sourceNode: "$.orders",
            destinationNode: "$.PriorityOrders",
            kind: "unconditional",
            priority: 1,
          }),
          rule({
            id: "later",
            sourceNode: "$.orders",
            destinationNode: "$.PriorityOrders",
            kind: "conditional",
            priority: 2,
            condition: {
              type: "atom",
              atom: { path: "amount", operator: ">", value: 1 },
            },
          }),
        ],
      },
    ];
    const report = validateRuleGroups(groups, source, target);
    expect(
      report.issues.some(
        (i) => i.type === "unreachable_rule" && i.ruleId === "later",
      ),
    ).toBe(true);
  });

  it("detects datatype mismatch on direct legacy rules", () => {
    const groups: RuleGroup[] = [
      {
        id: "rg",
        sourceNode: "$.age",
        executionMode: "all-match",
        rules: [
          rule({
            id: "m1",
            category: "direct",
            sourceNode: "$.age",
            destinationNode: "$.contactEmail",
            kind: "unconditional",
            migrationSource: "FIELD_MAPPING_V1",
          }),
        ],
      },
    ];
    const report = validateRuleGroups(groups, source, target);
    expect(report.issues.some((i) => i.type === "datatype_mismatch")).toBe(
      true,
    );
  });

  it("detects duplicate child mapping targets and relative path violations", () => {
    const groups: RuleGroup[] = [
      {
        id: "g1",
        sourceNode: "$.items[*]",
        executionMode: "all-match",
        rules: [
          rule({
            id: "r1",
            sourceNode: "$.items[*]",
            destinationNode: "$.PrimaryProducts",
            kind: "unconditional",
            childMappings: [
              {
                id: "c1",
                sourcePath: "sku",
                targetPath: "productCode",
                status: "draft",
              },
              {
                id: "c2",
                sourcePath: "productType",
                targetPath: "productCode",
                status: "draft",
              },
              {
                id: "c3",
                sourcePath: "$.sku",
                targetPath: "x",
                status: "draft",
              },
            ],
          }),
        ],
      },
    ];
    const report = validateRuleGroups(groups, source, target);
    expect(
      report.issues.some((i) => i.type === "duplicate_child_mapping"),
    ).toBe(true);
    expect(report.issues.some((i) => i.type === "invariant_violation")).toBe(
      true,
    );
  });

  it("requires fallback when option set", () => {
    const groups: RuleGroup[] = [
      {
        id: "g1",
        sourceNode: "$.orders",
        executionMode: "first-match",
        rules: [
          rule({
            id: "c1",
            sourceNode: "$.orders",
            destinationNode: "$.PriorityOrders",
            kind: "conditional",
            condition: {
              type: "atom",
              atom: { path: "amount", operator: ">", value: 1000 },
            },
          }),
        ],
      },
    ];
    const report = validateRuleGroups(groups, source, target, {
      requireFallback: true,
    });
    expect(report.issues.some((i) => i.type === "missing_fallback")).toBe(true);
  });

  it("reports unmapped required target", () => {
    const requiredTarget = inferSchema({
      contactEmail: "x",
      tier: "gold",
    });
    requiredTarget.nodes["$.tier"]!.required = true;
    const groups: RuleGroup[] = [
      {
        id: "rg",
        sourceNode: "$.email",
        executionMode: "all-match",
        rules: [
          rule({
            id: "m1",
            category: "direct",
            sourceNode: "$.email",
            destinationNode: "$.contactEmail",
            kind: "unconditional",
            migrationSource: "FIELD_MAPPING_V1",
          }),
        ],
      },
    ];
    const report = validateRuleGroups(groups, source, requiredTarget);
    expect(
      report.issues.some(
        (i) =>
          i.type === "unmapped_required_target" && i.targetPath === "$.tier",
      ),
    ).toBe(true);
  });

  it("detects conflicting unconditional rules", () => {
    const groups: RuleGroup[] = [
      {
        id: "g1",
        sourceNode: "$.orders",
        executionMode: "all-match",
        rules: [
          rule({
            id: "a",
            sourceNode: "$.orders",
            destinationNode: "$.PriorityOrders",
            kind: "unconditional",
            priority: 1,
          }),
          rule({
            id: "b",
            sourceNode: "$.orders",
            destinationNode: "$.PrimaryProducts",
            kind: "unconditional",
            priority: 2,
          }),
        ],
      },
    ];
    const report = validateRuleGroups(groups, source, target);
    expect(report.issues.some((i) => i.type === "conflicting_rule")).toBe(true);
  });
});
