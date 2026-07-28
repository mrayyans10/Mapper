import { describe, expect, it } from "vitest";
import { migrateProjectV1toV2 } from "../migration/v1-to-v2.js";
import { resolveRuleCopyMode } from "../rule/copy-mode.js";
import {
  expandEquivalentPaths,
  joinPathAware,
  normalizeArrayPath,
  pathsEquivalent,
} from "../rule/paths.js";
import type { Rule, RuleGroup } from "../rule/types.js";
import { PROJECT_SCHEMA_VERSION_V1 } from "../rule/types.js";
import { inferSchema } from "../schema/infer.js";
import type { FieldMapping, MappingProject } from "../types.js";
import { previewRuleGroups } from "../preview/engine.js";
import {
  validateProjectRules,
  validateRuleGroups,
} from "./rule-validation.js";

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

describe("V2 array path normalization", () => {
  it("treats $.arr, $.arr[*], and child forms as equivalent for coverage", () => {
    expect(pathsEquivalent("$.items", "$.items[*]")).toBe(true);
    expect(pathsEquivalent("$.items.sku", "$.items[*].sku")).toBe(true);
    expect(expandEquivalentPaths("$.items.sku")).toContain("$.items[*].sku");
    expect(normalizeArrayPath("$.items[*].sku")).toBe("$.items[*].sku");
  });

  it("joinPathAware inserts [*] when parent is array", () => {
    expect(joinPathAware("$.PrimaryProducts", "productCode", true)).toBe(
      "$.PrimaryProducts[*].productCode",
    );
  });

  it("does not warn unused on array destination when children are mapped", () => {
    const source = inferSchema({
      items: [{ productType: "P", sku: "A" }],
    });
    const target = inferSchema({
      PrimaryProducts: [{ productCode: "A" }],
    });
    // Mark PrimaryProducts required to ensure we only care about unused/coverage
    target.nodes["$.PrimaryProducts"]!.required = false;

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
            ],
          }),
        ],
      },
    ];

    const report = validateRuleGroups(groups, source, target);
    expect(
      report.issues.some(
        (i) =>
          i.type === "unmapped_optional_target" &&
          i.targetPath === "$.PrimaryProducts",
      ),
    ).toBe(false);
    expect(
      report.issues.some(
        (i) =>
          i.type === "unused_mapping" &&
          i.targetPath?.includes("PrimaryProducts"),
      ),
    ).toBe(false);
  });
});

describe("V3 scoped required fields", () => {
  it("separates project-wide vs conditional-route required findings", () => {
    const source = inferSchema({
      orders: { amount: 10 },
      email: "a@b.c",
    });
    const target = inferSchema({
      PriorityOrders: { amount: 10, tier: "gold" },
      contactEmail: "a@b.c",
      globalRequired: "x",
    });
    target.nodes["$.PriorityOrders.tier"]!.required = true;
    target.nodes["$.globalRequired"]!.required = true;

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
            childMappings: [
              {
                id: "c",
                sourcePath: "amount",
                targetPath: "amount",
                status: "draft",
              },
            ],
          }),
        ],
      },
    ];

    const report = validateRuleGroups(groups, source, target);
    const tier = report.issues.find(
      (i) =>
        i.type === "unmapped_required_target" &&
        i.targetPath === "$.PriorityOrders.tier",
    );
    const global = report.issues.find(
      (i) =>
        i.type === "unmapped_required_target" &&
        i.targetPath === "$.globalRequired",
    );
    expect(tier?.scope).toBe("conditional_route");
    expect(tier?.severity).toBe("warning");
    expect(global?.scope).toBe("project");
    expect(global?.severity).toBe("error");
  });
});

describe("V5 duplicate suppression", () => {
  it("does not duplicate legacy issues when migrated rules exist", () => {
    const source = inferSchema({ email: "a@b.c", age: 1 });
    const target = inferSchema({ contactEmail: "a@b.c", years: 1 });
    const mappings: FieldMapping[] = [
      {
        id: "m1",
        sourcePath: "$.email",
        targetPath: "$.contactEmail",
        status: "draft",
      },
    ];
    const project: MappingProject = migrateProjectV1toV2({
      id: "p",
      name: "p",
      schemaVersion: PROJECT_SCHEMA_VERSION_V1,
      sourceJson: "{}",
      targetJson: "{}",
      sourceSchema: source,
      targetSchema: target,
      ruleGroups: [],
      mappings,
      validationReport: null,
      createdAt: "",
      updatedAt: "",
    });

    const report = validateProjectRules(
      {
        ruleGroups: project.ruleGroups,
        sourceSchema: source,
        targetSchema: target,
        mappings,
      },
      { includeLegacyMappingValidation: true },
    );

    const emailUnused = report.issues.filter(
      (i) => i.sourcePath === "$.age" || i.targetPath === "$.years",
    );
    // Should not double-count the mapped email pair as both rule + legacy conflicts
    const emailIssues = report.issues.filter(
      (i) =>
        i.sourcePath === "$.email" || i.targetPath === "$.contactEmail",
    );
    const keys = new Set(
      emailIssues.map(
        (i) => `${i.issueType}|${i.sourcePath}|${i.targetPath}|${i.explanation}`,
      ),
    );
    expect(keys.size).toBe(emailIssues.length);
    void emailUnused;
  });
});

describe("P2 copy modes", () => {
  it("defaults to ROUTE_ONLY without children and APPLY_CHILD_MAPPINGS with children", () => {
    expect(
      resolveRuleCopyMode(
        rule({
          id: "a",
          sourceNode: "$.orders",
          destinationNode: "$.X",
          kind: "unconditional",
        }),
      ),
    ).toBe("ROUTE_ONLY");
    expect(
      resolveRuleCopyMode(
        rule({
          id: "b",
          sourceNode: "$.orders",
          destinationNode: "$.X",
          kind: "unconditional",
          childMappings: [
            { id: "c", sourcePath: "a", targetPath: "b", status: "draft" },
          ],
        }),
      ),
    ).toBe("APPLY_CHILD_MAPPINGS");
  });

  it("ROUTE_ONLY does not copy payload; COPY_SOURCE_NODE does", () => {
    const routeOnly: RuleGroup[] = [
      {
        id: "g",
        sourceNode: "$.orders",
        executionMode: "all-match",
        rules: [
          rule({
            id: "r",
            sourceNode: "$.orders",
            destinationNode: "$.PriorityOrders",
            kind: "unconditional",
            copyMode: "ROUTE_ONLY",
          }),
        ],
      },
    ];
    const copyNode: RuleGroup[] = [
      {
        id: "g",
        sourceNode: "$.orders",
        executionMode: "all-match",
        rules: [
          rule({
            id: "r",
            sourceNode: "$.orders",
            destinationNode: "$.PriorityOrders",
            kind: "unconditional",
            copyMode: "COPY_SOURCE_NODE",
          }),
        ],
      },
    ];
    const doc = { orders: { amount: 5 } };
    const a = previewRuleGroups(routeOnly, doc);
    const b = previewRuleGroups(copyNode, doc);
    expect(a.resultObject).toEqual({});
    expect(a.traces.some((t) => t.action === "route_only")).toBe(true);
    expect(b.resultObject).toEqual({ PriorityOrders: { amount: 5 } });
  });
});

describe("P1 preview array append", () => {
  it("appends multiple source elements into the same target array", () => {
    const groups: RuleGroup[] = [
      {
        id: "g1",
        sourceNode: "$.items[*]",
        executionMode: "all-match",
        rules: [
          rule({
            id: "all",
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
            ],
          }),
        ],
      },
    ];
    const report = previewRuleGroups(groups, {
      items: [
        { sku: "A" },
        { sku: "B" },
      ],
    });
    expect(report.resultObject).toEqual({
      PrimaryProducts: [{ productCode: "A" }, { productCode: "B" }],
    });
  });

  it("routes elements into different target arrays", () => {
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
            priority: 1,
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
            id: "other",
            sourceNode: "$.items[*]",
            destinationNode: "$.OtherProducts",
            kind: "fallback",
            priority: 10,
            copyMode: "APPLY_CHILD_MAPPINGS",
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
    expect(report.resultObject).toEqual({
      PrimaryProducts: [{ productCode: "A" }],
      OtherProducts: [{ productCode: "B" }],
    });
  });
});

describe("P3 transformation warning", () => {
  it("emits a clear warning when transformation is not executed", () => {
    const groups: RuleGroup[] = [
      {
        id: "g",
        sourceNode: "$.customer",
        executionMode: "all-match",
        rules: [
          rule({
            id: "r",
            sourceNode: "$.customer",
            destinationNode: "$.Out",
            kind: "unconditional",
            childMappings: [
              {
                id: "c1",
                sourcePath: "name",
                targetPath: "name",
                status: "draft",
                transformation: { type: "uppercase" },
              },
            ],
          }),
        ],
      },
    ];
    const report = previewRuleGroups(groups, { customer: { name: "Ada" } });
    expect(report.warnings.some((w) => /NOT executed/i.test(w))).toBe(true);
    expect(report.resultObject).toEqual({ Out: { name: "Ada" } });
  });
});
