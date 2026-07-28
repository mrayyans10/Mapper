import type { FieldMapping, MappingStatus } from "@mapping-assurance/core";

interface MappingPanelProps {
  mappings: FieldMapping[];
  sourceSelected: string | null;
  targetSelected: string | null;
  onCreate: (input: {
    transformationNote?: string;
    rationale?: string;
    status: MappingStatus;
  }) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Omit<FieldMapping, "id">>) => void;
}

export function MappingPanel({
  mappings,
  sourceSelected,
  targetSelected,
  onCreate,
  onDelete,
  onUpdate,
}: MappingPanelProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Mappings</h2>
        <span className="muted" style={{ fontSize: "0.75rem" }}>
          {mappings.length} defined
        </span>
      </div>

      <div className="selection-bar">
        <span>
          Source:{" "}
          <strong className="mono">{sourceSelected ?? "—"}</strong>
        </span>
        <span>→</span>
        <span>
          Target:{" "}
          <strong className="mono">{targetSelected ?? "—"}</strong>
        </span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!sourceSelected || !targetSelected}
          onClick={() =>
            onCreate({
              status: "draft",
            })
          }
        >
          Add mapping
        </button>
      </div>

      {mappings.length === 0 ? (
        <p className="muted">
          Select one source field and one target field, then add a mapping.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="mapping-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Target</th>
                <th>Status</th>
                <th>Note</th>
                <th>Rationale</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.id}>
                  <td className="mono">{m.sourcePath}</td>
                  <td className="mono">{m.targetPath}</td>
                  <td>
                    <select
                      className="field"
                      style={{ minWidth: "7rem", padding: "0.35rem" }}
                      value={m.status}
                      onChange={(e) =>
                        onUpdate(m.id, {
                          status: e.target.value as MappingStatus,
                        })
                      }
                    >
                      <option value="draft">draft</option>
                      <option value="reviewed">reviewed</option>
                      <option value="approved">approved</option>
                    </select>
                  </td>
                  <td>
                    <input
                      className="field"
                      style={{ padding: "0.35rem" }}
                      value={m.transformationNote ?? ""}
                      placeholder="optional"
                      onChange={(e) =>
                        onUpdate(m.id, {
                          transformationNote: e.target.value || undefined,
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="field"
                      style={{ padding: "0.35rem" }}
                      value={m.rationale ?? ""}
                      placeholder="optional"
                      onChange={(e) =>
                        onUpdate(m.id, {
                          rationale: e.target.value || undefined,
                        })
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => onDelete(m.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
