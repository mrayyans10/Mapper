# Step 5 — Rule Authoring Stability (shipped)

**Status:** COMPLETE  
**Branch work:** Rule workbench polish, validation/preview navigation, exports, Rule Simulator, Rule Templates

---

## What shipped

### Rule workbench
- Always-visible hierarchy: RuleGroup → Rules → child mapping summaries
- Reorder (↑/↓) for groups and rules; rule reorder rewrites `priority` to list order (lower = higher precedence)
- Disabled rules stay selectable with muted styling + `disabled` badge
- Summary chips: kind, priority, copy mode, child count, legacy `FIELD_MAPPING_V1`
- Child rows show relative paths + resolved absolute preview via `joinPathAware`
- Transform type labeled **stored, not executed**
- Destination empty-state inline error; `[*]` array authoring hint
- Keyboard-focusable rule rows (`aria-current` on selection)

### Validation → rule navigation
- Clickable `ruleIssues` when `ruleId` / `ruleGroupId` present
- Shows `ruleGroupId` and `childMappingId` in issue header
- Navigates workbench selection + optional child highlight + scroll

### Preview refinement
- Sections: **Matched**, **Skipped**, **Materialization**
- Click-to-rule on matched/skipped/materialization rows
- Session-only preview; **Export preview JSON** downloads in-memory payload (not DB)

### Exports
- `rules.json` — ruleGroups + schemaVersion
- `report.json` / `report.md` include `ruleIssues` / rule group sections when present
- Legacy `mappings.json` / `mappings.csv` retained
- Client session export for `preview.json`

### Rule Simulator (addition)
- Select any rule; run against sample JSON via `POST /api/simulate`
- Reuses Preview engine (`simulateRule` → synthetic one-rule group)
- Shows condition evaluation, matched route, children executed, unmapped fields, warnings, result object

### Rule Templates (addition)
- SQLite `rule_templates` + `/api/templates` CRUD + instantiate
- `ruleToTemplate` / `instantiateTemplate` keep relative child paths portable
- UI: save selected rule as template; apply into selected group with current source/target tree selection

---

## Playwright coverage (Step 5)

See `e2e/step5.spec.ts` for:
1. Create group + conditional rule + child → Validate → issues visible
2. Disable rule → Preview skip reason
3. Reorder rules → priorities update
4. Click validation issue → workbench selects rule
5. Nested array fixture → ≥2 appended elements
6. Legacy v1 project open → migrated `FIELD_MAPPING_V1` → save → reopen v2
7. Export `rules.json` / `report.json`
8. Transformation warning on preview
9. Simulator + template smoke

---

## Residual limitations

- Condition builder remains **atom-only** in UI (AND/OR/NOT via API/core)
- Preview remains **not persisted** in SQLite (by design, P4)
- Template placeholders are relative-path oriented; absolute foreign paths are left as-is
- Nested compound condition editing and governance/AI remain out of scope

---

## Definition of done checklist

1. Create/edit/reorder/enable/disable rules in UI — yes  
2. Clear hierarchy — yes  
3. Validation issue click selects rule — yes  
4. Preview matched/skipped + click-to-rule; array append e2e — yes  
5. Reload persists ruleGroups; migration Playwright — yes  
6. Exports for rules, validation, preview — yes  
7. Transformations non-executable + labeled — yes  
8. No AI features — yes  
9. Unit + Playwright green — verified in CI/local run  
10. This document — yes  
