import { describe, expect, it } from "vitest";
import { simulateRule } from "../preview/simulate.js";
import { instantiateTemplate, ruleToTemplate } from "./model.js";
import type { Rule } from "../rule/types.js";

const sampleRule: Rule = {
  id: "r1",
  name: "Priority",
  category: "routing",
  sourceNode: "$.orders",
  destinationNode: "$.PriorityOrders",
  kind: "conditional",
  condition: {
    type: "atom",
    atom: { path: "amount", operator: ">", value: 1000 },
  },
  priority: 1,
  enabled: true,
  childMappings: [
    {
      id: "c1",
      sourcePath: "amount",
      targetPath: "amount",
      status: "draft",
    },
  ],
  copyMode: "APPLY_CHILD_MAPPINGS",
  status: "draft",
};

describe("simulateRule", () => {
  it("reports condition match, child execution, and result", () => {
    const result = simulateRule({
      rule: sampleRule,
      ruleGroup: {
        id: "g1",
        sourceNode: "$.orders",
        executionMode: "first-match",
      },
      sampleDocument: { orders: { amount: 1500, note: "x" } },
    });
    expect(result.condition.matched).toBe(true);
    expect(result.matchedRoute).toBe("$.PriorityOrders");
    expect(result.childMappingsExecuted).toHaveLength(1);
    expect(result.unmappedRelativeFields).toContain("note");
    expect(result.resultObject).toEqual({
      PriorityOrders: { amount: 1500 },
    });
  });

  it("skips when condition fails", () => {
    const result = simulateRule({
      rule: sampleRule,
      ruleGroup: {
        id: "g1",
        sourceNode: "$.orders",
        executionMode: "first-match",
      },
      sampleDocument: { orders: { amount: 10 } },
    });
    expect(result.condition.matched).toBe(false);
    expect(result.matchedRoute).toBeNull();
  });
});

describe("rule templates", () => {
  it("captures portable relative condition and reinstantiates with new paths", () => {
    const tpl = ruleToTemplate(sampleRule, {
      name: "Amount priority route",
      description: "Route high-amount orders",
    });
    expect(tpl.condition).toEqual({
      type: "atom",
      atom: { path: "amount", operator: ">", value: 1000 },
    });
    expect(tpl.childMappings[0]?.sourcePath).toBe("amount");

    const rule = instantiateTemplate({
      template: tpl,
      sourceNode: "$.invoices",
      destinationNode: "$.PriorityInvoices",
      priority: 5,
    });
    expect(rule.sourceNode).toBe("$.invoices");
    expect(rule.destinationNode).toBe("$.PriorityInvoices");
    expect(rule.condition).toEqual(tpl.condition);
    expect(rule.metadata?.fromTemplateId).toBe(tpl.id);
  });
});
