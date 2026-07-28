import { describe, expect, it } from "vitest";
import type { FieldMapping, MappingProject } from "../types.js";
import { PROJECT_SCHEMA_VERSION_V1 } from "../rule/types.js";
import {
  legacyMappingsFromRuleGroups,
  migrateProjectV1toV2,
  needsMigration,
} from "./v1-to-v2.js";

function baseProject(mappings: FieldMapping[]): MappingProject {
  return {
    id: "p1",
    name: "Demo",
    schemaVersion: PROJECT_SCHEMA_VERSION_V1,
    sourceJson: "{}",
    targetJson: "{}",
    sourceSchema: { rootPath: "$", nodes: {} },
    targetSchema: { rootPath: "$", nodes: {} },
    ruleGroups: [],
    mappings,
    validationReport: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("migrateProjectV1toV2", () => {
  it("migrates empty mappings to empty ruleGroups", () => {
    const result = migrateProjectV1toV2(baseProject([]));
    expect(result.schemaVersion).toBe(2);
    expect(result.ruleGroups).toEqual([]);
    expect(needsMigration(result)).toBe(false);
  });

  it("creates one group per FieldMapping without auto-grouping (D2)", () => {
    const mappings: FieldMapping[] = [
      {
        id: "m1",
        sourcePath: "$.person.email",
        targetPath: "$.contact.email",
        status: "draft",
      },
      {
        id: "m2",
        sourcePath: "$.person.name",
        targetPath: "$.contact.name",
        status: "reviewed",
        rationale: "same meaning",
        transformationNote: "trim",
      },
    ];
    const result = migrateProjectV1toV2(baseProject(mappings));
    expect(result.ruleGroups).toHaveLength(2);
    expect(result.ruleGroups[0]?.sourceNode).toBe("$.person.email");
    expect(result.ruleGroups[1]?.sourceNode).toBe("$.person.name");
    // Must NOT collapse under $.person
    expect(
      result.ruleGroups.every((g) => g.sourceNode.startsWith("$.person.")),
    ).toBe(true);
    expect(result.ruleGroups[0]?.executionMode).toBe("all-match");
    expect(result.ruleGroups[0]?.rules[0]?.migrationSource).toBe(
      "FIELD_MAPPING_V1",
    );
    expect(result.ruleGroups[0]?.rules[0]?.category).toBe("direct");
    expect(result.ruleGroups[0]?.rules[0]?.childMappings).toEqual([]);
    expect(result.ruleGroups[1]?.rules[0]?.rationale).toBe("same meaning");
    expect(result.ruleGroups[1]?.rules[0]?.metadata?.transformationNote).toBe(
      "trim",
    );
    expect(result.ruleGroups[0]?.rules[0]?.priority).toBe(1);
    expect(result.ruleGroups[1]?.rules[0]?.priority).toBe(2);
    expect(result.mappings).toEqual(mappings);
  });

  it("is idempotent for v2 projects", () => {
    const once = migrateProjectV1toV2(
      baseProject([
        {
          id: "m1",
          sourcePath: "$.a",
          targetPath: "$.b",
          status: "draft",
        },
      ]),
    );
    const twice = migrateProjectV1toV2(once);
    expect(twice.ruleGroups).toEqual(once.ruleGroups);
  });

  it("force rebuilds from mappings", () => {
    const once = migrateProjectV1toV2(
      baseProject([
        { id: "m1", sourcePath: "$.a", targetPath: "$.b", status: "draft" },
      ]),
    );
    once.ruleGroups = [];
    const forced = migrateProjectV1toV2(once, { force: true });
    expect(forced.ruleGroups).toHaveLength(1);
  });

  it("round-trips legacy mappings from rule groups", () => {
    const mappings: FieldMapping[] = [
      {
        id: "m1",
        sourcePath: "$.a",
        targetPath: "$.b",
        status: "approved",
        rationale: "r",
        transformationNote: "n",
      },
    ];
    const migrated = migrateProjectV1toV2(baseProject(mappings));
    expect(legacyMappingsFromRuleGroups(migrated.ruleGroups)).toEqual(mappings);
  });
});
