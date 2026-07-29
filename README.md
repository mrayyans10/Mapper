# Mapping Assurance

Deterministic JSON field-mapping assurance for integration work. Paste or upload source and target sample JSON, infer structural trees, manually map fields, and generate a validation report.

This is **not** a transformation engine. It does not generate Java (or any) transform code and has no AI features.

## Architecture

```
/
├── packages/core/     # Schema inference, mapping model, validation engine, export
├── apps/api/          # Express + SQLite persistence + REST API
├── apps/web/          # React + Vite UI
├── fixtures/          # Sample source/target JSON pairs
└── e2e/               # Playwright smoke tests
```

### Module boundaries

| Module | Responsibility |
| --- | --- |
| `packages/core/schema` | Infer JSONPath-style schema trees from sample JSON |
| `packages/core/mapping` | Mapping record helpers |
| `packages/core/validation` | Pure deterministic validation (UI-independent) |
| `packages/core/export` | JSON / Markdown / CSV exporters |
| `apps/api` | HTTP API + SQLite project store |
| `apps/web` | Side-by-side trees, mapping table, report UI |

The validation engine lives in `@mapping-assurance/core` so it can later be reused in a CLI or CI job without the UI.

## Assumptions (MVP)

1. **Paths** use JSONPath-style notation: `$.field`, `$.address.city`, `$.items[*]`, `$.items[*].sku`.
2. **Required** defaults to `false` for every inferred node. A single sample cannot prove mandatoriness; mark required fields in the target tree.
3. **Array item schemas** merge keys across sample elements. Empty arrays yield a `null` item placeholder.
4. **Mappings** are explicit path-to-path records (table UI). No connector lines.
5. **Compatibility**: identical primitives are OK; `null` is treated as compatible with any primitive; mismatched primitives are errors. Object↔primitive and array↔non-array are errors. Array↔array is a warning (needs manual review).
6. **Structurally unreachable**: if a *required* parent object/array on the target is unmapped, child mappings under it are flagged.
7. **Storage** is local SQLite (`apps/api/data/mapping-assurance.sqlite`). No auth.
8. **Export** requires a saved project.

## Quick start

Requires **Node.js 20+** (22 is fine). Use the same Node version for `npm install` and `npm run dev`.

```bash
npm install
npm run build:core
npm run dev
```

- Web UI: http://127.0.0.1:5173  
- API: http://127.0.0.1:3001/api/health  

### Troubleshooting: `Request failed (500)` / Vite `ECONNREFUSED :3001`

The UI proxies `/api` to the API. If the API process crashed, every request looks like a 500.

**Most common cause on Windows:** `better-sqlite3` was compiled for a different Node.js version than the one currently running (e.g. installed under Node 20, then run under Node 22):

```text
The module '...better_sqlite3.node' was compiled against a different Node.js version
NODE_MODULE_VERSION 115 ... requires NODE_MODULE_VERSION 137
```

Fix (from the repo root, with your current Node active):

```bash
node -v
npm rebuild better-sqlite3
# or, if that still fails:
rm -rf node_modules
npm install
npm run build:core
npm run dev
```

On Windows PowerShell, use `Remove-Item -Recurse -Force node_modules` instead of `rm -rf`.

Confirm the API is up before using the UI: open http://127.0.0.1:3001/api/health.

### Production-ish run

```bash
npm run build
npm run start -w @mapping-assurance/api
```

The API serves `apps/web/dist` when present.

## Typical workflow

1. Paste or upload source and target JSON.
2. Click **Infer schemas** to build both trees.
3. Select a source field and a target field, then **Add mapping**.
4. Optionally mark target fields as **req**.
5. Click **Validate** for the assurance report.
6. **Save project** to persist; export mappings/report as JSON, Markdown, or CSV.

## API (summary)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create project |
| GET | `/api/projects/:id` | Get project |
| PUT | `/api/projects/:id` | Update JSON / mappings / required flags |
| POST | `/api/projects/:id/validate` | Re-run validation |
| GET | `/api/projects/:id/export/:format` | `mappings.json`, `report.json`, `report.md`, `mappings.csv` |
| POST | `/api/infer` | Infer schemas without saving |
| POST | `/api/validate` | Validate in-memory schemas + mappings |

## Tests

```bash
# Unit tests (schema inference + validation engine)
npm test

# Playwright e2e (starts API + web)
npx playwright install chromium
npm run test:e2e
```

## Fixtures

| Folder | Scenario |
| --- | --- |
| `fixtures/simple-customer` | Flat customer field mapping |
| `fixtures/nested-address` | Nested person/address structures |
| `fixtures/array-mapping` | Arrays of objects + primitives |
| `fixtures/incompatible` | Type / structure conflicts |

## Architecture approval (Rule Platform)

Rule Platform redesign is **approved**. Progress:

- Step 1: [`docs/STEP1_RULE_DOMAIN_DESIGN.md`](docs/STEP1_RULE_DOMAIN_DESIGN.md)
- Step 2 (migration + Rule Engine): [`docs/STEP2_RULE_ENGINE.md`](docs/STEP2_RULE_ENGINE.md)
- Step 3 (Validation + Preview): [`docs/STEP3_VALIDATION_PREVIEW.md`](docs/STEP3_VALIDATION_PREVIEW.md)
- Step 3 amendments: [`docs/STEP3_AMENDMENTS.md`](docs/STEP3_AMENDMENTS.md)
- Step 4 UI: [`docs/STEP4_UI.md`](docs/STEP4_UI.md)
- Approval record: [`docs/ARCHITECTURE_APPROVAL_RULE_PLATFORM.md`](docs/ARCHITECTURE_APPROVAL_RULE_PLATFORM.md)

## Out of scope (intentionally)

Authentication, AI suggestions, SSO, Git integration, enterprise RBAC, and code generation.
