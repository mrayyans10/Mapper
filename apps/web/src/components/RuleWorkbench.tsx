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

interface RuleWorkbenchProps {
  ruleGroups: RuleGroup[];
  selectedGroupId: string | null;
  selectedRuleId: string | null;
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
    const rule: Rule = {
      id: newId("rule"),
      name: `Rule ${selectedGroup.rules.length + 1}`,
      category: "routing",
      sourceNode: selectedGroup.sourceNode,
      destinationNode: targetSelected ?? selectedGroup.sourceNode,
      kind: "conditional",
      condition: { type: "atom", atom: emptyAtom() },
      priority: (selectedGroup.rules.length + 1) * 10,
      enabled: true,
      childMappings: [],
      status: "draft",
      copyMode: "APPLY_CHILD_MAPPINGS",
    };
    const nextRules = [...selectedGroup.rules, rule];
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
      rules: selectedGroup.rules.filter((r) => r.id !== ruleId),
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
    updateRule({
      childMappings: [...selectedRule.childMappings, child],
      copyMode: selectedRule.copyMode ?? "APPLY_CHILD_MAPPINGS",
    });
  }

  function updateChild(id: string, patch: Partial<ChildMapping>) {
    if (!selectedRule) return;
    updateRule({
      childMappings: selectedRule.childMappings.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    });
  }

  function removeChild(id: string) {
    if (!selectedRule) return;
    updateRule({
      childMappings: selectedRule.childMappings.filter((c) => c.id !== id),
    });
  }

  const atom: ConditionAtom | null =
    selectedRule?.condition?.type === "atom"
      ? selectedRule.condition.atom
      : selectedRule?.kind === "conditional"
        ? emptyAtom()
        : null;

  return (
    <section className="panel">
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
          >
            Add rule
          </button>
        </div>
      </div>

      <div className="workspace" style={{ gridTemplateColumns: "1fr 1.4fr" }}>
        <div>
          <p className="muted" style={{ fontSize: "0.8rem" }}>
            Select a source tree node, then add a group (uses that sourceNode).
            Select a target node when creating a rule destination.
          </p>
          <div className="project-list">
            {ruleGroups.length === 0 ? (
              <p className="muted">No rule groups yet.</p>
            ) : (
              ruleGroups.map((g) => (
                <div key={g.id}>
                  <button
                    type="button"
                    className={`project-item ${
                      g.id === selectedGroupId ? "active" : ""
                    }`}
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
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteGroup(g.id);
                      }}
                    >
                      Delete
                    </button>
                  </button>
                  {g.id === selectedGroupId
                    ? g.rules.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          className={`project-item ${
                            r.id === selectedRuleId ? "active" : ""
                          }`}
                          style={{ marginLeft: "0.75rem", marginTop: "0.35rem" }}
                          onClick={() => onSelectRule(r.id)}
                        >
                          <div>
                            <div>
                              {r.name}{" "}
                              <span className="muted">({r.kind})</span>
                            </div>
                            <div className="mono muted" style={{ fontSize: "0.72rem" }}>
                              → {r.destinationNode} · p{r.priority}
                            </div>
                          </div>
                        </button>
                      ))
                    : null}
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
              <label className="label">Group name</label>
              <input
                className="field"
                value={selectedGroup.name ?? ""}
                onChange={(e) => updateGroup({ name: e.target.value })}
              />
              <label className="label">Source node</label>
              <input
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
              <label className="label">Execution mode</label>
              <select
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
                  <label className="label">Rule name</label>
                  <input
                    className="field"
                    value={selectedRule.name}
                    onChange={(e) => updateRule({ name: e.target.value })}
                  />
                  <label className="label">Destination node</label>
                  <input
                    className="field mono"
                    value={selectedRule.destinationNode}
                    onChange={(e) =>
                      updateRule({ destinationNode: e.target.value })
                    }
                  />
                  <div className="toolbar">
                    <label className="label" style={{ margin: 0 }}>
                      Kind
                    </label>
                    <select
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
                    <label className="label" style={{ margin: 0 }}>
                      Priority
                    </label>
                    <input
                      className="field"
                      style={{ maxWidth: "6rem" }}
                      type="number"
                      value={selectedRule.priority}
                      onChange={(e) =>
                        updateRule({ priority: Number(e.target.value) })
                      }
                    />
                    <label className="label" style={{ margin: 0 }}>
                      Copy mode
                    </label>
                    <select
                      className="field"
                      style={{ maxWidth: "14rem" }}
                      value={
                        selectedRule.copyMode ??
                        (selectedRule.childMappings.length > 0
                          ? "APPLY_CHILD_MAPPINGS"
                          : "ROUTE_ONLY")
                      }
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
                      <label className="label">Condition (atom)</label>
                      <div className="toolbar">
                        <input
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
                        Nested AND/OR/NOT editing is available via API/core;
                        UI ships atom conditions for MVP.
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
                  {selectedRule.childMappings.length === 0 ? (
                    <p className="muted">
                      No child mappings. With default copy mode this is
                      ROUTE_ONLY (no payload copy).
                    </p>
                  ) : (
                    <table className="mapping-table">
                      <thead>
                        <tr>
                          <th>Source (relative)</th>
                          <th>Target (relative)</th>
                          <th>Transform type</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRule.childMappings.map((c) => (
                          <tr key={c.id}>
                            <td>
                              <input
                                className="field mono"
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
                                value={c.targetPath}
                                onChange={(e) =>
                                  updateChild(c.id, {
                                    targetPath: e.target.value,
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="field"
                                placeholder="optional"
                                value={c.transformation?.type ?? ""}
                                onChange={(e) =>
                                  updateChild(c.id, {
                                    transformation: e.target.value
                                      ? { type: e.target.value }
                                      : undefined,
                                  })
                                }
                              />
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
                        ))}
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

// silence unused ConditionExpr import for future nested editor
export type { ConditionExpr };
