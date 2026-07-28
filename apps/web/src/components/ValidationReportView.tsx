import type { ValidationReport } from "@mapping-assurance/core";

interface ValidationReportViewProps {
  report: ValidationReport | null;
  onNavigateToRule?: (
    ruleGroupId: string | undefined,
    ruleId: string | undefined,
    childMappingId?: string,
  ) => void;
}

export function ValidationReportView({
  report,
  onNavigateToRule,
}: ValidationReportViewProps) {
  if (!report) {
    return (
      <section className="panel" data-testid="validation-panel">
        <h2>Mapping Assurance Report</h2>
        <p className="muted">
          Run validation to generate a deterministic assurance report.
        </p>
      </section>
    );
  }

  const s = report.summary;
  const ruleIssues = report.ruleIssues;

  return (
    <section className="panel" data-testid="validation-panel">
      <div className="panel-header">
        <h2>Mapping Assurance Report</h2>
        <span className="muted" style={{ fontSize: "0.75rem" }}>
          {new Date(report.generatedAt).toLocaleString()}
        </span>
      </div>

      <div className="summary-grid">
        <div className="stat">
          <div className="value">{s.requiredTargetFieldsMissing}</div>
          <div className="label">Required missing (project-wide)</div>
        </div>
        <div className="stat">
          <div className="value">{s.optionalTargetFieldsUnmapped}</div>
          <div className="label">Optional target fields unmapped</div>
        </div>
        <div className="stat">
          <div className="value">{s.datatypeConflicts}</div>
          <div className="label">Datatype conflicts</div>
        </div>
        <div className="stat">
          <div className="value">{s.arraysNeedingManualReview}</div>
          <div className="label">Arrays needing manual review</div>
        </div>
        <div className="stat">
          <div className="value">{s.potentialDuplicateMappings}</div>
          <div className="label">Potential duplicate mappings</div>
        </div>
        <div className="stat">
          <div className="value">{s.structurallyUnreachable}</div>
          <div className="label">Unreachable / structural</div>
        </div>
      </div>

      <h2 style={{ marginTop: "0.25rem" }}>Detailed issues</h2>
      {ruleIssues && ruleIssues.length > 0 ? (
        <div className="issue-list" data-testid="rule-issues">
          {ruleIssues.map((issue, idx) => {
            const canNav = Boolean(
              onNavigateToRule && (issue.ruleId || issue.ruleGroupId),
            );
            return (
              <button
                type="button"
                key={issue.issueKey ?? `${issue.type}-${idx}`}
                className={`issue ${issue.severity} nav-issue ${
                  canNav ? "clickable" : ""
                }`}
                data-testid={`rule-issue-${issue.ruleId ?? issue.ruleGroupId ?? idx}`}
                disabled={!canNav}
                onClick={() =>
                  onNavigateToRule?.(
                    issue.ruleGroupId,
                    issue.ruleId,
                    issue.childMappingId,
                  )
                }
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && canNav) {
                    e.preventDefault();
                    onNavigateToRule?.(
                      issue.ruleGroupId,
                      issue.ruleId,
                      issue.childMappingId,
                    );
                  }
                }}
              >
                <div className="issue-top">
                  <span className={`badge ${issue.severity}`}>
                    {issue.severity}
                  </span>
                  <span className="mono muted">{issue.type}</span>
                  {issue.scope ? (
                    <span className="badge info">{issue.scope}</span>
                  ) : null}
                  {issue.ruleGroupId ? (
                    <span className="mono">group: {issue.ruleGroupId}</span>
                  ) : null}
                  {issue.ruleId ? (
                    <span className="mono">rule: {issue.ruleId}</span>
                  ) : null}
                  {issue.childMappingId ? (
                    <span className="mono">child: {issue.childMappingId}</span>
                  ) : null}
                  {issue.sourcePath ? (
                    <span className="mono">src: {issue.sourcePath}</span>
                  ) : null}
                  {issue.targetPath ? (
                    <span className="mono">tgt: {issue.targetPath}</span>
                  ) : null}
                </div>
                <p>{issue.message}</p>
                <p className="muted">Suggested: {issue.recommendedFix}</p>
              </button>
            );
          })}
        </div>
      ) : report.issues.length === 0 ? (
        <p className="muted">No issues found.</p>
      ) : (
        <div className="issue-list">
          {report.issues.map((issue, idx) => (
            <article
              key={`${issue.issueType}-${issue.sourcePath ?? ""}-${issue.targetPath ?? ""}-${idx}`}
              className={`issue ${issue.severity}`}
            >
              <div className="issue-top">
                <span className={`badge ${issue.severity}`}>{issue.severity}</span>
                <span className="mono muted">{issue.issueType}</span>
                {issue.sourcePath ? (
                  <span className="mono">src: {issue.sourcePath}</span>
                ) : null}
                {issue.targetPath ? (
                  <span className="mono">tgt: {issue.targetPath}</span>
                ) : null}
              </div>
              <p>{issue.explanation}</p>
              <p className="muted">Suggested: {issue.suggestedAction}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
