import { describe, expect, it } from "vitest";
import { createMapping } from "../mapping/model.js";
import {
  exportMappingReportCsv,
  exportMappingReportMarkdown,
  exportMappingsJson,
} from "./format.js";

describe("export formats", () => {
  const mappings = [
    createMapping({
      sourcePath: "$.a",
      targetPath: "$.b",
      status: "reviewed",
      rationale: "same meaning",
    }),
  ];

  it("exports mappings JSON", () => {
    const json = JSON.parse(exportMappingsJson(mappings)) as {
      mappings: typeof mappings;
    };
    expect(json.mappings).toHaveLength(1);
    expect(json.mappings[0]?.sourcePath).toBe("$.a");
  });

  it("exports CSV and Markdown", () => {
    const csv = exportMappingReportCsv(mappings);
    expect(csv.split("\n")[0]).toContain("sourcePath");
    expect(csv).toContain("$.a");

    const md = exportMappingReportMarkdown({
      name: "Demo",
      mappings,
      validationReport: null,
    });
    expect(md).toContain("# Mapping Assurance Report: Demo");
    expect(md).toContain("$.a");
  });
});
