import { useState } from "react";
import type { Rule, RuleGroup, RuleSimulationResult } from "@mapping-assurance/core";
import { api } from "../api/client";

interface RuleSimulatorPanelProps {
  ruleGroups: RuleGroup[];
  selectedGroupId: string | null;
  selectedRuleId: string | null;
  defaultSampleJson: string;
  onSelectRule: (groupId: string, ruleId: string) => void;
}

export function RuleSimulatorPanel({
  ruleGroups,
  selectedGroupId,
  selectedRuleId,
  defaultSampleJson,
  onSelectRule,
}: RuleSimulatorPanelProps) {
  const [sampleJson, setSampleJson] = useState(defaultSampleJson);
  const [result, setResult] = useState<RuleSimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedGroup =
    ruleGroups.find((g) => g.id === selectedGroupId) ?? null;
  const selectedRule =
    selectedGroup?.rules.find((r) => r.id === selectedRuleId) ?? null;

  const allRules: Array<{ group: RuleGroup; rule: Rule }> = [];
  for (const g of ruleGroups) {
    for (const r of g.rules) allRules.push({ group: g, rule: r });
  }

  async function runSimulate() {
    if (!selectedGroup || !selectedRule) {
      setError("Select a rule in the workbench first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await api.simulate({
        rule: selectedRule,
        ruleGroup: {
          id: selectedGroup.id,
          sourceNode: selectedGroup.sourceNode,
          executionMode: selectedGroup.executionMode,
        },
        sampleJson,
      });
      setResult(data.simulation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulate failed");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" data-testid="rule-simulator">
      <div className="panel-header">
        <h2>Rule Simulator</h2>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !selectedRule}
          onClick={() => void runSimulate()}
        >
          Simulate selected rule
        </button>
      </div>
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Debugging aid: evaluate one rule against sample JSON using the Preview
        engine. Shows condition, route, children, unmapped fields, and output.
      </p>

      <label className="label" htmlFor="sim-rule-pick">
        Rule
      </label>
      <select
        id="sim-rule-pick"
        className="field"
        value={
          selectedGroup && selectedRule
            ? `${selectedGroup.id}::${selectedRule.id}`
            : ""
        }
        onChange={(e) => {
          const [gid, rid] = e.target.value.split("::");
          if (gid && rid) onSelectRule(gid, rid);
        }}
      >
        <option value="">Select a rule…</option>
        {allRules.map(({ group, rule }) => (
          <option key={rule.id} value={`${group.id}::${rule.id}`}>
            {group.name ?? group.id} / {rule.name} ({rule.kind})
          </option>
        ))}
      </select>

      <label className="label" htmlFor="sim-sample">
        Sample source document
      </label>
      <textarea
        id="sim-sample"
        className="field mono"
        style={{ minHeight: 120 }}
        value={sampleJson}
        onChange={(e) => setSampleJson(e.target.value)}
      />

      {error ? <p className="error-text">{error}</p> : null}

      {result ? (
        <div className="sim-results" data-testid="sim-results">
          <div className="summary-grid">
            <div className="stat">
              <div className="value">
                {result.condition.matched === null
                  ? "—"
                  : result.condition.matched
                    ? "yes"
                    : "no"}
              </div>
              <div className="label">Condition matched</div>
            </div>
            <div className="stat">
              <div className="value mono" style={{ fontSize: "0.85rem" }}>
                {result.matchedRoute ?? "—"}
              </div>
              <div className="label">Matched route</div>
            </div>
            <div className="stat">
              <div className="value">{result.childMappingsExecuted.length}</div>
              <div className="label">Children executed</div>
            </div>
            <div className="stat">
              <div className="value">{result.unmappedRelativeFields.length}</div>
              <div className="label">Unmapped fields</div>
            </div>
          </div>
          <p>
            <span className="muted">Condition:</span> {result.condition.detail}
          </p>
          {result.skippedReason ? (
            <p className="warning-text">Skipped: {result.skippedReason}</p>
          ) : null}
          <p>
            <span className="muted">Copy mode:</span> {result.copyMode}
          </p>
          {result.unmappedRelativeFields.length > 0 ? (
            <p>
              <span className="muted">Unmapped:</span>{" "}
              <span className="mono">
                {result.unmappedRelativeFields.join(", ")}
              </span>
            </p>
          ) : null}
          {result.warnings.length > 0 ? (
            <div className="issue-list">
              {result.warnings.map((w, i) => (
                <article key={i} className="issue warning">
                  <p>{w}</p>
                </article>
              ))}
            </div>
          ) : null}
          <h2>Child mappings executed</h2>
          {result.childMappingsExecuted.length === 0 ? (
            <p className="muted">None</p>
          ) : (
            <ul>
              {result.childMappingsExecuted.map((c) => (
                <li key={c.id} className="mono">
                  {c.sourcePath} → {c.targetPath} ({JSON.stringify(c.value)})
                  {c.transformationDeferred
                    ? ` [transform ${c.transformationDeferred} deferred]`
                    : ""}
                </li>
              ))}
            </ul>
          )}
          <h2>Result object</h2>
          <textarea
            className="field"
            readOnly
            aria-label="Simulation result object"
            value={JSON.stringify(result.resultObject, null, 2)}
            style={{ minHeight: 120 }}
          />
        </div>
      ) : null}
    </section>
  );
}
