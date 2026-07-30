# AGENTS.md

## Cursor Cloud specific instructions

Mapping Assurance is a single-product npm-workspaces monorepo (Node.js >= 20; verified on Node 22). It is a deterministic JSON field-mapping assurance web app with three workspaces:

- `packages/core` — schema inference, mapping/rule engine, validation, export (pure TS library; api/web import it from `dist/`).
- `apps/api` — Express + embedded SQLite (`better-sqlite3`) REST API on port `3001`.
- `apps/web` — React + Vite UI on port `5173`; dev server proxies `/api` → `http://127.0.0.1:3001`.

Standard commands live in the root `package.json` scripts and `README.md`. Key ones: `npm run dev` (starts core watch + api + web together), `npm test` (unit tests), `npm run build` (build all workspaces), `npm run test:e2e` (Playwright).

### Non-obvious caveats

- `packages/core` must be built before api/web can run — they import `@mapping-assurance/core` from `dist/`. `npm run dev` and `npm run build` handle this automatically (`build:core` runs first). If you run `apps/api`/`apps/web` individually without a prior core build, they will fail to resolve the import.
- The dev server is auto-started via `.cursor/environment.json` (terminal `dev` runs `npm run dev`). If it is not running, start it manually with `npm run dev` from the repo root. Verify the API with `curl http://127.0.0.1:3001/api/health` (expects `{"ok":true,...}`) and the UI at `http://127.0.0.1:5173`.
- `npm run lint` is currently broken in the repo: it runs `tsc -b --pretty false` at the root, but there is no root `tsconfig.json`, so it fails with `TS5083: Cannot read file '/workspace/tsconfig.json'`. This is a pre-existing repo config issue, not an environment problem. To typecheck, use `npm run build` instead (each workspace has its own working `tsc` build; `apps/web` also runs `tsc -b`).
- SQLite is embedded (`better-sqlite3`) — no external DB service. The DB file is auto-created (default `./data/mapping-assurance.sqlite`, override with `MAPPING_ASSURANCE_DB`). `*.sqlite` files are gitignored. `better-sqlite3@^12` ships prebuilds for Node 20–24; if you ever hit a `NODE_MODULE_VERSION` ABI mismatch after switching Node, run `npm run rebuild:native`.
- E2E tests need the Playwright browser, which is NOT installed by the dependency update script (it is a heavy ~115MB download). Before `npm run test:e2e`, run `npx playwright install --with-deps chromium` once. Playwright's config auto-starts its own api+web servers (using `MAPPING_ASSURANCE_DB=/tmp/mapping-assurance-e2e.sqlite`), so you do not need `npm run dev` running for e2e.
