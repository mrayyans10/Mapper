import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createMapping,
  parseJsonDocument,
  type FieldMapping,
  type MappingProject,
  type MappingStatus,
  type SchemaTree,
  type ValidationReport,
} from "@mapping-assurance/core";
import { api } from "./api/client";
import { JsonInputPanel } from "./components/JsonInputPanel";
import { MappingPanel } from "./components/MappingPanel";
import { SchemaTreeView } from "./components/SchemaTreeView";
import { ValidationReportView } from "./components/ValidationReportView";

const SAMPLE_SOURCE = `{
  "customerId": "C-1001",
  "fullName": "Ada Lovelace",
  "email": "ada@example.com",
  "age": 36,
  "active": true,
  "address": {
    "city": "London",
    "zip": "EC1A"
  }
}`;

const SAMPLE_TARGET = `{
  "id": "C-1001",
  "name": "Ada Lovelace",
  "contactEmail": "ada@example.com",
  "years": 36,
  "isActive": true,
  "tier": "gold",
  "mailing": {
    "locality": "London",
    "postalCode": "EC1A"
  }
}`;

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [projects, setProjects] = useState<MappingProject[]>([]);
  const [project, setProject] = useState<MappingProject | null>(null);
  const [projectName, setProjectName] = useState("Customer mapping");
  const [sourceJson, setSourceJson] = useState(SAMPLE_SOURCE);
  const [targetJson, setTargetJson] = useState(SAMPLE_TARGET);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [sourceSchema, setSourceSchema] = useState<SchemaTree | null>(null);
  const [targetSchema, setTargetSchema] = useState<SchemaTree | null>(null);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [sourceSelected, setSourceSelected] = useState<string | null>(null);
  const [targetSelected, setTargetSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const data = await api.listProjects();
      setProjects(data.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  function validateLocalJson() {
    const src = parseJsonDocument(sourceJson);
    const tgt = parseJsonDocument(targetJson);
    setSourceError(src.ok ? null : src.error);
    setTargetError(tgt.ok ? null : tgt.error);
    return src.ok && tgt.ok;
  }

  async function inferTrees() {
    setError(null);
    if (!validateLocalJson()) return;
    setBusy(true);
    try {
      const requiredOverrides = {
        source: Object.fromEntries(
          Object.entries(sourceSchema?.nodes ?? {}).map(([p, n]) => [
            p,
            n.required,
          ]),
        ),
        target: Object.fromEntries(
          Object.entries(targetSchema?.nodes ?? {}).map(([p, n]) => [
            p,
            n.required,
          ]),
        ),
      };
      const data = await api.infer({
        sourceJson,
        targetJson,
        requiredOverrides,
      });
      setSourceSchema(data.sourceSchema);
      setTargetSchema(data.targetSchema);
      setSourceSelected(null);
      setTargetSelected(null);
      showToast("Schemas inferred");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Infer failed");
    } finally {
      setBusy(false);
    }
  }

  async function runValidation() {
    setError(null);
    if (!sourceSchema || !targetSchema) {
      setError("Infer schemas before validating.");
      return;
    }
    setBusy(true);
    try {
      if (project) {
        const data = await api.updateProject(project.id, {
          sourceJson,
          targetJson,
          mappings,
          requiredOverrides: {
            source: Object.fromEntries(
              Object.entries(sourceSchema.nodes).map(([p, n]) => [p, n.required]),
            ),
            target: Object.fromEntries(
              Object.entries(targetSchema.nodes).map(([p, n]) => [p, n.required]),
            ),
          },
          runValidation: true,
        });
        applyProject(data.project);
        showToast("Validation report generated");
      } else {
        const data = await api.validate({
          sourceSchema,
          targetSchema,
          mappings,
        });
        setReport(data.report);
        showToast("Validation report generated");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setBusy(false);
    }
  }

  function applyProject(p: MappingProject) {
    setProject(p);
    setProjectName(p.name);
    setSourceJson(p.sourceJson);
    setTargetJson(p.targetJson);
    setSourceSchema(p.sourceSchema);
    setTargetSchema(p.targetSchema);
    setMappings(p.mappings);
    setReport(p.validationReport);
    setSourceError(null);
    setTargetError(null);
  }

  async function saveProject() {
    setError(null);
    if (!validateLocalJson()) return;
    setBusy(true);
    try {
      let nextSourceSchema = sourceSchema;
      let nextTargetSchema = targetSchema;
      if (!nextSourceSchema || !nextTargetSchema) {
        const inferred = await api.infer({ sourceJson, targetJson });
        nextSourceSchema = inferred.sourceSchema;
        nextTargetSchema = inferred.targetSchema;
        setSourceSchema(nextSourceSchema);
        setTargetSchema(nextTargetSchema);
      }

      if (project) {
        const data = await api.updateProject(project.id, {
          name: projectName,
          sourceJson,
          targetJson,
          mappings,
          requiredOverrides: {
            source: Object.fromEntries(
              Object.entries(nextSourceSchema.nodes).map(([p, n]) => [
                p,
                n.required,
              ]),
            ),
            target: Object.fromEntries(
              Object.entries(nextTargetSchema.nodes).map(([p, n]) => [
                p,
                n.required,
              ]),
            ),
          },
          runValidation: true,
        });
        applyProject(data.project);
        showToast("Project saved");
      } else {
        const created = await api.createProject({
          name: projectName,
          sourceJson,
          targetJson,
        });
        const updated = await api.updateProject(created.project.id, {
          mappings,
          requiredOverrides: {
            target: Object.fromEntries(
              Object.entries(nextTargetSchema.nodes).map(([p, n]) => [
                p,
                n.required,
              ]),
            ),
          },
          runValidation: true,
        });
        applyProject(updated.project);
        showToast("Project created");
      }
      await refreshProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadProject(id: string) {
    setBusy(true);
    setError(null);
    try {
      const data = await api.getProject(id);
      applyProject(data.project);
      showToast(`Loaded ${data.project.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeProject(id: string) {
    setBusy(true);
    try {
      await api.deleteProject(id);
      if (project?.id === id) {
        setProject(null);
      }
      await refreshProjects();
      showToast("Project deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  function onCreateMapping(input: {
    transformationNote?: string;
    rationale?: string;
    status: MappingStatus;
  }) {
    if (!sourceSelected || !targetSelected) return;
    const mapping = createMapping({
      sourcePath: sourceSelected,
      targetPath: targetSelected,
      ...input,
    });
    setMappings((prev) => [...prev, mapping]);
    setReport(null);
  }

  function onDeleteMapping(id: string) {
    setMappings((prev) => prev.filter((m) => m.id !== id));
    setReport(null);
  }

  function onUpdateMapping(
    id: string,
    patch: Partial<Omit<FieldMapping, "id">>,
  ) {
    setMappings((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  }

  function toggleRequired(path: string, required: boolean) {
    setTargetSchema((prev) => {
      if (!prev) return prev;
      const node = prev.nodes[path];
      if (!node) return prev;
      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [path]: { ...node, required },
        },
      };
    });
    setReport(null);
  }

  async function exportFormat(format: string) {
    if (!project) {
      setError("Save the project before exporting.");
      return;
    }
    try {
      const res = await fetch(api.exportUrl(project.id, format));
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Export failed");
      }
      const text = await res.text();
      const mime = res.headers.get("content-type") ?? "text/plain";
      downloadText(`${project.name}-${format}`, text, mime);
      showToast(`Exported ${format}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  }

  const schemaRevision = useMemo(
    () =>
      `${sourceSchema ? Object.keys(sourceSchema.nodes).length : 0}-${
        targetSchema ? Object.keys(targetSchema.nodes).length : 0
      }-${project?.updatedAt ?? "local"}`,
    [sourceSchema, targetSchema, project?.updatedAt],
  );

  return (
    <div className="app-shell">
      <header className="brand-bar">
        <div>
          <h1>Mapping Assurance</h1>
          <p>
            Paste source and target JSON, map fields side by side, and generate a
            deterministic validation report. No transformation code — assurance
            only.
          </p>
        </div>
        <div className="toolbar">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void inferTrees()}
          >
            Infer schemas
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !sourceSchema || !targetSchema}
            onClick={() => void runValidation()}
          >
            Validate
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void saveProject()}
          >
            Save project
          </button>
        </div>
      </header>

      {error ? (
        <div className="error-text" style={{ marginBottom: "0.75rem" }}>
          {error}
        </div>
      ) : null}

      <div className="panel-grid">
        <JsonInputPanel
          title="Source JSON"
          value={sourceJson}
          error={sourceError}
          onChange={(v) => {
            setSourceJson(v);
            setSourceError(null);
          }}
        />
        <JsonInputPanel
          title="Target JSON"
          value={targetJson}
          error={targetError}
          onChange={(v) => {
            setTargetJson(v);
            setTargetError(null);
          }}
        />
      </div>

      <section className="panel" style={{ marginBottom: "1rem" }}>
        <div className="panel-header">
          <h2>Project</h2>
          <div className="toolbar">
            <button
              type="button"
              className="btn"
              disabled={!project}
              onClick={() => void exportFormat("mappings.json")}
            >
              Export mappings JSON
            </button>
            <button
              type="button"
              className="btn"
              disabled={!project}
              onClick={() => void exportFormat("report.json")}
            >
              Export report JSON
            </button>
            <button
              type="button"
              className="btn"
              disabled={!project}
              onClick={() => void exportFormat("report.md")}
            >
              Export Markdown
            </button>
            <button
              type="button"
              className="btn"
              disabled={!project}
              onClick={() => void exportFormat("mappings.csv")}
            >
              Export CSV
            </button>
          </div>
        </div>
        <div className="inline-form" style={{ maxWidth: "28rem" }}>
          <label className="label" htmlFor="project-name">
            Project name
          </label>
          <input
            id="project-name"
            className="field"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
          {project ? (
            <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
              Saved id: <span className="mono">{project.id}</span>
            </p>
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
              Unsaved working session — save to persist and export.
            </p>
          )}
        </div>

        <h2 style={{ marginTop: "0.75rem" }}>Saved projects</h2>
        {projects.length === 0 ? (
          <p className="muted">No saved projects yet.</p>
        ) : (
          <div className="project-list">
            {projects.map((p) => (
              <div
                key={p.id}
                className="project-item"
                style={{ cursor: "default" }}
              >
                <div>
                  <div>{p.name}</div>
                  <div className="muted" style={{ fontSize: "0.75rem" }}>
                    Updated {new Date(p.updatedAt).toLocaleString()} ·{" "}
                    {p.mappings.length} mappings
                  </div>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void loadProject(p.id)}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => void removeProject(p.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="workspace" key={schemaRevision}>
        <SchemaTreeView
          title="Source structure"
          schema={sourceSchema}
          selectedPath={sourceSelected}
          onSelect={setSourceSelected}
          side="source"
        />
        <MappingPanel
          mappings={mappings}
          sourceSelected={sourceSelected}
          targetSelected={targetSelected}
          onCreate={onCreateMapping}
          onDelete={onDeleteMapping}
          onUpdate={onUpdateMapping}
        />
        <SchemaTreeView
          title="Target structure"
          schema={targetSchema}
          selectedPath={targetSelected}
          onSelect={setTargetSelected}
          onToggleRequired={toggleRequired}
          side="target"
        />
      </div>

      <ValidationReportView report={report} />

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
