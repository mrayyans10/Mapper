import type {
  FieldMapping,
  MappingProject,
  ValidationReport,
} from "../types.js";

export function exportMappingsJson(mappings: FieldMapping[]): string {
  return JSON.stringify({ mappings }, null, 2);
}

export function exportValidationReportJson(report: ValidationReport): string {
  return JSON.stringify(report, null, 2);
}

export function exportMappingReportMarkdown(project: {
  name: string;
  mappings: FieldMapping[];
  validationReport: ValidationReport | null;
}): string {
  const lines: string[] = [];
  lines.push(`# Mapping Assurance Report: ${project.name}`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");

  if (project.validationReport) {
    const s = project.validationReport.summary;
    lines.push("## Summary");
    lines.push("");
    lines.push(`- Required target fields missing: ${s.requiredTargetFieldsMissing}`);
    lines.push(`- Optional target fields unmapped: ${s.optionalTargetFieldsUnmapped}`);
    lines.push(`- Datatype conflicts: ${s.datatypeConflicts}`);
    lines.push(`- Arrays needing manual review: ${s.arraysNeedingManualReview}`);
    lines.push(`- Potential duplicate mappings: ${s.potentialDuplicateMappings}`);
    lines.push(`- Unused source fields: ${s.unusedSourceFields}`);
    lines.push(`- Structurally unreachable: ${s.structurallyUnreachable}`);
    lines.push(`- Errors: ${s.errorCount}, Warnings: ${s.warningCount}, Info: ${s.infoCount}`);
    lines.push("");
  }

  lines.push("## Mappings");
  lines.push("");
  if (project.mappings.length === 0) {
    lines.push("_No mappings defined._");
  } else {
    lines.push("| Source | Target | Status | Note | Rationale |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const m of project.mappings) {
      lines.push(
        `| \`${m.sourcePath}\` | \`${m.targetPath}\` | ${m.status} | ${escapeCell(m.transformationNote ?? "")} | ${escapeCell(m.rationale ?? "")} |`,
      );
    }
  }
  lines.push("");

  if (project.validationReport && project.validationReport.issues.length > 0) {
    lines.push("## Issues");
    lines.push("");
    for (const issue of project.validationReport.issues) {
      lines.push(
        `- **[${issue.severity.toUpperCase()}]** ${issue.issueType}: ${issue.explanation}`,
      );
      lines.push(`  - Suggested: ${issue.suggestedAction}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function exportMappingReportCsv(mappings: FieldMapping[]): string {
  const header = [
    "id",
    "sourcePath",
    "targetPath",
    "status",
    "transformationNote",
    "rationale",
  ];
  const rows = mappings.map((m) =>
    [
      m.id,
      m.sourcePath,
      m.targetPath,
      m.status,
      m.transformationNote ?? "",
      m.rationale ?? "",
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

export function exportProjectBundle(project: MappingProject): string {
  return JSON.stringify(
    {
      id: project.id,
      name: project.name,
      sourceJson: JSON.parse(project.sourceJson) as unknown,
      targetJson: JSON.parse(project.targetJson) as unknown,
      sourceSchema: project.sourceSchema,
      targetSchema: project.targetSchema,
      mappings: project.mappings,
      validationReport: project.validationReport,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    null,
    2,
  );
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
