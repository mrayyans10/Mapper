# Mapping Assurance — Rule Platform Architecture Approval

**Status:** APPROVED WITH CHANGES (2026-07-28)  
**Implementation status:** Step 1 complete — domain interfaces + DB/invariant/test design only. No UI changes. No Rule Engine runtime yet.

**Canonical follow-up:** [`STEP1_RULE_DOMAIN_DESIGN.md`](./STEP1_RULE_DOMAIN_DESIGN.md)

---

## How approval was recorded

Requestor approved D1–D8 with amendments and four extra architectural requirements.  
One-click message equivalent:

```text
Architecture approved with changes to D2, D6, D7 + RuleGroup per-source execution mode.
```

---

## Final decisions

| ID | Outcome |
| --- | --- |
| **D1** | **Approved.** Lower priority number wins. |
| **D2** | **Changed.** Each `FieldMapping` → unconditional **legacy** Rule (`category: "direct"`) with `migrationSource: "FIELD_MAPPING_V1"`, preserving metadata. **No automatic grouping** into parent Rules — one RuleGroup per migrated mapping. |
| **D3** | **Approved.** Migrated groups use `all-match`. |
| **D4** | **Approved.** For `[*]` source paths, evaluate conditions **per array element**. |
| **D5** | **Approved.** OpenAPI out of scope this tranche. |
| **D6** | **Changed.** In `first-match`, **at most one enabled fallback** per source routing group. Multiple enabled fallbacks = **validation error** and must **not** execute. Fallback only when no normal Rule matches. |
| **D7** | **Changed.** Child mapping paths stored **relative** to Rule `sourceNode` / `destinationNode`. Absolute paths derived for validation, preview, export. |
| **D8** | **Approved.** Keep rationale/metadata/status on Rules; defer Knowledge Repository & Impact Analysis. |

### Extra requirements (approved)

1. **`RuleGroup`** model: `sourceNode` + `executionMode` + ordered `Rules` (mode per source context, not only global).  
2. Clear separation: routing Rules vs child mappings vs ordinary unconditional direct mappings.  
3. Preserve projects via **tested migration** and **rollback-safe** DB changes.  
4. Implement **domain models → migration → unit-tested Rule Engine before UI**.

---

## Step 1 deliverables

- [x] TypeScript domain interfaces (`packages/core/src/rule/*`, updated `MappingProject`)  
- [x] Database migration design (additive columns, dual-write, rollback)  
- [x] Invariants (`RULE_INVARIANTS`)  
- [x] Unit-test plan (migration, paths, conditions, engine, invariants)  

**Not started:** UI, Rule Engine runtime, Preview Engine.

---

## Sign-off

| Role | Outcome | Date |
| --- | --- | --- |
| Product / Requestor | Approved with changes (D2, D6, D7 + extras) | 2026-07-28 |
| Architecture | Recorded in repo | 2026-07-28 |
