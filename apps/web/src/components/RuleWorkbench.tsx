import type {
  ChildMapping,
  ConditionAtom,
  ConditionExpr,
  ConditionOperator,
  ExecutionMode,
  Rule,
  RuleCopyMode,
  RuleGroup,
  RuleKind,
} from "../api/client";
import { joinPathAware } from "@mapping-assurance/core";

const OPERATORS: ConditionOperator[] = [
  "==",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "IN",
  "NOT_IN",
  "EXISTS",
  "NOT_EXISTS",
  "CONTAINS",
  "STARTS_WITH",
  "ENDS_WITH",
  "MATCHES_REGEX",
];

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function emptyAtom(): ConditionAtom {
  return { path: "", operator: "==", value: "" };
}

function syncPriorities(rules: Rule[]): Rule[] {
  return rules.map((r, i) => ({ ...r, priority: (i + 1) * 10 }));
}

function resolveCopyMode(rule: Rule): RuleCopyMode {
  const children = rule.childMappings ?? [];
  return (
    rule.copyMode ??
    (children.length > 0 ? "APPLY_CHILD_MAPPINGS" : "ROUTE_ONLY")
  );
}

/** Resolve absolute child paths without crashing the workbench on bad input. */
function safeJoinPath(
  nodePath: string,
  relativePath: string,
  parentIsArray?: boolean,
): { path: string; error?: string } {
  try {
    return {
      path: joinPathAware(nodePath || "$", relativePath || ".", parentIsArray),
    };
  } catch (err) {
    return {
      path: "(invalid path)",
      error: err instanceof Error ? err.message : "Invalid path",
    };
  }
}

interface RuleWorkbenchProps {
  ruleGroups: RuleGroup[];
  selectedGroupId: string | null;
  selectedRuleId: string | null;
  highlightChildMappingId?: string | null;
  sourceSelected: string | null;
  targetSelected: string | null;
  onSelectGroup: (id: string | null) => void;
  onSelectRule: (id: string | null) => void;
  onChange: (groups: RuleGroup[]) => void;
}

export function RuleWorkbench({
  ruleGroups,
  selectedGroupId,
  selectedRuleId,
  highlightChildMappingId = null,
  sourceSelected,
  targetSelected,
  onSelectGroup,
  onSelectRule,
  onChange,
}: RuleWorkbenchProps) {
  const selectedGroup =
    ruleGroups.find((g) => g.id === selectedGroupId) ?? null;
  const selectedRule =
    selectedGroup?.rules.find((r) => r.id === selectedRuleId) ?? null;

  const destinationError =
    selectedRule && !selectedRule.destinationNode.trim()
      ? "Destination node is required."
      : null;

  function updateGroups(next: RuleGroup[]) {
    onChange(next);
  }

  function addGroup() {
    const sourceNode = sourceSelected ?? "$";
    const group: RuleGroup = {
      id: newId("rg"),
      name: `Group ${ruleGroups.length + 1}`,
      sourceNode,
      executionMode: "first-match",
      rules: [],
    };
    updateGroups([...ruleGroups, group]);
    onSelectGroup(group.id);
    onSelectRule(null);
  }

  function updateGroup(patch: Partial<RuleGroup>) {
    if (!selectedGroup) return;
    updateGroups(
      ruleGroups.map((g) =>
        g.id === selectedGroup.id ? { ...g, ...patch } : g,
      ),
    );
  }

  function addRule() {
    if (!selectedGroup) return;
    if (!targetSelected && !selectedGroup.sourceNode) {
      return;
    }
    const destinationNode = targetSelected ?? "";
    const rule: Rule = {
      id: newId("rule"),
      name: `Rule ${selectedGroup.rules.length + 1}`,
      category: "routing",
      sourceNode: selectedGroup.sourceNode,
      destinationNode,
      kind: "conditional",
      condition: { type: "atom", atom: emptyAtom() },
      priority: (selectedGroup.rules.length + 1) * 10,
      enabled: true,
      childMappings: [],
      status: "draft",
      copyMode: "APPLY_CHILD_MAPPINGS",
    };
    const nextRules = syncPriorities([...selectedGroup.rules, rule]);
    updateGroup({ rules: nextRules });
    onSelectRule(rule.id);
  }

  function updateRule(patch: Partial<Rule>) {
    if (!selectedGroup || !selectedRule) return;
    const rules = selectedGroup.rules.map((r) =>
      r.id === selectedRule.id
        ? {
            ...r,
            ...patch,
            sourceNode: selectedGroup.sourceNode,
          }
        : r,
    );
    updateGroup({ rules });
  }

  function deleteRule(ruleId: string) {
    if (!selectedGroup) return;
    updateGroup({
      rules: syncPriorities(selectedGroup.rules.filter((r) => r.id !== ruleId)),
    });
    if (selectedRuleId === ruleId) onSelectRule(null);
  }

  function deleteGroup(groupId: string) {
    updateGroups(ruleGroups.filter((g) => g.id !== groupId));
    if (selectedGroupId === groupId) {
      onSelectGroup(null);
      onSelectRule(null);
    }
  }

  function moveRule(groupId: string, ruleId: string, direction: -1 | 1) {
    updateGroups(
      ruleGroups.map((g) => {
        if (g.id !== groupId) return g;
        const idx = g.rules.findIndex((r) => r.id === ruleId);
        const target = idx + direction;
        if (idx < 0 || target < 0 || target >= g.rules.length) return g;
        const rules = [...g.rules];
        const [item] = rules.splice(idx, 1);
        rules.splice(target, 0, item!);
        return { ...g, rules: syncPriorities(rules) };
      }),
    );
  }

  function moveGroup(groupId: string, direction: -1 | 1) {
    const idx = ruleGroups.findIndex((g) => g.id === groupId);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= ruleGroups.length) return;
    const next = [...ruleGroups];
    const [item] = next.splice(idx, 1);
    next.splice(target, 0, item!);
    updateGroups(next);
  }

  function setConditionAtom(atom: ConditionAtom) {
    updateRule({
      kind: "conditional",
      condition: { type: "atom", atom },
    });
  }

  function addChildMapping() {
    if (!selectedRule) return;
    const child: ChildMapping = {
      id: newId("child"),
      sourcePath: "",
      targetPath: "",
      status: "draft",
    };
    const existing = selectedRule.childMappings ?? [];
    updateRule({
      childMappings: [...existing, child],
      copyMode: selectedRule.copyMode ?? "APPLY_CHILD_MAPPINGS",
    });
  }

  function updateChild(id: string, patch: Partial<ChildMapping>) {
    if (!selectedRule) return;
    updateRule({
      childMappings: (selectedRule.childMappings ?? []).map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    });
  }

  function removeChild(id: string) {
    if (!selectedRule) return;
    updateRule({
      childMappings: (selectedRule.childMappings ?? []).filter(
        (c) => c.id !== id,
      ),
    });
  }

  const atom: ConditionAtom | null =
    selectedRule?.condition?.type === "atom"
      ? selectedRule.condition.atom
      : selectedRule?.kind === "conditional"
        ? emptyAtom()
        : null;

  const sourceIsArray = Boolean(selectedGroup?.sourceNode.includes("[*]"));

  return (
    <section className="panel" id="rule-workbench" data-testid="rule-workbench">
      <div className="panel-header">
        <h2>Rules</h2>
        <div className="toolbar">
          <button type="button" className="btn" onClick={addGroup}>
            Add rule group
          </button>
          <button
            type="button"
            className="btn"
            disabled={!selectedGroup}
            onClick={addRule}
            title={
              !targetSelected
                ? "Select a target tree node for destination (or edit after create)"
                : undefined
            }
          >
            Add rule
          </button>
        </div>
      </div>

      <div className="workspace" style={{ gridTemplateColumns: "1fr 1.4fr" }}>
        <div>
          <p className="muted" style={{ fontSize: "0.8rem" }}>
            Hierarchy: RuleGroup → Rules → Child mappings. Lower priority wins
            within a group. Select a source tree node before Add rule group;
            select a target node for destinations.
          </p>
          {sourceIsArray ? (
            <p className="hint-banner" data-testid="array-hint">
              Source node contains <span className="mono">[*]</span>: preview
              evaluates per element; target arrays append.
            </p>
          ) : null}
          <div className="project-list" role="tree" aria-label="Rule hierarchy">
            {ruleGroups.length === 0 ? (
              <p className="muted">No rule groups yet. Add a group to start.</p>
            ) : (
              ruleGroups.map((g, gIdx) => (
                <div key={g.id} className="rule-tree-group">
                  <div
                    className={`project-item rule-row ${
                      g.id === selectedGroupId ? "active" : ""
                    }`}
                    role="treeitem"
                    aria-expanded="true"
                    aria-selected={g.id === selectedGroupId}
                  >
                    <button
                      type="button"
                      className="rule-select-btn"
                      aria-current={
                        g.id === selectedGroupId ? "true" : undefined
                      }
                      onClick={() => {
                        onSelectGroup(g.id);
                        onSelectRule(null);
                      }}
                    >
                      <div>
                        <div>{g.name ?? g.id}</div>
                        <div className="muted" style={{ fontSize: "0.75rem" }}>
                          <span className="mono">{g.sourceNode}</span> ·{" "}
                          {g.executionMode} · {g.rules.length} rules
                        </div>
                      </div>
                    </button>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={gIdx === 0}
                        aria-label="Move group up"
                        onClick={() => moveGroup(g.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={gIdx === ruleGroups.length - 1}
                        aria-label="Move group down"
                        onClick={() => moveGroup(g.id, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => deleteGroup(g.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {g.rules.length === 0 ? (
                    <p
                      className="muted"
                      style={{ marginLeft: "1rem", fontSize: "0.8rem" }}
                    >
                      No rules in this group.
                    </p>
                  ) : (
                    g.rules.map((r, rIdx) => (
                      <div key={r.id} className="rule-tree-rule">
                        <div
                          className={`project-item rule-row ${
                            r.id === selectedRuleId ? "active" : ""
                          } ${r.enabled ? "" : "rule-disabled"}`}
                          role="treeitem"
                          aria-selected={r.id === selectedRuleId}
                        >
                          <button
                            type="button"
                            className="rule-select-btn"
                            data-testid={`rule-row-${r.id}`}
                            aria-current={
                              r.id === selectedRuleId ? "true" : undefined
                            }
                            onClick={() => {
                              onSelectGroup(g.id);
                              onSelectRule(r.id);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onSelectGroup(g.id);
                                onSelectRule(r.id);
                              }
                            }}
                          >
                            <div>
                              <div className="chip-row">
                                <span>{r.name}</span>
                                <span className="badge info">{r.kind}</span>
                                <span className="badge info">p{r.priority}</span>
                                <span className="badge info">
                                  {resolveCopyMode(r)}
                                </span>
                                <span className="badge info">
                                  {(r.childMappings ?? []).length} children
                                </span>
                                {!r.enabled ? (
                                  <span className="badge warning">disabled</span>
                                ) : null}
                                {r.migrationSource === "FIELD_MAPPING_V1" ? (
                                  <span className="badge info">legacy</span>
                                ) : null}
                              </div>
                              <div
                                className="mono muted"
                                style={{ fontSize: "0.72rem" }}
                              >
                                → {r.destinationNode || "(no destination)"}
                              </div>
                            </div>
                          </button>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="btn"
                              disabled={rIdx === 0}
                              aria-label="Move rule up"
                              data-testid={`rule-move-up-${r.id}`}
                              onClick={() => moveRule(g.id, r.id, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="btn"
                              disabled={rIdx === g.rules.length - 1}
                              aria-label="Move rule down"
                              onClick={() => moveRule(g.id, r.id, 1)}
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                        {(r.childMappings ?? []).length > 0 ? (
                          <ul className="child-summary-list">
                            {(r.childMappings ?? []).map((c) => (
                              <li
                                key={c.id}
                                className={
                                  highlightChildMappingId === c.id
                                    ? "child-highlight"
                                    : undefined
                                }
                              >
                                <span className="mono">
                                  {c.sourcePath || "?"} → {c.targetPath || "?"}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          {!selectedGroup ? (
            <p className="muted">Select or create a rule group to edit.</p>
          ) : (
            <div className="inline-form">
              <label className="label" htmlFor="group-name">
                Group name
              </label>
              <input
                id="group-name"
                className="field"
                value={selectedGroup.name ?? ""}
                onChange={(e) => updateGroup({ name: e.target.value })}
              />
              <label className="label" htmlFor="group-source">
                Source node
              </label>
              <input
                id="group-source"
                className="field mono"
                value={selectedGroup.sourceNode}
                onChange={(e) => {
                  const sourceNode = e.target.value;
                  updateGroups(
                    ruleGroups.map((g) =>
                      g.id === selectedGroup.id
                        ? {
                            ...g,
                            sourceNode,
                            rules: g.rules.map((r) => ({ ...r, sourceNode })),
                          }
                        : g,
                    ),
                  );
                }}
              />
              <label className="label" htmlFor="group-mode">
                Execution mode
              </label>
              <select
                id="group-mode"
                className="field"
                value={selectedGroup.executionMode}
                onChange={(e) =>
                  updateGroup({
                    executionMode: e.target.value as ExecutionMode,
                  })
                }
              >
                <option value="first-match">first-match</option>
                <option value="all-match">all-match</option>
              </select>

              {!selectedRule ? (
                <p className="muted">Select a rule or click Add rule.</p>
              ) : (
                <>
                  <hr style={{ borderColor: "var(--border)", width: "100%" }} />
                  <label className="label" htmlFor="rule-name">
                    Rule name
                  </label>
                  <input
                    id="rule-name"
                    className="field"
                    value={selectedRule.name}
                    onChange={(e) => updateRule({ name: e.target.value })}
                  />
                  <label className="label" htmlFor="rule-dest">
                    Destination node
                  </label>
                  <input
                    id="rule-dest"
                    className="field mono"
                    aria-invalid={Boolean(destinationError)}
                    value={selectedRule.destinationNode}
                    onChange={(e) =>
                      updateRule({ destinationNode: e.target.value })
                    }
                  />
                  {destinationError ? (
                    <p className="error-text" data-testid="destination-error">
                      {destinationError}
                    </p>
                  ) : null}
                  <div className="toolbar">
                    <label className="label" htmlFor="rule-kind" style={{ margin: 0 }}>
                      Kind
                    </label>
                    <select
                      id="rule-kind"
                      className="field"
                      style={{ maxWidth: "12rem" }}
                      value={selectedRule.kind}
                      onChange={(e) => {
                        const kind = e.target.value as RuleKind;
                        if (kind === "conditional") {
                          updateRule({
                            kind,
                            category: "routing",
                            condition:
                              selectedRule.condition ?? {
                                type: "atom",
                                atom: emptyAtom(),
                              },
                          });
                        } else {
                          updateRule({
                            kind,
                            category: "routing",
                            condition: undefined,
                          });
                        }
                      }}
                    >
                      <option value="conditional">conditional</option>
                      <option value="unconditional">unconditional</option>
                      <option value="fallback">fallback</option>
                    </select>
                    <label
                      className="label"
                      htmlFor="rule-priority"
                      style={{ margin: 0 }}
                    >
                      Priority
                    </label>
                    <input
                      id="rule-priority"
                      className="field"
                      style={{ maxWidth: "6rem" }}
                      type="number"
                      value={selectedRule.priority}
                      onChange={(e) =>
                        updateRule({ priority: Number(e.target.value) })
                      }
                    />
                    <label
                      className="label"
                      htmlFor="rule-copy-mode"
                      style={{ margin: 0 }}
                    >
                      Copy mode
                    </label>
                    <select
                      id="rule-copy-mode"
                      className="field"
                      style={{ maxWidth: "14rem" }}
                      value={resolveCopyMode(selectedRule)}
                      onChange={(e) =>
                        updateRule({
                          copyMode: e.target.value as RuleCopyMode,
                        })
                      }
                    >
                      <option value="ROUTE_ONLY">ROUTE_ONLY</option>
                      <option value="COPY_SOURCE_NODE">COPY_SOURCE_NODE</option>
                      <option value="APPLY_CHILD_MAPPINGS">
                        APPLY_CHILD_MAPPINGS
                      </option>
                    </select>
                    <label className="muted" style={{ fontSize: "0.8rem" }}>
                      <input
                        type="checkbox"
                        checked={selectedRule.enabled}
                        onChange={(e) =>
                          updateRule({ enabled: e.target.checked })
                        }
                      />{" "}
                      enabled
                    </label>
                  </div>

                  {selectedRule.kind === "conditional" && atom ? (
                    <>
                      <label className="label" htmlFor="cond-path">
                        Condition (atom MVP)
                      </label>
                      <div className="toolbar">
                        <input
                          id="cond-path"
                          className="field mono"
                          placeholder="path (relative or $.…)"
                          value={atom.path}
                          onChange={(e) =>
                            setConditionAtom({ ...atom, path: e.target.value })
                          }
                        />
                        <select
                          className="field"
                          style={{ maxWidth: "10rem" }}
                          aria-label="Condition operator"
                          value={atom.operator}
                          onChange={(e) =>
                            setConditionAtom({
                              ...atom,
                              operator: e.target.value as ConditionOperator,
                            })
                          }
                        >
                          {OPERATORS.map((op) => (
                            <option key={op} value={op}>
                              {op}
                            </option>
                          ))}
                        </select>
                        <input
                          className="field"
                          aria-label="Condition value"
                          placeholder="value"
                          value={
                            atom.value === undefined || atom.value === null
                              ? ""
                              : String(atom.value)
                          }
                          disabled={
                            atom.operator === "EXISTS" ||
                            atom.operator === "NOT_EXISTS"
                          }
                          onChange={(e) => {
                            const raw = e.target.value;
                            let value: unknown = raw;
                            if (raw === "true") value = true;
                            else if (raw === "false") value = false;
                            else if (raw !== "" && !Number.isNaN(Number(raw)))
                              value = Number(raw);
                            setConditionAtom({ ...atom, value });
                          }}
                        />
                      </div>
                      <p className="muted" style={{ fontSize: "0.75rem" }}>
                        Nested AND/OR/NOT editing is available via API/core; UI
                        ships atom conditions for MVP.
                      </p>
                    </>
                  ) : null}

                  <div className="panel-header" style={{ marginTop: "0.5rem" }}>
                    <h2>Child mappings</h2>
                    <button
                      type="button"
                      className="btn"
                      onClick={addChildMapping}
                    >
                      Add child mapping
                    </button>
                  </div>
                  {(selectedRule.childMappings ?? []).length === 0 ? (
                    <p className="muted">
                      No child mappings.{" "}
                      {resolveCopyMode(selectedRule) === "ROUTE_ONLY"
                        ? "ROUTE_ONLY records the destination without copying payload."
                        : resolveCopyMode(selectedRule) === "COPY_SOURCE_NODE"
                          ? "COPY_SOURCE_NODE copies the whole source node."
                          : "APPLY_CHILD_MAPPINGS needs at least one child row."}
                    </p>
                  ) : (
                    <table className="mapping-table">
                      <thead>
                        <tr>
                          <th>Source (relative)</th>
                          <th>Target (relative)</th>
                          <th>Resolved abs</th>
                          <th>Transform (stored, not executed)</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedRule.childMappings ?? []).map((c) => {
                          const joinedSource = safeJoinPath(
                            selectedGroup.sourceNode,
                            c.sourcePath || ".",
                            sourceIsArray,
                          );
                          // Destination array-ness only — do not inherit source [*]
                          // (that previously corrupted `$[*].…` targets and blanked the UI).
                          const joinedTarget = safeJoinPath(
                            selectedRule.destinationNode || "$",
                            c.targetPath || ".",
                            selectedRule.destinationNode.endsWith("[*]"),
                          );
                          const pathError =
                            c.sourcePath.startsWith("$.") ||
                            c.sourcePath.startsWith("$[") ||
                            c.targetPath.startsWith("$.") ||
                            c.targetPath.startsWith("$[")
                              ? "Relative paths should not start with $."
                              : joinedSource.error || joinedTarget.error || null;
                          return (
                            <tr
                              key={c.id}
                              className={
                                highlightChildMappingId === c.id
                                  ? "child-highlight"
                                  : undefined
                              }
                              data-testid={`child-row-${c.id}`}
                            >
                              <td>
                                <input
                                  className="field mono"
                                  aria-label="Child source path"
                                  value={c.sourcePath}
                                  onChange={(e) =>
                                    updateChild(c.id, {
                                      sourcePath: e.target.value,
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  className="field mono"
                                  aria-label="Child target path"
                                  value={c.targetPath}
                                  onChange={(e) =>
                                    updateChild(c.id, {
                                      targetPath: e.target.value,
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <div
                                  className="mono muted"
                                  style={{ fontSize: "0.7rem" }}
                                >
                                  {joinedSource.path}
                                  <br />→ {joinedTarget.path}
                                </div>
                                {pathError ? (
                                  <div className="error-text">{pathError}</div>
                                ) : null}
                              </td>
                              <td>
                                <input
                                  className="field"
                                  placeholder="optional type"
                                  aria-label="Transformation type metadata"
                                  value={c.transformation?.type ?? ""}
                                  onChange={(e) =>
                                    updateChild(c.id, {
                                      transformation: e.target.value
                                        ? { type: e.target.value }
                                        : undefined,
                                    })
                                  }
                                />
                                <div
                                  className="muted"
                                  style={{ fontSize: "0.7rem" }}
                                >
                                  metadata only
                                </div>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="btn btn-danger"
                                  onClick={() => removeChild(c.id)}
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}

                  <div className="toolbar">
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => deleteRule(selectedRule.id)}
                    >
                      Delete rule
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export type { ConditionExpr };
