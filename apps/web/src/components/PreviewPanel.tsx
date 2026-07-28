import type { PreviewReport } from "@mapping-assurance/core";

interface PreviewPanelProps {
  preview: PreviewReport | null;
}

export function PreviewPanel({ preview }: PreviewPanelProps) {
  if (!preview) {
    return (
      <section className="panel">
        <h2>Preview</h2>
        <p className="muted">
          Run Preview to simulate which rules match and what payload is produced.
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Preview</h2>
        <span className="muted" style={{ fontSize: "0.75rem" }}>
          {new Date(preview.generatedAt).toLocaleString()}
        </span>
      </div>

      {preview.warnings && preview.warnings.length > 0 ? (
        <div className="issue-list" style={{ marginBottom: "0.75rem" }}>
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

      <h2>Destinations</h2>
      <p className="mono">{preview.destinations.join(", ") || "—"}</p>

      <h2>Result object</h2>
      <textarea
        className="field"
        readOnly
        value={JSON.stringify(preview.resultObject, null, 2)}
        style={{ minHeight: 160 }}
      />

      <h2>Trace</h2>
      <div className="issue-list">
        {(preview.traces ?? []).map((t, idx) => (
          <article key={idx} className="issue info">
            <div className="issue-top">
              <span className="badge info">{t.action}</span>
              <span className="mono muted">{t.ruleId}</span>
              {t.arrayIndex !== undefined ? (
                <span className="mono">idx {t.arrayIndex}</span>
              ) : null}
            </div>
            <p>{t.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
