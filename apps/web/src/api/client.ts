import type {
  ChildMapping,
  ConditionAtom,
  ConditionExpr,
  ConditionOperator,
  ExecutionMode,
  FieldMapping,
  MappingProject,
  PreviewReport,
  Rule,
  RuleCopyMode,
  RuleGroup,
  RuleKind,
  RuleSimulationResult,
  RuleTemplate,
  SchemaTree,
  ValidationReport,
} from "@mapping-assurance/core";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    });
  } catch {
    throw new Error(
      "Cannot reach the Mapping Assurance API. Run `npm run dev` from the repo root (API on :3001, UI on :5173).",
    );
  }
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body.error === "string") message = body.error;
      else if (body.error) message = JSON.stringify(body.error);
    } catch {
      if (
        response.status >= 500 &&
        (!text || /internal server error|ECONNREFUSED|proxy/i.test(text))
      ) {
        message =
          "API returned 500 (often means the API is not running). From the repo root run `npm run dev`, then open http://127.0.0.1:5173 and check http://127.0.0.1:3001/api/health.";
      } else if (text.trim()) {
        message = text.trim().slice(0, 300);
      }
    }
    throw new Error(message);
  }

  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  listProjects: () =>
    request<{ projects: MappingProject[] }>("/api/projects"),

  getProject: (id: string) =>
    request<{ project: MappingProject }>(`/api/projects/${id}`),

  createProject: (body: {
    name: string;
    sourceJson: string;
    targetJson: string;
  }) =>
    request<{ project: MappingProject }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateProject: (
    id: string,
    body: {
      name?: string;
      sourceJson?: string;
      targetJson?: string;
      mappings?: FieldMapping[];
      ruleGroups?: RuleGroup[];
      requiredOverrides?: {
        source?: Record<string, boolean>;
        target?: Record<string, boolean>;
      };
      runValidation?: boolean;
    },
  ) =>
    request<{ project: MappingProject }>(`/api/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  validateProject: (id: string) =>
    request<{ project: MappingProject; report: ValidationReport }>(
      `/api/projects/${id}/validate`,
      { method: "POST", body: "{}" },
    ),

  previewProject: (id: string, body?: { targetJson?: string }) =>
    request<{ preview: PreviewReport }>(`/api/projects/${id}/preview`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  deleteProject: (id: string) =>
    request<void>(`/api/projects/${id}`, { method: "DELETE" }),

  infer: (body: {
    sourceJson: string;
    targetJson: string;
    requiredOverrides?: {
      source?: Record<string, boolean>;
      target?: Record<string, boolean>;
    };
  }) =>
    request<{ sourceSchema: SchemaTree; targetSchema: SchemaTree }>(
      "/api/infer",
      { method: "POST", body: JSON.stringify(body) },
    ),

  validate: (body: {
    sourceSchema: SchemaTree;
    targetSchema: SchemaTree;
    mappings?: FieldMapping[];
    ruleGroups?: RuleGroup[];
  }) =>
    request<{ report: ValidationReport }>("/api/validate", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  preview: (body: {
    sourceJson: string;
    targetJson?: string;
    ruleGroups: RuleGroup[];
  }) =>
    request<{ preview: PreviewReport }>("/api/preview", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  simulate: (body: {
    rule: Rule;
    ruleGroup: {
      id: string;
      sourceNode: string;
      executionMode: ExecutionMode;
    };
    sampleJson?: string;
    sampleDocument?: unknown;
  }) =>
    request<{ simulation: RuleSimulationResult }>("/api/simulate", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listTemplates: () =>
    request<{ templates: RuleTemplate[] }>("/api/templates"),

  createTemplate: (body: {
    name: string;
    description?: string;
    rule?: Rule;
    template?: RuleTemplate;
    suggestedExecutionMode?: ExecutionMode;
  }) =>
    request<RuleTemplate>("/api/templates", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  instantiateTemplate: (
    id: string,
    body: {
      sourceNode: string;
      destinationNode: string;
      name?: string;
      priority?: number;
    },
  ) =>
    request<{ rule: Rule }>(`/api/templates/${id}/instantiate`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteTemplate: (id: string) =>
    request<void>(`/api/templates/${id}`, { method: "DELETE" }),

  exportUrl: (id: string, format: string) =>
    `/api/projects/${id}/export/${format}`,
};

export type {
  ChildMapping,
  ConditionAtom,
  ConditionExpr,
  ConditionOperator,
  ExecutionMode,
  Rule,
  RuleCopyMode,
  RuleGroup,
  RuleKind,
};
