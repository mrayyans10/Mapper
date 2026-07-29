import { describe, expect, it } from "vitest";
import type { Rule, RuleGroup } from "../rule/types.js";
import { previewRuleGroups } from "./engine.js";

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
    copyMode: partial.copyMode,
    ...partial,
  };
}

describe("previewRuleGroups", () => {
  it("shows matched rule, destination, and copied result for conditional route", () => {
    const groups: RuleGroup[] = [
      {
        id: "g1",
        sourceNode: "$.orders",
        executionMode: "first-match",
        rules: [
          rule({
            id: "priority",
            sourceNode: "$.orders",
            destinationNode: "$.PriorityOrders",
            kind: "conditional",
            priority: 1,
            condition: {
              type: "atom",
              atom: { path: "amount", operator: ">", value: 1000 },
            },
            childMappings: [
              {
                id: "c1",
                sourcePath: "amount",
                targetPath: "amount",
                status: "draft",
              },
            ],
          }),
          rule({
            id: "fb",
            sourceNode: "$.orders",
            destinationNode: "$.StandardOrders",
            kind: "fallback",
            priority: 99,
          }),
        ],
      },
    ];

    const report = previewRuleGroups(groups, {
      orders: { amount: 1500 },
    });

    expect(report.matchedRules.map((m) => m.ruleId)).toEqual(["priority"]);
    expect(report.destinations).toEqual(["$.PriorityOrders"]);
    expect(report.fallbackUsed).toBe(false);
    expect(report.resultObject).toEqual({
      PriorityOrders: { amount: 1500 },
    });
    expect(report.traces.some((t) => t.action === "child_copy")).toBe(true);
    expect(report.skippedRules.some((s) => s.ruleId === "fb")).toBe(true);
  });

  it("fallback without children is route-only by default (no silent copy)", () => {
    const groups: RuleGroup[] = [
      {
        id: "g1",
        sourceNode: "$.orders",
        executionMode: "first-match",
        rules: [
          rule({
            id: "priority",
            sourceNode: "$.orders",
            destinationNode: "$.PriorityOrders",
            kind: "conditional",
            condition: {
              type: "atom",
              atom: { path: "amount", operator: ">", value: 1000 },
            },
          }),
          rule({
            id: "fb",
            sourceNode: "$.orders",
            destinationNode: "$.StandardOrders",
            kind: "fallback",
            priority: 99,
            copyMode: "COPY_SOURCE_NODE",
          }),
        ],
      },
    ];

    const report = previewRuleGroups(groups, { orders: { amount: 10 } });
    expect(report.matchedRules.map((m) => m.ruleId)).toEqual(["fb"]);
    expect(report.fallbackUsed).toBe(true);
    expect(report.resultObject).toEqual({
      StandardOrders: { amount: 10 },
    });
  });

  it("previews per-array-element matches with append (D4/P1)", () => {
    const groups: RuleGroup[] = [
      {
        id: "g1",
        sourceNode: "$.items[*]",
        executionMode: "first-match",
        rules: [
          rule({
            id: "primary",
            sourceNode: "$.items[*]",
            destinationNode: "$.PrimaryProducts",
            kind: "conditional",
            condition: {
              type: "atom",
              atom: { path: "productType", operator: "==", value: "P" },
            },
            childMappings: [
              {
                id: "c1",
                sourcePath: "sku",
                targetPath: "productCode",
                status: "draft",
              },
            ],
          }),
          rule({
            id: "fb",
            sourceNode: "$.items[*]",
            destinationNode: "$.OtherProducts",
            kind: "fallback",
            priority: 50,
            childMappings: [
              {
                id: "c2",
                sourcePath: "sku",
                targetPath: "productCode",
                status: "draft",
              },
            ],
          }),
        ],
      },
    ];

    const report = previewRuleGroups(groups, {
      items: [
        { productType: "P", sku: "A" },
        { productType: "S", sku: "B" },
      ],
    });

    expect(
      report.matchedRules.find((m) => m.ruleId === "primary")?.arrayIndex,
    ).toBe(0);
    expect(
      report.matchedRules.find((m) => m.ruleId === "fb")?.arrayIndex,
    ).toBe(1);
    expect(report.resultObject).toEqual({
      PrimaryProducts: [{ productCode: "A" }],
      OtherProducts: [{ productCode: "B" }],
    });
  });

  it("previews nested [*] source with condition into root-array target", () => {
    const groups: RuleGroup[] = [
      {
        id: "g1",
        sourceNode: "$.subscriberList[*].socs[*]",
        executionMode: "first-match",
        rules: [
          rule({
            id: "soc-p",
            sourceNode: "$.subscriberList[*].socs[*]",
            destinationNode: "$[*].product[*].productOffering",
            kind: "conditional",
            condition: {
              type: "atom",
              atom: { path: "socCode", operator: "==", value: "p" },
            },
            copyMode: "APPLY_CHILD_MAPPINGS",
            childMappings: [
              {
                id: "c1",
                sourcePath: "socCode",
                targetPath: "id",
                status: "draft",
              },
            ],
          }),
        ],
      },
    ];

    const report = previewRuleGroups(groups, {
      subscriberList: [
        {
          socs: [{ socCode: "p" }, { socCode: "x" }, { socCode: "p" }],
        },
      ],
    });

    expect(report.matchedRules).toHaveLength(2);
    expect(report.skippedRules).toHaveLength(1);
    expect(report.resultObject).toEqual([
      {
        product: [
          { productOffering: { id: "p" } },
          { productOffering: { id: "p" } },
        ],
      },
    ]);
  });

  it("copies direct legacy mappings and warns on deferred transformations", () => {
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
      {
        id: "g2",
        sourceNode: "$.customer",
        executionMode: "all-match",
        rules: [
          rule({
            id: "r2",
            sourceNode: "$.customer",
            destinationNode: "$.CorporateCustomer",
            kind: "unconditional",
            childMappings: [
              {
                id: "c1",
                sourcePath: "name",
                targetPath: "legalName",
                status: "draft",
                transformation: { type: "uppercase" },
              },
            ],
          }),
        ],
      },
    ];

    const report = previewRuleGroups(groups, {
      email: "ada@example.com",
      customer: { name: "Ada" },
    });

    expect(report.resultObject).toMatchObject({
      contactEmail: "ada@example.com",
      CorporateCustomer: { legalName: "Ada" },
    });
    expect(report.warnings.some((n) => /NOT executed/i.test(n))).toBe(true);
  });
});
