import type { PreviewReport } from "@mapping-assurance/core";

interface PreviewPanelProps {
  preview: PreviewReport | null;
  onNavigateToRule?: (ruleGroupId: string, ruleId: string) => void;
  onExportPreview?: () => void;
}

export function PreviewPanel({
  preview,
  onNavigateToRule,
  onExportPreview,
}: PreviewPanelProps) {
  if (!preview) {
    return (
      <section className="panel" data-testid="preview-panel">
        <h2>Preview</h2>
        <p className="muted">
          No preview yet. Run Preview to simulate which rules match and what
          payload is produced. Preview is session-only (not persisted).
        </p>
      </section>
    );
  }

  const materialization = (preview.traces ?? []).filter((t) =>
    ["child_copy", "direct_copy", "route_only", "copy_source_node"].includes(
      t.action,
    ),
  );

  function navRow(
    ruleGroupId: string,
    ruleId: string,
    reason: string,
    arrayIndex: number | undefined,
    extra?: string,
  ) {
    const clickable = Boolean(onNavigateToRule);
    return (
      <button
        type="button"
        className={`issue info nav-issue ${clickable ? "clickable" : ""}`}
        disabled={!clickable}
        onClick={() => onNavigateToRule?.(ruleGroupId, ruleId)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && onNavigateToRule) {
            e.preventDefault();
            onNavigateToRule(ruleGroupId, ruleId);
          }
        }}
      >
        <div className="issue-top">
          <span className="mono">{ruleId}</span>
          {arrayIndex !== undefined ? (
            <span className="mono">idx {arrayIndex}</span>
          ) : null}
          {extra ? <span className="badge info">{extra}</span> : null}
        </div>
        <p>{reason}</p>
      </button>
    );
  }

  return (
    <section className="panel" data-testid="preview-panel">
      <div className="panel-header">
        <h2>Preview</h2>
        <div className="toolbar">
          <span className="muted" style={{ fontSize: "0.75rem" }}>
            {new Date(preview.generatedAt).toLocaleString()} · session only
          </span>
          {onExportPreview ? (
            <button type="button" className="btn" onClick={onExportPreview}>
              Export preview JSON
            </button>
          ) : null}
        </div>
      </div>

      {preview.warnings && preview.warnings.length > 0 ? (
        <div
          className="issue-list"
          style={{ marginBottom: "0.75rem" }}
          data-testid="preview-warnings"
        >
          {preview.warnings.map((w, i) => (
            <article key={i} className="issue warning">
              <p>{w}</p>
            </article>
          ))}
        </div>
      ) : null}

      <div className="summary-grid">
        <div className="stat">
          <div className="value">{preview.matchedRules.length}</div>
          <div className="label">Matched rules</div>
        </div>
        <div className="stat">
          <div className="value">{preview.skippedRules.length}</div>
          <div className="label">Skipped rules</div>
        </div>
        <div className="stat">
          <div className="value">{preview.fallbackUsed ? "yes" : "no"}</div>
          <div className="label">Fallback used</div>
        </div>
        <div className="stat">
          <div className="value">{preview.destinations.length}</div>
          <div className="label">Destinations</div>
        </div>
      </div>

      <h2>Matched</h2>
      <div className="issue-list" data-testid="preview-matched">
        {preview.matchedRules.length === 0 ? (
          <p className="muted">No matched rules.</p>
        ) : (
          preview.matchedRules.map((m, idx) => (
            <div key={`${m.ruleId}-${idx}`}>
              {navRow(m.ruleGroupId, m.ruleId, m.reason, m.arrayIndex, "matched")}
            </div>
          ))
        )}
      </div>

      <h2>Skipped</h2>
      <div className="issue-list" data-testid="preview-skipped">
        {preview.skippedRules.length === 0 ? (
          <p className="muted">No skipped rules.</p>
        ) : (
          preview.skippedRules.map((m, idx) => (
            <div key={`${m.ruleId}-${idx}`}>
              {navRow(m.ruleGroupId, m.ruleId, m.reason, m.arrayIndex, "skipped")}
            </div>
          ))
        )}
      </div>

      <h2>Materialization</h2>
      <div className="issue-list" data-testid="preview-materialization">
        {materialization.length === 0 ? (
          <p className="muted">No materialization steps recorded.</p>
        ) : (
          materialization.map((t, idx) => (
            <button
              type="button"
              key={idx}
              className="issue info nav-issue clickable"
              onClick={() => onNavigateToRule?.(t.ruleGroupId, t.ruleId)}
            >
              <div className="issue-top">
                <span className="badge info">{t.action}</span>
                <span className="mono muted">{t.ruleId}</span>
                {t.arrayIndex !== undefined ? (
                  <span className="mono">idx {t.arrayIndex}</span>
                ) : null}
              </div>
              <p>{t.detail}</p>
            </button>
          ))
        )}
      </div>

      <h2>Destinations</h2>
      <p className="mono">{preview.destinations.join(", ") || "—"}</p>

      <h2>Result object</h2>
      <textarea
        className="field"
        readOnly
        aria-label="Preview result object"
        value={JSON.stringify(preview.resultObject, null, 2)}
        style={{ minHeight: 160 }}
      />
    </section>
  );
}
