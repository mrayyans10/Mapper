import type { FieldMapping, MappingProject } from "../types.js";
import {
  PROJECT_SCHEMA_VERSION_V1,
  PROJECT_SCHEMA_VERSION_V2,
  type Rule,
  type RuleGroup,
} from "../rule/types.js";

export interface MigrateOptions {
  /** When true, recompute ruleGroups from mappings even if already v2. Default false. */
  force?: boolean;
}

/**
 * Migrate a v1 FieldMapping-based project to v2 RuleGroups (D2, D3).
 *
 * - One RuleGroup per FieldMapping (no automatic parent grouping)
 * - Unconditional `direct` Rule with migrationSource = FIELD_MAPPING_V1
 * - executionMode = all-match
 * - Original `mappings` array preserved for rollback / dual-write
 */
export function migrateProjectV1toV2(
  project: MappingProject,
  options: MigrateOptions = {},
): MappingProject {
  const version = project.schemaVersion ?? PROJECT_SCHEMA_VERSION_V1;
  if (version >= PROJECT_SCHEMA_VERSION_V2 && !options.force) {
    return {
      ...project,
      schemaVersion: PROJECT_SCHEMA_VERSION_V2,
      ruleGroups: project.ruleGroups ?? [],
      mappings: project.mappings ?? [],
    };
  }

  const mappings = project.mappings ?? [];
  const ruleGroups = mappingsToLegacyRuleGroups(mappings);

  return {
    ...project,
    schemaVersion: PROJECT_SCHEMA_VERSION_V2,
    ruleGroups,
    mappings,
  };
}

/** Convert a flat FieldMapping list into legacy direct RuleGroups (D2). */
export function mappingsToLegacyRuleGroups(
  mappings: FieldMapping[],
): RuleGroup[] {
  return mappings.map((m, index) => fieldMappingToLegacyGroup(m, index));
}

export function fieldMappingToLegacyGroup(
  m: FieldMapping,
  index: number,
): RuleGroup {
  const metadata: Record<string, unknown> = {};
  if (m.transformationNote !== undefined) {
    metadata.transformationNote = m.transformationNote;
  }

  const rule: Rule = {
    id: m.id,
    name: `${m.sourcePath} → ${m.targetPath}`,
    category: "direct",
    sourceNode: m.sourcePath,
    destinationNode: m.targetPath,
    kind: "unconditional",
    priority: index + 1,
    enabled: true,
    childMappings: [],
    migrationSource: "FIELD_MAPPING_V1",
    status: m.status,
    ...(m.rationale !== undefined ? { rationale: m.rationale } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };

  return {
    id: `rg_legacy_${m.id}`,
    name: `Legacy: ${m.sourcePath}`,
    sourceNode: m.sourcePath,
    executionMode: "all-match",
    rules: [rule],
  };
}

/**
 * Dual-write helper: rebuild legacy FieldMapping[] from v2 direct legacy rules.
 * Non-legacy routing rules are ignored (cannot be represented in v1).
 */
export function legacyMappingsFromRuleGroups(
  ruleGroups: RuleGroup[],
): FieldMapping[] {
  const out: FieldMapping[] = [];
  for (const group of ruleGroups) {
    for (const rule of group.rules) {
      if (rule.migrationSource !== "FIELD_MAPPING_V1" && rule.category !== "direct") {
        continue;
      }
      if (rule.category !== "direct") continue;
      const note = rule.metadata?.transformationNote;
      out.push({
        id: rule.id,
        sourcePath: rule.sourceNode,
        targetPath: rule.destinationNode,
        status: rule.status,
        ...(rule.rationale !== undefined ? { rationale: rule.rationale } : {}),
        ...(typeof note === "string" ? { transformationNote: note } : {}),
      });
    }
  }
  return out;
}

export function needsMigration(project: MappingProject): boolean {
  const version = project.schemaVersion ?? PROJECT_SCHEMA_VERSION_V1;
  return version < PROJECT_SCHEMA_VERSION_V2;
}
