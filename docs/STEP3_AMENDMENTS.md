# Step 3 Amendments (approved before Step 4)

**Status:** IMPLEMENTED — all amendment tests green (66 unit tests)

| ID | Outcome |
| --- | --- |
| **V1** | Potential overlaps labeled “not statically provable”; Preview for runtime evidence |
| **V2** | `normalizeArrayPath` / `expandEquivalentPaths` / `joinPathAware`; array dest + children no longer unused-warn |
| **V3** | Required findings scoped: `project` \| `route` \| `conditional_route` |
| **V4** | Issue type `definitely_unreachable_rule` (DEFINITELY_UNREACHABLE_RULE) |
| **V5** | Migrated rules suppress duplicate legacy validation; `issueKey` / path-pair dedupe |
| **P1** | Preview appends per matched source element into target arrays |
| **P2** | `RuleCopyMode`: `ROUTE_ONLY` \| `COPY_SOURCE_NODE` \| `APPLY_CHILD_MAPPINGS` with defaults |
| **P3** | Clear `warnings[]` when transformation not executed |
| **P4** | Preview remains response-only (accepted) |

Tests: `packages/core/src/validation/amendments.test.ts` (+ updated preview/validation suites).
