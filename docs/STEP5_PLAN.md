# Step 5 Plan — Rule Authoring Stability

**Status:** PENDING APPROVAL (plan only — no implementation until approved)  
**Prerequisite:** Step 3 amendments + Step 4 UI (complete)  
**Out of scope:** AI suggestions, governance, transformation execution

---

## Goal

Make the rule-authoring workflow stable and usable for realistic nested-array projects: create/edit/reorder/enable rules, navigate from validation/preview back to the affected rule, reload/migrate safely, and export rule groups + validation + preview.

---

## 1. Proposed UI changes

### 1.1 Rule workbench refinement
- **Hierarchy view:** Always-visible expandable RuleGroup → Rules → Child mappings (not only when a group is selected).
- **Reorder:** Move up / move down for rules within a group; sync `priority` to list order (lower = higher precedence) after reorder. Optional: same for groups.
- **Enable/disable:** Keep checkbox; add clear disabled visual state (muted row + “disabled” badge).
- **Inline summary chips:** kind, priority, copy mode, child count, `migrationSource` badge for legacy direct rules.
- **Safer create flow:** Prefer selected tree paths; block Add Rule without destination with inline error; show defaults for copy mode.

### 1.2 Child mappings clarity
- Show relative paths **and** resolved absolute preview (`joinPathAware`) under each row.
- Mark transform type as **read-only metadata** label (“stored, not executed”) — keep editable type string but never execute.
- Empty-state copy that explains `ROUTE_ONLY` vs `APPLY_CHILD_MAPPINGS`.

### 1.3 Validation → navigation
- Make each `ruleIssue` clickable when `ruleId` / `ruleGroupId` present.
- On click: select group + rule in workbench, scroll editor into view, optionally highlight child row via `childMappingId`.
- Show `ruleGroupId` and `childMappingId` in the issue header (today only `ruleId` is shown).

### 1.4 Preview trace refinement
- Split UI into three sections: **Matched**, **Skipped**, **Materialization** (child_copy / direct_copy / route_only).
- Each row shows rule name/id, reason (`detail`), `arrayIndex` when present.
- Click matched/skipped row → navigate to that rule (same as validation).
- Keep transformation warnings prominent and non-dismissible until next preview.

### 1.5 Export
- New export formats (API + UI buttons):
  - `rules.json` — `ruleGroups` (+ schemaVersion)
  - `preview.json` — last preview payload (client-side download of in-memory preview; not DB-persisted)
  - Improve `report.json` / `report.md` to include `ruleIssues` (scoped) when present
- Keep existing legacy mapping exports for backward compatibility.

### 1.6 Nested-array authoring aids (usability, not new engine)
- Sample fixture button or docs link for `fixtures/array-mapping` / rules array examples.
- Hint when `sourceNode` contains `[*]`: “Preview evaluates per element; target arrays append.”

---

## 2. Accessibility and error-state handling

| Area | Plan |
| --- | --- |
| Keyboard | Rule list and issue/trace rows focusable (`button`/`tabIndex`); Enter/Space activates navigation |
| Labels | Associate all inputs with visible `<label>`; announce selected rule via `aria-current` |
| Errors | Inline field errors for empty destination, invalid priority, relative path starting with `$.` |
| Empty states | Distinct empty copy for no groups / no rules / no children / no preview |
| Disabled rules | Not removed from list; visually muted; still selectable for edit |
| Toasts vs errors | Keep toast for success; persistent banner for save/validate/preview failures |
| Contrast | Reuse existing badges; ensure disabled text meets readable contrast on dark theme |

---

## 3. Persistence and backward-compatibility risks

| Risk | Mitigation |
| --- | --- |
| Reorder changes `priority` unexpectedly for migrated legacy rules | Only rewrite priorities within the edited group; preserve `migrationSource` and ids |
| Saving `ruleGroups` overwrites dual-write legacy `mappings` | Keep current dual-write: if only legacy groups, sync mappings from rules; if routing rules exist, do not destroy `mappings` array blindly — update docs |
| Export of preview implies persistence | Preview remains **response/session-only** (P4); export downloads current in-memory preview |
| Old clients expecting only `mappings` exports | Retain `mappings.json` / `mappings.csv`; add new formats without removing old ones |
| Reload loses UI selection | After load, optionally auto-select first group; document that selection is session state |
| Migration on read still not persisted until save | Add Playwright: open v1-shaped project → UI shows migrated rules → Save → reload still v2 |
| Nested AND/OR condition UI still MVP (atom only) | Keep atom editor; advanced compounds remain API/core — call out in UI as “atom MVP” |

---

## 4. Additional Playwright scenarios

Beyond current legacy smoke:

1. **Create rule group + conditional rule + child mapping** → Validate → issue list visible.
2. **Enable/disable rule** → Preview shows skip reason for disabled.
3. **Reorder rules (move up)** → priorities update → first-match preview outcome changes.
4. **Click validation issue** → selected rule in workbench matches `ruleId`.
5. **Nested array fixture** (`items[*]` → target array) → Preview result has **two** appended elements (not index 0 overwrite).
6. **Reload migration:** seed/create v1 mappings-only project (or fixture via API) → Open → ruleGroups present with `FIELD_MAPPING_V1` → Save → reopen still v2.
7. **Export:** download/fetch `rules.json` and `report.json` contain `ruleGroups` / `ruleIssues`; preview export works from UI session.
8. **Transformation warning:** child with transform type → Preview shows NOT executed warning; result still structural copy.

---

## 5. Definition of done

Step 5 is done when **all** of the following are true:

1. User can create, edit, reorder, enable, and disable rules in the UI without console errors.
2. Rule groups and child mappings are visible in a clear hierarchy (expandable list or equivalent).
3. Clicking a validation issue with `ruleId` selects that rule (and group) in the workbench.
4. Preview UI clearly separates matched vs skipped (with reasons) and supports click-to-rule; array append behavior verified in e2e for ≥2 source elements.
5. Project reload shows persisted `ruleGroups`; migration path from legacy mappings is covered by Playwright regression.
6. Exports available for **rule groups**, **validation results** (including `ruleIssues`), and **preview output** (session download).
7. Transformations remain non-executable; UI labels them as stored metadata / warning on preview.
8. No AI features added.
9. Unit tests remain green; new Playwright scenarios in §4 pass.
10. Short `docs/STEP5_UI_STABILITY.md` records what shipped and residual limitations (e.g. atom-only condition builder).

---

## Delivery order (after plan approval)

1. Export API + core format updates  
2. Rule workbench hierarchy / reorder / a11y polish  
3. Validation & preview navigation  
4. Playwright scenarios (incl. nested array + migration reload)  
5. Docs + DoD checklist  

**Gate for later work:** Do not start AI mapping or governance until this DoD is met and nested-array authoring has been exercised via the new e2e scenarios.
