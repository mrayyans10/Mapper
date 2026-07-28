import { describe, expect, it } from "vitest";
import { createMapping } from "../mapping/model.js";
import {
  exportMappingReportCsv,
  exportMappingReportMarkdown,
  exportMappingsJson,
  exportPreviewJson,
  exportRuleGroupsJson,
} from "./format.js";
import type { RuleGroup } from "../rule/types.js";
import type { PreviewReport } from "../types.js";

describe("export formats", () => {
  const mappings = [
    createMapping({
      sourcePath: "$.a",
      targetPath: "$.b",
      status: "reviewed",
      rationale: "same meaning",
    }),
  ];

  const ruleGroups: RuleGroup[] = [
    {
      id: "g1",
      name: "Orders",
      sourceNode: "$.orders",
      executionMode: "first-match",
      rules: [
        {
          id: "r1",
          name: "High",
          category: "routing",
          sourceNode: "$.orders",
          destinationNode: "$.Priority",
          kind: "conditional",
          priority: 10,
          enabled: true,
          childMappings: [],
          status: "draft",
        },
      ],
    },
  ];

  it("exports mappings JSON", () => {
    const json = JSON.parse(exportMappingsJson(mappings)) as {
      mappings: typeof mappings;
    };
    expect(json.mappings).toHaveLength(1);
    expect(json.mappings[0]?.sourcePath).toBe("$.a");
  });

  it("exports rule groups JSON", () => {
    const json = JSON.parse(
      exportRuleGroupsJson({ schemaVersion: 2, ruleGroups }),
    ) as { ruleGroups: RuleGroup[]; schemaVersion: number };
    expect(json.schemaVersion).toBe(2);
    expect(json.ruleGroups[0]?.rules[0]?.id).toBe("r1");
  });

  it("exports preview JSON", () => {
    const preview: PreviewReport = {
      generatedAt: new Date().toISOString(),
      matchedRules: [],
      skippedRules: [],
      fallbackUsed: false,
      destinations: [],
      resultObject: { ok: true },
    };
    const json = JSON.parse(exportPreviewJson(preview)) as {
      preview: PreviewReport;
    };
    expect(json.preview.resultObject).toEqual({ ok: true });
  });

  it("exports CSV and Markdown with rule issues", () => {
    const csv = exportMappingReportCsv(mappings);
    expect(csv.split("\n")[0]).toContain("sourcePath");
    expect(csv).toContain("$.a");

    const md = exportMappingReportMarkdown({
      name: "Demo",
      mappings,
      ruleGroups,
      validationReport: {
        generatedAt: new Date().toISOString(),
        summary: {
          requiredTargetFieldsMissing: 0,
          optionalTargetFieldsUnmapped: 0,
          datatypeConflicts: 0,
          arraysNeedingManualReview: 0,
          potentialDuplicateMappings: 0,
          unusedSourceFields: 0,
          structurallyUnreachable: 0,
          errorCount: 1,
          warningCount: 0,
          infoCount: 0,
        },
        issues: [],
        ruleIssues: [
          {
            severity: "error",
            type: "invariant_violation",
            ruleId: "r1",
            message: "Destination empty",
            recommendedFix: "Set destinationNode",
          },
        ],
      },
    });
    expect(md).toContain("# Mapping Assurance Report: Demo");
    expect(md).toContain("## Rule groups");
    expect(md).toContain("## Rule issues");
    expect(md).toContain("r1");
  });
});
