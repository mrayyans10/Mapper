# Step 1 — Rule Domain Finalization

**Status:** COMPLETE (interfaces + design only)  
**Approved decisions:** D1–D8 with amendments (2026-07-28)  
**Implementation gate:** UI unchanged. Rule Engine / validation rewrite / preview **not** implemented in this step.

---

## 1. Finalized TypeScript domain interfaces

Canonical source:

| File | Contents |
| --- | --- |
| `packages/core/src/rule/types.ts` | `RuleGroup`, `Rule`, `ChildMapping`, `ConditionExpr`, operators, evaluation/validation issue types |
| `packages/core/src/rule/paths.ts` | Relative vs absolute path contracts (D7) |
| `packages/core/src/rule/invariants.ts` | Named invariants INV-* |
| `packages/core/src/types.ts` | `MappingProject` with `schemaVersion`, `ruleGroups`, legacy `mappings` |

### Separation of concerns (approved extra #2)

| Concept | Representation |
| --- | --- |
| **Routing scope** | `RuleGroup { sourceNode, executionMode, rules[] }` |
| **Routing Rule** | `Rule` with `category: "routing"`, optional `condition`, may own `childMappings` |
| **Child field mappings** | `ChildMapping[]` **owned by** a routing Rule (relative paths) |
| **Ordinary unconditional direct mapping** | `Rule` with `category: "direct"`, `kind: "unconditional"`, empty `childMappings` (includes migrated v1) |

### Key approved semantics

| ID | Decision |
| --- | --- |
| D1 | Lower `priority` number wins |
| D2 | Each `FieldMapping` → one unconditional **legacy** `direct` Rule + **its own** `RuleGroup` (no auto-grouping); `migrationSource: "FIELD_MAPPING_V1"` |
| D3 | Migrated groups use `executionMode: "all-match"` |
| D4 | Paths with `[*]`: evaluate conditions **per source array element** |
| D5 | OpenAPI out of scope this tranche |
| D6 | In `first-match`, **at most one enabled fallback** per `RuleGroup`; multiples = validation **error** and must **not** execute; fallback only if no normal rule matched |
| D7 | Child paths stored **relative** to Rule `sourceNode` / `destinationNode`; absolute derived for validate/preview/export |
| D8 | Rationale/metadata/status on Rules; defer Knowledge Repository & Impact Analysis |

---

## 2. Database migration design (rollback-safe)

### Principles

1. **Additive only** in this tranche — never drop `mappings` in v2.
2. **Dual-write** after document migration: keep `mappings` JSON synchronized with legacy direct rules until a future v3 retirement.
3. **Migrate-on-read** is allowed for API responses; **persist** migrated shape on next successful save (or explicit migrate endpoint).
4. **Rollback:** deploying old code still reads `mappings`; new columns are ignored. New code treats missing columns as v1.

### Target DDL (applied via idempotent `ALTER` helpers)

```sql
-- Existing
-- projects(id, name, source_json, target_json, source_schema, target_schema,
--          mappings, validation_report, created_at, updated_at)

ALTER TABLE projects ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN rule_groups TEXT NOT NULL DEFAULT '[]';
```

SQLite note: use “try add column / ignore duplicate column” pattern in `ensureProjectSchema(db)` so both fresh and legacy files work.

### Column semantics

| Column | Role |
| --- | --- |
| `mappings` | Legacy `FieldMapping[]` — **retained** for rollback + dual-write |
| `schema_version` | `1` or `2` |
| `rule_groups` | JSON `RuleGroup[]` — canonical when `schema_version = 2` |

### Document migration algorithm (`migrateProjectV1toV2`)

**Input:** v1 project (`schemaVersion` missing or `1`, `mappings: FieldMapping[]`).

**Output:** v2 project:

For **each** `FieldMapping` `m` (stable order = array order):

1. Create `RuleGroup`:
   - `id`: derived stable id, e.g. `rg_legacy_${m.id}`
   - `name`: optional `Legacy: ${m.sourcePath}`
   - `sourceNode`: `m.sourcePath` *(no parent guessing — D2)*
   - `executionMode`: `"all-match"` *(D3)*
   - `rules`: single Rule below
2. Create `Rule`:
   - `id`: `m.id` (preserve)
   - `name`: `${m.sourcePath} → ${m.targetPath}`
   - `category`: `"direct"`
   - `sourceNode`: `m.sourcePath`
   - `destinationNode`: `m.targetPath`
   - `kind`: `"unconditional"`
   - `condition`: omitted
   - `priority`: `index + 1` (1-based, lower wins)
   - `enabled`: `true`
   - `childMappings`: `[]`
   - `migrationSource`: `"FIELD_MAPPING_V1"`
   - `rationale`: `m.rationale`
   - `status`: `m.status`
   - `metadata`: `{ transformationNote: m.transformationNote }` when present
3. Set `schemaVersion = 2`, `ruleGroups = [...]`, **keep** original `mappings` array unchanged.

**Non-goals of migration:** consolidating multiple leaf mappings under one parent routing Rule (manual later).

### Rollback strategy

| Scenario | Behavior |
| --- | --- |
| Roll back app to v1 binary | Reads `mappings`; ignores `schema_version` / `rule_groups` |
| Roll forward again | Sees `schema_version=2` + `rule_groups`; uses canonical rules |
| Corrupt `rule_groups` JSON | Fall back to re-run migrate from `mappings` if `mappings` present; emit error otherwise |
| Future v3 | Separate ADR to drop `mappings` only after dual-write period |

### API behavior (next implementation tranche — not UI)

- `GET` project: if `schema_version < 2`, run in-memory migrate for response; optionally persist.
- `PUT` with only `mappings`: convert to ruleGroups via same algorithm when saving as v2.
- Do **not** change React screens until Rule Engine + migration unit tests exist.

---

## 3. Invariants

Executable list: `packages/core/src/rule/invariants.ts` (`RULE_INVARIANTS`).

### Group / identity

- **INV-G1** Rule.sourceNode === RuleGroup.sourceNode  
- **INV-G2** Rule ids unique within group  
- **INV-G3** Rule ids unique project-wide  
- **INV-G4** ChildMapping ids unique within Rule  

### Rule shape

- **INV-R1** `direct` ⇒ unconditional, no condition, no children  
- **INV-R2** `conditional` ⇒ condition present & well-formed  
- **INV-R3** unconditional/fallback ⇒ no condition  
- **INV-R4** fallback ⇒ `routing`  
- **INV-R5** `FIELD_MAPPING_V1` ⇒ `direct`  
- **INV-R6** stored child paths are relative (must not start with `$.`)  
- **INV-R7** priority finite; lower wins  

### Execution (D4 / D6)

- **INV-E1** `first-match`: ≤1 enabled fallback per group; else validation error; do not execute fallbacks when invalid  
- **INV-E2** fallback runs only if no non-fallback rule matched  
- **INV-E3** `all-match`: all matching non-fallback rules; fallback only if none matched  

### Migration

- **INV-M1** one RuleGroup per FieldMapping (no auto-group)  
- **INV-M2** preserve metadata + `migrationSource`  
- **INV-M3** migrated groups are `all-match`  

---

## 4. Unit-test plan (before UI)

Tests live under `packages/core` (Vitest). Implement with Rule Engine / migration code in the **next** coding step.

### 4.1 Migration (`migration/v1-to-v2.test.ts`)

| # | Case |
| --- | --- |
| M1 | Empty mappings → `ruleGroups: []`, version 2 |
| M2 | Single FieldMapping → one group, one direct rule, `migrationSource` set |
| M3 | N mappings → N groups (no merging by parent path) |
| M4 | Preserves id, status, rationale, transformationNote→metadata |
| M5 | Priority equals stable order (1..N) |
| M6 | All groups `executionMode: "all-match"` |
| M7 | Idempotent: migrating v2 project is no-op |
| M8 | Round-trip: v2 direct legacy rules still dual-write compatible with original mappings array |

### 4.2 Path join (D7) (`rule/paths.test.ts`)

| # | Case |
| --- | --- |
| P1 | `$.customer` + `type` → `$.customer.type` |
| P2 | `$.items[*]` + `sku` → `$.items[*].sku` |
| P3 | Empty relative → node path unchanged |
| P4 | Reject/normalize illegal stored absolute child paths in invariant checks |

### 4.3 Condition evaluation (`rule/condition-eval.test.ts`)

| # | Case |
| --- | --- |
| C1 | Each operator: `== != > >= < <= IN NOT_IN EXISTS NOT_EXISTS CONTAINS STARTS_WITH ENDS_WITH MATCHES_REGEX` |
| C2 | AND / OR / NOT nesting |
| C3 | Missing path + EXISTS/NOT_EXISTS |
| C4 | Type coercion policy documented + tested (recommend: no cross-type `>` ; `==` strict) |
| C5 | Invalid regex → evaluation error surfaced to validation, not throw across engine boundary |

### 4.4 Rule Engine selection (`rule/engine.test.ts`)

| # | Case |
| --- | --- |
| E1 | `first-match`: first matching conditional by priority wins; later skipped |
| E2 | `first-match`: no match → single enabled fallback runs |
| E3 | `first-match`: two enabled fallbacks → validation error path; engine executes **no** fallback (D6) |
| E4 | `all-match`: multiple conditionals can match; all returned |
| E5 | `all-match`: zero conditional matches → fallback if present |
| E6 | Disabled rules never match |
| E7 | Unconditional routing rule matches when reached |
| E8 | Direct legacy rules in all-match all apply |
| E9 | **D4:** `sourceNode` / condition paths with `[*]` evaluate **per array element**; matches carry `arrayIndex` |
| E10 | Priority tie-break: lower priority number first; equal priority → list order |

### 4.5 Invariant validation (`validation/rule-invariants.test.ts`)

| # | Case |
| --- | --- |
| I1–I_n | One test per INV-* that constructs a violating fixture and expects the matching `RuleValidationIssue.type` |

### 4.6 Fixtures to add (data only)

| Fixture | Purpose |
| --- | --- |
| `fixtures/rules/orders-priority.json` | amount > 1000 → PriorityOrders |
| `fixtures/rules/employees-canada.json` | country == Canada |
| `fixtures/rules/array-product-type.json` | `[*]` + productType == P |
| `fixtures/rules/fallback-first-match.json` | fallback + D6 multi-fallback error case |
| `fixtures/rules/legacy-v1-project.json` | sample v1 `mappings` for migration tests |

---

## 5. Explicitly deferred (not in Step 1)

- Rule Engine runtime implementation  
- Validation engine rewrite  
- Preview engine  
- UI Rule editor / condition builder  
- OpenAPI  
- Knowledge Repository / Impact Analysis modules  

---

## 6. Next step after Step 1 acceptance

**Step 2 (implementation, still no UI):**

1. `joinPath` / path utilities  
2. `migrateProjectV1toV2` + tests  
3. Condition evaluator + Rule Engine selector + tests  
4. Idempotent DB `ensureProjectSchema` + dual-write persistence  
5. Only then begin UI against stable APIs  

---

## 7. Sign-off checkpoint

Step 1 delivers design + TypeScript interfaces only. Confirm to proceed to Step 2 (engine + migration implementation, still no UI).
