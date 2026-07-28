# Step 2 — Migration & Rule Engine

**Status:** IMPLEMENTED (core + API persistence wiring; **no UI changes**)

## Delivered

| Area | Location |
| --- | --- |
| Path utils (D7) | `packages/core/src/rule/paths.ts` |
| Condition evaluator | `packages/core/src/rule/condition-eval.ts` |
| Rule Engine | `packages/core/src/rule/engine.ts` |
| v1→v2 migration | `packages/core/src/migration/v1-to-v2.ts` |
| `ChildMapping.transformation` extension | `packages/core/src/rule/types.ts` (not executed) |
| DB additive columns + dual-write | `apps/api/src/db/projects.ts` |
| Migrate-on-read + legacy mapping sync | `apps/api` db + routes |

## Test results

Run: `npm test` (and full `npm run build`).

See CI/local output in the agent report for counts.

## Migration risks

1. **Dual-write drift** — If a project later gains non-legacy routing `RuleGroup`s, updating `mappings` via the old API will **not** rebuild `ruleGroups` (guarded by `onlyLegacyRuleGroups`). Old UI still writes `mappings` only; until Rule UI ships, keep projects legacy-only or avoid mixed edits.
2. **Migrate-on-read without immediate persist** — `GET` migrates in memory; disk may still show `schema_version=1` until the next `PUT`/`insert` writes columns. Risk: tooling that reads SQLite directly sees stale version. Mitigation: next save persists; optional explicit persist can be added later.
3. **Corrupt `rule_groups` JSON** — Parser falls back to `[]`, then remigrates from `mappings` when mappings exist. If both are corrupt/empty, project opens with no rules.
4. **Rollback to pre-Step-2 binaries** — Safe: old code ignores new columns and uses `mappings`. New routing-only rules (no `FIELD_MAPPING_V1`) would be invisible to old binaries (acceptable until UI creates them).
5. **Priority renumbering on remigrate** — Force remigrate assigns `priority = index+1` from current `mappings` order. Manual priority edits on legacy rules would be lost if mappings are re-saved from the old UI.

## Unresolved assumptions (confirm before Step 3)

| # | Assumption | Impact |
| --- | --- | --- |
| A1 | `==` / `!=` use strict equality; **no** string↔number coercion. Relational ops require finite numbers only. | Conditions like `amount > "1000"` are false |
| A2 | When a condition path resolves to multiple values (`[*]`), the atom succeeds if **any** value matches | “All elements must match” is not supported yet |
| A3 | `sourceNode` may contain **at most one** `[*]` in Step 2 | Nested `[*]` paths throw `PathError` |
| A4 | Missing `sourceNode` yields a context with `relativeRoot: undefined`; conditions fail closed | No match rather than error |
| A5 | `all-match` with multiple enabled fallbacks also refuses to execute them (same spirit as D6) | Documented beyond first-match-only wording |
| A6 | Transformation refs are stored only; **no** preview/apply of transforms | Child mapping copies are not simulated yet |
| A7 | Absolute condition paths are allowed alongside relative; relative is preferred inside array contexts | Authors can accidentally mix scopes |
| A8 | New projects are created as `schemaVersion: 2` with empty `ruleGroups` | Old clients expecting only v1 still work via `mappings: []` |

## Out of scope (still)

- UI Rule editor / condition builder  
- Validation engine rewrite for rule issues  
- Preview / transform execution  
- OpenAPI  
- Knowledge Repository / Impact Analysis  

## Next step

Step 3 candidates: rule-aware Validation Engine and/or Preview Engine (still before UI), then UI.
