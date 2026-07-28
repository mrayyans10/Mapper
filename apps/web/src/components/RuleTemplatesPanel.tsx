import { useCallback, useEffect, useState } from "react";
import type { Rule, RuleGroup, RuleTemplate } from "@mapping-assurance/core";
import { api } from "../api/client";

interface RuleTemplatesPanelProps {
  ruleGroups: RuleGroup[];
  selectedGroupId: string | null;
  selectedRuleId: string | null;
  sourceSelected: string | null;
  targetSelected: string | null;
  onApplyRule: (groupId: string, rule: Rule) => void;
  onToast: (message: string) => void;
  onError: (message: string) => void;
}

export function RuleTemplatesPanel({
  ruleGroups,
  selectedGroupId,
  selectedRuleId,
  sourceSelected,
  targetSelected,
  onApplyRule,
  onToast,
  onError,
}: RuleTemplatesPanelProps) {
  const [templates, setTemplates] = useState<RuleTemplate[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedGroup =
    ruleGroups.find((g) => g.id === selectedGroupId) ?? null;
  const selectedRule =
    selectedGroup?.rules.find((r) => r.id === selectedRuleId) ?? null;

  const refresh = useCallback(async () => {
    try {
      const data = await api.listTemplates();
      setTemplates(data.templates);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load templates");
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function saveTemplate() {
    if (!selectedRule) {
      onError("Select a rule to save as a template.");
      return;
    }
    if (!name.trim()) {
      onError("Template name is required.");
      return;
    }
    setBusy(true);
    try {
      await api.createTemplate({
        name: name.trim(),
        description: description.trim() || undefined,
        rule: selectedRule,
        suggestedExecutionMode: selectedGroup?.executionMode,
      });
      setName("");
      setDescription("");
      await refresh();
      onToast("Template saved");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Save template failed");
    } finally {
      setBusy(false);
    }
  }

  async function applyTemplate(id: string) {
    const sourceNode =
      sourceSelected ?? selectedGroup?.sourceNode ?? undefined;
    const destinationNode = targetSelected ?? undefined;
    if (!sourceNode || !destinationNode) {
      onError(
        "Select source and target tree nodes (or a group with sourceNode) before applying a template.",
      );
      return;
    }
    if (!selectedGroupId) {
      onError("Select a rule group to receive the instantiated rule.");
      return;
    }
    setBusy(true);
    try {
      const data = await api.instantiateTemplate(id, {
        sourceNode,
        destinationNode,
      });
      onApplyRule(selectedGroupId, data.rule);
      onToast("Template applied as new rule");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Apply template failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeTemplate(id: string) {
    setBusy(true);
    try {
      await api.deleteTemplate(id);
      await refresh();
      onToast("Template deleted");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Delete template failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" data-testid="rule-templates">
      <div className="panel-header">
        <h2>Rule Templates</h2>
      </div>
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Save portable routing patterns (relative child paths + conditions).
        Project-specific source/destination nodes are supplied when you apply a
        template.
      </p>

      <div className="inline-form" style={{ maxWidth: "28rem" }}>
        <label className="label" htmlFor="tpl-name">
          Save selected rule as template
        </label>
        <input
          id="tpl-name"
          className="field"
          placeholder="Template name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="field"
          placeholder="Description (optional)"
          aria-label="Template description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          disabled={busy || !selectedRule}
          onClick={() => void saveTemplate()}
        >
          Save template
        </button>
      </div>

      <h2>Saved templates</h2>
      {templates.length === 0 ? (
        <p className="muted">No templates yet.</p>
      ) : (
        <div className="project-list">
          {templates.map((t) => (
            <div key={t.id} className="project-item" style={{ cursor: "default" }}>
              <div>
                <div>{t.name}</div>
                <div className="muted" style={{ fontSize: "0.75rem" }}>
                  {t.kind} · {t.childMappings.length} children
                  {t.description ? ` · ${t.description}` : ""}
                </div>
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void applyTemplate(t.id)}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => void removeTemplate(t.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
