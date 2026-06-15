# Backlog — eccenca Corporate Memory n8n Community Node

> Companion to [spec.md](./spec.md). Each item links to the spec section (`§X`) it implements and
> any risk (`R#`) it addresses. This file is the **single source of truth for status** — check
> items off here as they land. Convention: `[ ] B# — title (→ spec §X, R#)`.

## v1 — Foundation & Workflow execution

- [x] **B1 — Scaffold via `@n8n/node-cli` + `Taskfile.yml`** (→ §1, §5, §9)
  Scaffold with `npm create @n8n/node` (programmatic template): generates
  `package.json` (correct `n8n` field), `tsconfig`, eslint
  (`eslint-plugin-n8n-nodes-base`) + prettier, the `n8n-node`
  build/dev/lint/release scripts, and a provenance `publish.yml`. No gulp — the
  CLI handles the build/icons. Set name `@eccenca/n8n-nodes-corporate-memory`,
  keyword `n8n-community-node-package`, `LICENSE` (MIT), `README.md`,
  `.gitignore`/`.npmignore`; keep the existing `.markdownlint.json`. Requires
  Node.js v22+.
  Add a **`Taskfile.yml`** ([go-task](https://taskfile.dev)) wrapping the
  lifecycle + dependency targets to operate the project, each delegating to the
  generated `n8n-node`/npm scripts: `deps` (install), `build`, `lint`,
  `lint:fix`, `dev` (`n8n-node dev`, hot reload), `test`, `release`, `clean`,
  and a `default` that lists targets. Verify `task build` produces `dist/`.
- [x] **B2 — `CorporateMemoryApi` credential** (→ §4)
  `grantType` selector for **both** `client_credentials` and `password`
  (resource-owner) flows. Fields: `baseUrl`, `clientId`,
  `clientSecret` (password; required for client-credentials, optional
  for password if the Keycloak client is public), `username` +
  `password` (shown for the password grant), `tokenUrl` (default
  Keycloak URL, overridable), optional `diBaseUrl`/`dpBaseUrl`. No
  auto-`authenticate` (token fetched in helper).
- [x] **B3 — `GenericFunctions`** (→ §4, `R1`, `R4`)
  `getToken()` (client_credentials, in-memory cache keyed by client+token-url, refresh ~30s early),
  `cmemApiRequest()` (resolve component base, attach Bearer, `this.helpers.httpRequest`), base-URL
  normalization (strip trailing slash, avoid double slashes).
- [x] **B4 — Credential test** (→ §4, `R3`)
  Node `methods.credentialTest`: `getToken` → `GET {dp}/api/userinfo` (fallback
  `GET {di}/api/workflow/info`); friendly error messages distinguishing token vs reachability.
- [x] **B5 — Node skeleton + versioning + router** (→ §5, §7)
  `Corporate Memory` node, `version: [1]`/`defaultVersion: 1`, resource→operation dropdowns,
  `execute()` dispatch, `Continue On Fail` + `NodeApiError` mapping.
- [x] **B6 — Workflow → Execute (sync)** (→ §3.1, §5, §6, `R2`)
  `POST /api/workflow/result/{project}/{workflow}`. Project/Workflow **dropdowns** (loadOptions
  off `/api/workflow/info`); `payloadType` None/JSON/XML/CSV (input `Content-Type`); `resultFormat`
  JSON/XML/CSV/N-Triples (output `Accept`); `splitOutput`. `204` → `{ executed, hasResult: false }`.
  Verified end-to-end on docker.localhost.
- [x] **B7 — Workflow → Execute (Async)** (→ §3.1, §6)
  `POST /api/workflow/executeAsync?output:type=…`; emits `{ activityId, instanceId }`. Async
  result-polling + cancellation (activity API) deferred to `B16`.
- [x] **B8 — Unit tests: auth** (→ §9)
  `getToken` cache/expiry + error mapping.
- [x] **B9 — CI + local-dev docs** (→ §9, `R7`)
  GitHub Actions from the scaffold: PR → build/lint/test; tag `v*` →
  `n8n-node release` publishing to npm **with provenance** (mandatory for
  community nodes from 2026-05-01). Document local dev via `task dev`
  (`n8n-node dev`, hot reload) in the README + `Taskfile.yml` — no `npm link`.

## v2 — SPARQL & Query Catalog

- [x] **B10 — SPARQL → Select Query** (→ §3.2, §5)
  `GET /proxy/default/sparql?query=…` with `Accept: application/sparql-results+json`; optional
  repeatable `default-graph-uri`/`named-graph-uri` (Options collection). Verified on docker.localhost.
- [x] **B11 — SPARQL result flattening** (→ §5, §6, §9)
  `{head,results.bindings}` → one item per row; `simplify` toggle (string values vs full binding
  objects); unbound vars omitted; ASK → `{ boolean }`. Unit-tested from a fixture.
- [x] **B12 — Query Catalog → List Queries + catalog-graph awareness** (→ §3.3, §5)
  Queries span multiple catalog graphs, discovered via a labelled `shui:SparqlQuery` SPARQL
  (mirrors CMEM's catalog selector). `getQueryCatalogs` loadOptions lists those graphs; a
  **Catalog Graph** selector (default = All Catalogs) scopes both List Queries and the
  `getCatalogQueries` `queryIri` dropdown. List emits one item per saved query (`iri`, `label`,
  `description`, `queryText`, `queryTypes`, `catalogGraph`). Verified on docker.localhost (4 catalogs).
- [x] **B13 — Query Catalog → Run Report (parameter handover)** (→ §3.3, §5)
  `GET /api/queries/reports/perform?queryIri=…&substitutions=<json>` — `substitutions` built from a
  fixedCollection of name/value pairs (`buildSubstitutions()`) plus a raw-JSON escape hatch and
  optional `contextGraph`. Parameter handover verified on docker.localhost.
- [x] **B14 — CSV → items parser** (→ §5, §6, §9, `R5`)
  Quote/newline-aware CSV parse (header row = keys) → one item per row; `Parse CSV Into Items`
  toggle returns the raw CSV string instead. Unit-tested (quoting / embedded comma / newline /
  escaped quotes).

## v.later

- [ ] **B15 — `oAuth2Api` clientCredentials variant** (→ §4, §7, `R1`)
  Revisit `extends: ['oAuth2Api']` once [n8n#16857](https://github.com/n8n-io/n8n/issues/16857) is
  fixed; offer as an alternative credential / node version bump.
- [ ] **B16 — Additional CMEM surface** (→ §2)
  SPARQL CONSTRUCT/ASK/UPDATE; graph-store read/write; vocabulary/SHACL ops; trigger node;
  async workflow result-polling + cancellation via the activity API
  (`/workspace/activities/*`, `/api/workflow/executionResult`).
- [ ] **B17 — Verified community node submission** (→ §1, `R7`)
  Two tracks. **Unverified** (publish to npm; users self-install by package name) — essentially
  met today. **Verified** (listed/installable on n8n Cloud) needs the checklist below.
  Already satisfied: one third-party service; TypeScript + `n8n-node` tooling; **no runtime
  dependencies**; no env-var/filesystem access; per-item error handling; MIT; English; README;
  `n8n-node lint` clean.
  Gaps for verification:
  - [ ] Public **GitHub** repo whose URL matches npm `repository`/`homepage` (repo is on GitLab).
  - [ ] **GitHub Actions** `publish.yml` that publishes to npm **with provenance** (required from
    2026-05-01; no publishing from a local machine). `npm create @n8n/node` ships this workflow.
  - [ ] Publish `@eccenca/n8n-nodes-corporate-memory` to npm, then pass
    `npx @n8n/scan-community-package @eccenca/n8n-nodes-corporate-memory`.
  - [ ] Consistent author/maintainer identity across npm + GitHub.
  - [ ] Nice-to-have: `CorporateMemory.node.json` codex (categories + doc links) and an example
    workflow in the README.
  - [ ] Submit via the [n8n Creator Portal](https://creators.n8n.io) and pass review.
- [ ] **B18 — Resolve open questions** (→ §8)
  Remaining: obtain a demo/staging CMEM for repeatable **CI** verification. (`R2`/`R3`/`R6`
  resolved; manual verification done against docker.localhost.)

## Milestones

- **M1 (v1):** B1–B9 — credential proven end-to-end + Workflow Execute against a real CMEM.
- **M2 (v2):** B10–B14 — SPARQL SELECT + template reports usable as n8n items.
- **M3 (release):** B17 + semver `1.0.0` + (optional) verified listing.
