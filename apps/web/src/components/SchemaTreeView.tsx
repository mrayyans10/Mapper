import { useEffect, useMemo, useState } from "react";
import type { SchemaNode, SchemaTree } from "@mapping-assurance/core";

interface SchemaTreeViewProps {
  title: string;
  schema: SchemaTree | null;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onToggleRequired?: (path: string, required: boolean) => void;
  side: "source" | "target";
}

function TypePill({ type }: { type: SchemaNode["type"] }) {
  return <span className={`type-pill ${type}`}>{type}</span>;
}

function TreeNodeRow({
  node,
  schema,
  depth,
  selectedPath,
  expanded,
  onToggleExpand,
  onSelect,
  onToggleRequired,
  showRequiredToggle,
}: {
  node: SchemaNode;
  schema: SchemaTree;
  depth: number;
  selectedPath: string | null;
  expanded: Set<string>;
  onToggleExpand: (path: string) => void;
  onSelect: (path: string) => void;
  onToggleRequired?: (path: string, required: boolean) => void;
  showRequiredToggle: boolean;
}) {
  const hasChildren = node.childPaths.length > 0;
  const isExpanded = expanded.has(node.path);
  const isSelected = selectedPath === node.path;

  return (
    <div className="tree-node" style={{ marginLeft: depth === 0 ? 0 : undefined }}>
      <button
        type="button"
        className={`tree-row ${isSelected ? "selected" : ""} ${node.required ? "required" : ""}`}
        onClick={() => onSelect(node.path)}
        title={node.path}
        data-testid={`tree-node-${node.path}`}
      >
        <span
          className="twisty"
          onClick={(e) => {
            if (!hasChildren) return;
            e.stopPropagation();
            onToggleExpand(node.path);
          }}
        >
          {hasChildren ? (isExpanded ? "▾" : "▸") : "·"}
        </span>
        <span className="name">{node.name}</span>
        <TypePill type={node.type} />
        {showRequiredToggle && onToggleRequired && node.path !== "$" ? (
          <label
            className="muted"
            style={{ marginLeft: "0.25rem", fontSize: "0.7rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={node.required}
              data-testid={`required-${node.path}`}
              onChange={(e) => onToggleRequired(node.path, e.target.checked)}
            />{" "}
            req
          </label>
        ) : null}
        <span className="path-hint">{node.path}</span>
      </button>
      {hasChildren && isExpanded ? (
        <div className="tree-children">
          {node.childPaths.map((childPath) => {
            const child = schema.nodes[childPath];
            if (!child) return null;
            return (
              <TreeNodeRow
                key={childPath}
                node={child}
                schema={schema}
                depth={depth + 1}
                selectedPath={selectedPath}
                expanded={expanded}
                onToggleExpand={onToggleExpand}
                onSelect={onSelect}
                onToggleRequired={onToggleRequired}
                showRequiredToggle={showRequiredToggle}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function SchemaTreeView({
  title,
  schema,
  selectedPath,
  onSelect,
  onToggleRequired,
  side,
}: SchemaTreeViewProps) {
  const root = schema?.nodes[schema.rootPath];
  const initialExpanded = useMemo(() => {
    const set = new Set<string>();
    if (schema) {
      for (const node of Object.values(schema.nodes)) {
        if (node.type === "object" || node.type === "array") {
          set.add(node.path);
        }
      }
    }
    return set;
  }, [schema]);

  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);

  useEffect(() => {
    setExpanded(initialExpanded);
  }, [initialExpanded]);

  function toggleExpand(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        <span className="muted" style={{ fontSize: "0.75rem" }}>
          {side === "target" ? "Mark required fields as needed" : "Select a field to map"}
        </span>
      </div>
      {!schema || !root ? (
        <p className="muted">Infer a schema to view the tree.</p>
      ) : (
        <div className="tree">
          <TreeNodeRow
            node={root}
            schema={schema}
            depth={0}
            selectedPath={selectedPath}
            expanded={expanded}
            onToggleExpand={toggleExpand}
            onSelect={onSelect}
            onToggleRequired={onToggleRequired}
            showRequiredToggle={side === "target"}
          />
        </div>
      )}
    </section>
  );
}
