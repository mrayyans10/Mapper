# Mapping Assurance — Rule Platform Architecture Approval

**Status:** PENDING APPROVAL  
**Date:** 2026-07-28  
**Author:** Architecture review (Cloud Agent)  
**Repo:** `mrayyans10/Mapper`  
**Branch for implementation (after approval):** `cursor/mapping-assurance-mvp-5c8e` (or a new `cursor/rule-platform-*` branch)

---

## How to approve

1. Read **Summary**, **Decisions**, and **Out of scope**.
2. Mark each decision in [Section D](#d-decisions-to-approve) as **Approve** or **Change** (edit the doc or comment on the PR).
3. Sign off in [Section G](#g-sign-off).
4. Reply on the PR / agent thread with: **`Architecture approved`** (optionally list any changed decisions).

**No implementation starts until Section G is signed (or an equivalent written approval is given).**

---

## A. Summary

### What exists today

Mapping Assurance is a JSON field-mapping MVP. The core object is:

```text
FieldMapping: Source Path → Target Path
```

Supported today: paste/upload sample JSON, infer schema trees, manual 1:1 mappings, validation, persistence (SQLite), export.

**Note:** OpenAPI loading is **not** present in the current codebase (JSON samples only). Treat OpenAPI as a later tranche unless Decision D5 says otherwise.

### What we are changing

The product becomes a **Rule-Based Mapping Assurance Platform**.

The core object becomes:

```text
Rule
  ├── source node
  ├── destination node
  ├── optional condition (AND / OR / NOT, nested)
  ├── priority + execution mode
  ├── fallback support
  └── child mappings (owned by the rule — not independent)
```

This must stay **generic for any JSON** (no telecom-specific fields in the engine).

### What we are not doing in this tranche

- Authentication / SSO / multi-tenant
- AI-assisted mapping
- Full Impact Analysis productization (stub only, if anything)
- Knowledge Repository as a separate product (rationale/metadata on Rule is enough)
- Generating transformation code (Java or otherwise)

---

## B. Findings (current architecture)

| Area | Finding |
| --- | --- |
| Domain | `FieldMapping { sourcePath, targetPath }` is the atomic unit |
| Project | `MappingProject.mappings: FieldMapping[]` |
| Validation | Path-coverage / datatype checks on flat mappings only |
| Persistence | SQLite `mappings TEXT` JSON blob; **no schema version** |
| API | Zod requires `sourcePath` + `targetPath` |
| UI | Select one source + one target → add row |
| Export | Source/Target columns in JSON/CSV/Markdown |
| Engines | Core package is already UI-independent (good foundation) |

**Conclusion:** Keep monorepo shell + schema inference. Replace the mapping aggregate with a **Rule aggregate**, migrate existing data, extend validation, add preview.

---

## C. Target architecture

### C1. Module map

| Module | Location | Role |
| --- | --- | --- |
| Schema Engine | `packages/core/schema` | Infer/maintain schema trees (existing) |
| Rule Engine | `packages/core/rule` | Conditions, priority, first/all-match, fallback (**new**, UI-independent) |
| Validation Engine | `packages/core/validation` | Rule + child-mapping assurance (evolve) |
| Preview Engine | `packages/core/preview` | Simulate sample JSON against rules (**new**) |
| Migration | `packages/core/migration` | v1 FieldMappings → v2 Rules |
| Persistence / API | `apps/api` | SQLite + REST; store `rule_set` + `schema_version` |
| UI | `apps/web` | Rule list/editor, condition builder, child mappings, preview |

```text
UI (React) → API (Express/SQLite) → Core engines (pure TypeScript)
                                      ├── Schema
                                      ├── Rule
                                      ├── Validation
                                      ├── Preview
                                      └── Migration
```

### C2. Rule model (proposed)

```text
RuleSet
  executionMode: first-match | all-match
  rules: Rule[]

Rule
  id, name
  sourceNode, destinationNode
  kind: unconditional | conditional | fallback
  condition?: ConditionExpr
  priority: number
  enabled: boolean
  childMappings: ChildMapping[]
  metadata?, rationale?, status

ConditionExpr = atom | AND | OR | NOT (nestable)

Condition operators:
  == != > >= < <=
  IN NOT_IN
  EXISTS NOT_EXISTS
  CONTAINS STARTS_WITH ENDS_WITH MATCHES_REGEX

ChildMapping (owned by Rule)
  sourcePath → targetPath
  note, rationale, status
```

### C3. Folder structure (additive)

```text
packages/core/src/
  schema/          # keep
  rule/            # NEW — types, condition-eval, engine
  validation/      # evolve for rules
  preview/         # NEW
  migration/       # NEW — v1 → v2
  mapping/         # legacy helpers + ChildMapping helpers
  export/          # update for rules
  types.ts         # MappingProject gains ruleSet + schemaVersion

apps/api/src/
  db/projects.ts   # schema_version + rule_set
  routes/...       # migrate-on-read; preview endpoint

apps/web/src/components/
  RuleList.tsx
  RuleEditor.tsx
  ConditionBuilder.tsx
  ChildMappingTable.tsx
  PreviewPanel.tsx
```

### C4. Migration strategy (backward compatibility)

| Step | Behavior |
| --- | --- |
| Detect | Missing `schemaVersion` ⇒ treat as **v1** |
| Transform | Each `FieldMapping` → one **unconditional** `Rule` |
| Preserve | id lineage, rationale, status, notes — no user data dropped |
| Persist | On next save, write **v2** (`ruleSet` + `schemaVersion: 2`) |
| Compat | Accept deprecated `mappings` on write for one release; convert server-side |

### C5. Delivery order (after approval)

1. Rule model + condition AST + migration + DB `schema_version`
2. Rule Engine (unit tests first)
3. Validation rewrite for rules
4. Preview Engine
5. API updates
6. UI (rule editor, child mappings, preview)
7. Export + e2e

---

## D. Decisions to approve

Edit the **Decision** column to `Approve` or `Change: <your preference>`.

| ID | Topic | Proposal | Decision |
| --- | --- | --- | --- |
| **D1** | Priority order | **Lower number wins** (priority `1` before `10`) | ☐ Approve / ☐ Change: ___ |
| **D2** | Migrated leaf mappings | Unconditional rule with `sourceNode`/`destinationNode` set to the old paths; **`childMappings: []`** | ☐ Approve / ☐ Change: ___ |
| **D3** | Migrated execution mode | **`all-match`** so every migrated unconditional rule still applies | ☐ Approve / ☐ Change: ___ |
| **D4** | Array conditions (MVP) | In preview, evaluate **per array element** context for `[*]` paths | ☐ Approve / ☐ Change: ___ |
| **D5** | OpenAPI | **Out of scope** for this refactor tranche (JSON samples only) | ☐ Approve / ☐ Change: ___ |
| **D6** | Fallback cardinality | Allow multiple fallbacks in model; **validation warns** if >1 enabled fallback | ☐ Approve / ☐ Change: ___ |
| **D7** | Child path storage (MVP) | Store **absolute** JSONPath-style paths; UI may display relative to rule nodes | ☐ Approve / ☐ Change: ___ |
| **D8** | Knowledge / Impact modules | Defer full Knowledge Repository & Impact Analysis; keep `rationale`/`metadata` on Rule; Impact stub optional later | ☐ Approve / ☐ Change: ___ |

### Recommended default (if you want one-click approval)

Approve **D1–D8 as proposed**.

Reply with:

```text
Architecture approved — accept D1–D8 as proposed.
```

---

## E. Validation & preview (scope of engines)

### Validation issues must include

`severity`, `type`, `ruleId` (when applicable), `message`, `recommendedFix`

### Validation must cover

- invalid conditions  
- duplicate / conflicting / overlapping / unreachable rules  
- missing fallback (when configured as required)  
- datatype / cardinality / array mismatch (child mappings)  
- required fields, duplicate child mappings  
- structurally unreachable mappings, unused mappings  

### Preview must show

- which rules matched / skipped  
- destination(s)  
- resulting object  
- whether fallback ran  

---

## F. Explicit non-goals (this approval)

- Not a transformation code generator  
- Not telecom-specific  
- Not AI mapping (yet)  
- Not rewriting the entire UI from scratch before engines exist  
- Not breaking existing saved projects (migration required)  

---

## G. Sign-off

| Role | Name | Date | Outcome |
| --- | --- | --- | --- |
| Product / Requestor | | | ☐ Approved ☐ Approved with changes ☐ Rejected |
| Architecture | | | ☐ Approved ☐ Approved with changes ☐ Rejected |

**Approved with changes — list deltas:**

```text
(e.g. D3 = first-match instead of all-match)
```

**Implementation gate:**  
Coding of the Rule Engine begins only after this document is approved (Section G or equivalent chat/PR approval).

---

## H. Quick reference examples (generic)

These illustrate the model only; the engine must not hardcode them.

```text
Orders     WHEN amount > 1000              → PriorityOrders
Employees  WHEN country == "Canada"        → CanadianEmployees
Items[*]   WHEN productType == "P"         → PrimaryProducts
customer   WHEN customer.type == "Business"→ CorporateCustomer
```

Each is a **Rule**; field copies under that route are **child mappings** owned by the rule.

---

## I. Next step after approval

1. Freeze decisions D1–D8 (as approved).  
2. Implement incrementally starting with **Rule model + migration + Rule Engine**.  
3. Do **not** ship UI-only changes before core engines and migration tests exist.
