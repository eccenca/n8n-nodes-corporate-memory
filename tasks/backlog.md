# Backlog — eccenca Corporate Memory n8n Community Node

> Companion to [spec.md](./spec.md). Each item links to the spec section (`§X`) it implements and
> any risk (`R#`) it addresses. This file is the **single source of truth for status** — check
> items off here as they land. Convention: `[ ] B# — title (→ spec §X, R#)`.

## v1 — Foundation & Workflow execution

- [ ] **B1 — Scaffold via `@n8n/node-cli` + `Taskfile.yml`** (→ §1, §5, §9)
  Scaffold with `npm create @n8n/node` (programmatic template): generates
  `package.json` (correct `n8n` field), `tsconfig`, eslint
  (`eslint-plugin-n8n-nodes-base`) + prettier, the `n8n-node`
  build/dev/lint/release scripts, and a provenance `publish.yml`. No gulp — the
  CLI handles the build/icons. Set name `n8n-nodes-eccenca-corporate-memory`,
  keyword `n8n-community-node-package`, `LICENSE` (`R6`), `README.md`,
  `.gitignore`/`.npmignore`; keep the existing `.markdownlint.json`. Requires
  Node.js v22+.
  Add a **`Taskfile.yml`** ([go-task](https://taskfile.dev)) wrapping the
  lifecycle + dependency targets to operate the project, each delegating to the
  generated `n8n-node`/npm scripts: `deps` (install), `build`, `lint`,
  `lint:fix`, `dev` (`n8n-node dev`, hot reload), `test`, `release`, `clean`,
  and a `default` that lists targets. Verify `task build` produces `dist/`.
- [ ] **B2 — `CorporateMemoryApi` credential** (→ §4)
  `grantType` selector for **both** `client_credentials` and `password`
  (resource-owner) flows. Fields: `baseUrl`, `clientId`,
  `clientSecret` (password; required for client-credentials, optional
  for password if the Keycloak client is public), `username` +
  `password` (shown for the password grant), `tokenUrl` (default
  Keycloak URL, overridable), optional `diBaseUrl`/`dpBaseUrl`. No
  auto-`authenticate` (token fetched in helper).
- [ ] **B3 — `GenericFunctions`** (→ §4, `R1`, `R4`)
  `getToken()` (client_credentials, in-memory cache keyed by client+token-url, refresh ~30s early),
  `cmemApiRequest()` (resolve component base, attach Bearer, `this.helpers.httpRequest`), base-URL
  normalization (strip trailing slash, avoid double slashes).
- [ ] **B4 — Credential test** (→ §4, `R3`)
  Node `methods.credentialTest`: `getToken` → `GET {dp}/api/userinfo` (fallback
  `GET {di}/api/workflow/info`); friendly error messages distinguishing token vs reachability.
- [ ] **B5 — Node skeleton + versioning + router** (→ §5, §7)
  `Corporate Memory` node, `version: [1]`/`defaultVersion: 1`, resource→operation dropdowns,
  `execute()` dispatch, `Continue On Fail` + `NodeApiError` mapping.
- [ ] **B6 — Workflow → Execute (sync)** (→ §3.1, §5, §6, `R2`)
  Params `projectId`, `taskId`, `payloadType` (None/JSON/XML), `payload` (hidden when None),
  `acceptType` (JSON/XML), `splitOutput`. Handle empty/`204` output gracefully.
- [ ] **B7 — Workflow → Execute Async + Cancel** (→ §3.1, §6)
  Async emits `{ executionId, location }` (from body + `Location`); Cancel takes `executionId`.
- [ ] **B8 — Unit tests: auth** (→ §9)
  `getToken` cache/expiry + error mapping.
- [ ] **B9 — CI + local-dev docs** (→ §9, `R7`)
  GitHub Actions from the scaffold: PR → build/lint/test; tag `v*` →
  `n8n-node release` publishing to npm **with provenance** (mandatory for
  community nodes from 2026-05-01). Document local dev via `task dev`
  (`n8n-node dev`, hot reload) in the README + `Taskfile.yml` — no `npm link`.

## v2 — SPARQL & Query Catalog

- [ ] **B10 — SPARQL → Select Query** (→ §3.2, §5)
  `query`, `defaultGraphUri`/`namedGraphUri` (repeatable), `base64encoded` toggle; `Accept:
  application/sparql-results+json`.
- [ ] **B11 — SPARQL result flattening** (→ §5, §6, §9)
  `{head,results.bindings}` → one item per row; `simplify` toggle (string values vs full binding
  objects); unbound-var handling. Unit test from a recorded fixture.
- [ ] **B12 — Query Catalog → List Reports + loadOptions** (→ §3.3, §5)
  `GET /api/querycatalog`; one item per `CatalogQuery`; `getCatalogQueries` loadOptions to populate
  Run Report's `queryIri` dropdown.
- [ ] **B13 — Query Catalog → Run Report (parameter handover)** (→ §3.3, §5)
  `queryIri`, `substitutions` (fixedCollection `placeholder`/`value` pairs + raw-JSON escape hatch
  → `buildSubstitutions()` JSON map), optional `contextGraph`/`fileName`; `GET`/`POST` switch by
  payload size.
- [ ] **B14 — CSV → items parser** (→ §5, §6, §9, `R5`)
  Quote/newline-aware CSV parse (header row = keys); `parseCsv` toggle for raw/binary. Unit tests
  for quoting/embedded-comma/newline edge cases.

## v.later

- [ ] **B15 — `oAuth2Api` clientCredentials variant** (→ §4, §7, `R1`)
  Revisit `extends: ['oAuth2Api']` once [n8n#16857](https://github.com/n8n-io/n8n/issues/16857) is
  fixed; offer as an alternative credential / node version bump.
- [ ] **B16 — Additional CMEM surface** (→ §2)
  SPARQL CONSTRUCT/ASK/UPDATE; graph-store read/write; vocabulary/SHACL ops; trigger node.
- [ ] **B17 — Verified community node submission** (→ §1, `R7`)
  Meet n8n verification guidelines (no runtime deps, docs, provenance publish); eccenca
  branding/icon; submit.
- [ ] **B18 — Resolve open questions** (→ §8)
  `R2` DI output-dataset requirement; `R3` DP `userinfo` path variance; `R6` license confirmation;
  obtain a demo/staging CMEM for repeatable manual + CI verification.

## Milestones

- **M1 (v1):** B1–B9 — credential proven end-to-end + Workflow Execute against a real CMEM.
- **M2 (v2):** B10–B14 — SPARQL SELECT + template reports usable as n8n items.
- **M3 (release):** B17 + semver `1.0.0` + (optional) verified listing.
