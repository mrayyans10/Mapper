# Step 3 — Rule-aware Validation & Preview

**Status:** IMPLEMENTED (core + API; **no UI changes**)  
**Order:** Validation first, then Preview.

## Delivered

| Module | Path | Entry points |
| --- | --- | --- |
| Rule Validation | `packages/core/src/validation/rule-validation.ts` | `validateRuleGroups`, `validateProjectRules`, `ruleIssuesToLegacyIssues` |
| Preview Engine | `packages/core/src/preview/engine.ts` | `previewRuleGroups` |
| API | `apps/api/src/routes/projects.ts` | `POST /api/validate` (ruleGroups), `POST /api/preview`, `POST /api/projects/:id/validate`, `POST /api/projects/:id/preview` |

Legacy `validateMappings(source, target, mappings)` remains unchanged for backward compatibility.

## Validation coverage

| Check | Issue type |
| --- | --- |
| Missing/invalid conditions, bad regex, bad IN value | `invalid_condition` |
| Duplicate rule signature | `duplicate_rule` |
| Unconditional routes to different destinations | `conflicting_rule` |
| Same condition → different destinations | `overlapping_rule` |
| After unconditional in first-match | `unreachable_rule` |
| `requireFallback` option | `missing_fallback` |
| D6 multiple enabled fallbacks | `multiple_enabled_fallbacks` |
| INV-* shape / id / relative paths | `invariant_violation`, `legacy_direct_with_children` |
| Child/direct type conflicts | `datatype_mismatch`, `array_mismatch`, `cardinality_mismatch` |
| Duplicate child targets | `duplicate_child_mapping` |
| Required parent gaps | `structurally_unreachable` |
| Coverage | `unmapped_required_target`, `unmapped_optional_target`, `unused_source`, `unused_mapping` |

Each issue includes: `severity`, `type`, `ruleId` (when applicable), `message`, `recommendedFix`.

## Preview behavior

- Runs Rule Engine selection (matched / skipped / fallback / destinations)
- Builds `resultObject` via direct copies and child field copies
- Emits `traces` and `notes`
- **Does not** execute `ChildMapping.transformation` (records `transformationDeferred`)

## Backward compatibility

- Existing `POST /api/validate` with `mappings` only still works
- Project validate uses rule validation when `ruleGroups.length > 0`, optionally merges legacy mapping validation
- Migrated legacy direct rules participate in both engines
- UI unchanged — still uses legacy validate path via PUT/`validateMappings` until Step 4

## Unresolved rule semantics / edge cases

| ID | Topic | Current behavior | Risk |
| --- | --- | --- | --- |
| V1 | Static overlap of distinct conditionals | Not flagged (cannot prove overlap without SMT/sample space) | False negatives for subtle overlaps — use Preview |
| V2 | `[*]` child absolute paths vs schema | Schema uses `$.arr[*].field`; join yields `$.arr.field` when destination is `$.arr` without `[*]` | May warn `unused_mapping` unless destinationNode includes `[*]` |
| V3 | Required-target scan is project-wide | Unmapped required fields flagged even if outside active destinations | Noisy for partial routing designs |
| V4 | Unreachable detection | Only detects “after unconditional” in first-match; not full condition implication | Some dead rules undetected |
| V5 | Legacy + rule dual validation | Can duplicate similar issues when `includeLegacyMappingValidation` is true | Reports may look noisy during transition |
| P1 | Preview write into `[*]` targets | Writes index `0` only as illustration | Multi-element target arrays not fully materialized |
| P2 | Route-only rules (no children) | Copies entire `sourceNode` value to `destinationNode` | May over-copy objects vs intended structure |
| P3 | Transformations | Never applied | Preview output is structural copy only |
| P4 | Preview persistence | Not stored in SQLite (response-only) | Re-run preview each time |
| P5 | Missing sourceNode in sample | No match / undefined copies | Fail-closed |

## Tests

- `rule-validation.test.ts`
- `preview/engine.test.ts`
- Existing Step 1/2 + legacy suites must remain green

## Out of scope (Step 4+)

- UI for validation/preview
- Transformation execution
- Formal condition disjointness proving
- Full multi-index array materialization in preview
