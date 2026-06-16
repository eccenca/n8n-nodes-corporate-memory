# Backlog — eccenca Corporate Memory n8n Community Node

> Companion to [spec.md](./spec.md). Each item links to the spec section (`§X`) it implements and
> any risk (`R#`) it addresses. This file is the **single source of truth for status** — check
> items off here as they land. Convention: `[ ] B# — title (→ spec §X, R#)`.
>
> **Note (v0.4):** the **auth** design in `B2`/`B3`/`B4` (custom token helper + grant
> selector + password grant) is superseded by the `oAuth2Api` refactor — see `B19`–`B24`.

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
  Declarative credential `test` (required by n8n verification — a node-level `testedBy` is not
  accepted). Key gotcha: n8n only invokes `preAuthentication` when the credential declares a
  `hidden` property with `typeOptions.expirable: true` — so a hidden `expirable` `sessionToken`
  field is required. With it: `preAuthentication` fetches the token (`getCmemToken`) → stored in
  `sessionToken`; `authenticate` injects `Bearer {{$credentials.sessionToken}}`; the test GETs
  `{dp}/userinfo` (base URL from static `$credentials` fields, since the test URL resolves before
  `preAuthentication`).
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

## v0.4 — oAuth2Api refactor (n8n Cloud verification feedback)

> The Cloud reviewer requires the credential to extend n8n's built-in `oAuth2Api`
> (`clientCredentials`) instead of the custom token helper. This supersedes the **auth**
> parts of `B2`/`B3`/`B4` and resolves `B15`. The **password grant is dropped** (`R8`) — it
> is not supported by `oAuth2Api` and CMEM rejects the generic Basic/header alternative.
> Spec §4 rewritten. Order: B19 → B20 → B21 → B22 → B23 → B24.
>
> **Verification rename:** lint rule `cred-class-oauth2-naming` forces an `OAuth2` marker on
> any `oAuth2Api`-extending credential, so the credential was renamed
> `CorporateMemoryApi`/`corporateMemoryApi` → `CorporateMemoryOAuth2Api`/`corporateMemoryOAuth2Api`
> (displayName *eccenca Corporate Memory OAuth2 API*), and the file/`n8n.credentials` path with it.
>
> **Field labels/order (post-review tweak):** renamed *CMEM Base URL* → *Base URL*; moved the
> token URL to the bottom by hiding inherited `accessTokenUrl` and re-exposing it as the
> optional custom `tokenUrl` field. n8n appends custom fields after all inherited ones
> (`mergeNodeProperties`, verified), so *Base URL* cannot be the absolute first field —
> rendered order is Client ID · Client Secret · Send Additional Body Properties · Allowed HTTP
> Request Domains · Base URL · OAuth Token URL · DI/DP Base URL. See spec §4 "Field order".

- [x] **B19 — Credential extends `oAuth2Api` (clientCredentials)** (→ §4, `R1`, `R8`)
  Rewrote `credentials/CorporateMemoryOAuth2Api.credentials.ts`: `extends = ['oAuth2Api']`;
  hidden overrides `grantType=clientCredentials`, `scope=''`, `authentication='body'`,
  `authQueryParameters=''` (inherited `authUrl` stays hidden via oAuth2Api's own
  grant-type displayOptions). `accessTokenUrl` = **visible/editable** string, default
  `'={{$self["baseUrl"]}}/auth/realms/cmem/protocol/openid-connect/token'` — prefilled from
  `baseUrl` but user-overridable (`R4`); fallback (hidden ternary + `tokenUrl` field) documented
  in spec §4 if the visible default mis-renders in the UI (validate in B22). Kept custom
  `baseUrl` (required), `diBaseUrl`, `dpBaseUrl`; inherited `clientId`/`clientSecret` visible.
  Removed the `grantType` options selector, `username`, `password`, `tokenUrl`, `sessionToken`,
  `preAuthentication`, `authenticate`. Kept the `eccenca` lowercase-brand lint exception.
- [x] **B20 — `GenericFunctions` use n8n-managed auth** (→ §4, `R1`)
  Removed `getCmemToken`, `tokenCache`, `clearCmemTokenCache`, `resolveTokenUrl`,
  `buildTokenRequestBody`, `TOKEN_EXPIRY_SKEW_MS`, `ApplicationError` import, and the
  `TokenResponse`/`TokenCacheEntry` interfaces. Narrowed `CorporateMemoryCredentials` to
  `{ baseUrl; clientId?; clientSecret?; diBaseUrl?; dpBaseUrl? }` and `CmemRequester` to
  `{ helpers: { httpRequestWithAuthentication(credentialsType, options) } }`. `cmemApiRequest`
  → `helpers.httpRequestWithAuthentication('corporateMemoryOAuth2Api', options)` (no manual
  Bearer). Kept `resolveComponentBaseUrl`, `normalizeBaseUrl`, all SPARQL/CSV/substitution helpers.
- [x] **B21 — Node wiring** (→ §5)
  No behaviour change; the `this as unknown as CmemRequester` cast in `execute()` and the four
  `loadOptions` now resolves to `httpRequestWithAuthentication`. `getCredentials` still fetched
  for base-URL resolution; `NodeApiError` mapping unchanged. Credential name updated in the
  node's `credentials[]`.
  **Idiomatic-alignment pass (post-review):** reviewed `n8n-nodes-base` self-hosted analogs —
  `Elasticsearch`, `Gitlab`, `Grafana` (all store a base/server URL in the credential).
  Refactored the helpers to the standard **`this`-based** shape: `cmemApiRequest`/
  `listQueryCatalogGraphs`/`listCatalogQueries` take `this: IExecuteFunctions | ILoadOptionsFunctions`
  (`CmemFunctions`), read the credential via `this.getCredentials(…)`, and are invoked with
  `.call(this, …)`. Dropped the custom `CmemRequester` type and all `requester`/`credentials`
  threading from the node. This both fixes the loadOptions failure ("this.getNode is not a
  function") and matches how every core node wires authenticated requests. See spec §4.
  **Validation findings:**
  - Request wiring matches `gitlabApiRequest`/`grafanaApiRequest` exactly: `this`-based, read
    creds internally, derive base URL from a credential field with a trailing-slash strip
    (`server.replace(/\/$/, '')` / `tolerateTrailingSlash`), `helpers.…WithAuthentication.call(this, …)`.
    (Those two use the legacy `requestWithAuthentication`; we use the modern
    `httpRequestWithAuthentication` — preferred for new nodes.)
  - Credential matches `GitlabOAuth2Api`: hidden `grantType`, base/`server` field, hidden
    `accessTokenUrl` derived via `={{$self["…"]}}`, hidden `scope`/`authQueryParameters`/
    `authentication: 'body'`. (We add an optional editable `tokenUrl` override + field reorder;
    GitLab derives directly from `server` with no override — both valid.)
  - **`version: 1` confirmed idiomatic:** plain number used by 286 core nodes (incl. Grafana);
    arrays are only for multi-version nodes. **No conversion needed** — kept `version: 1`.
- [x] **B22 — Credential test** (→ §4, `R3`)
  Kept the declarative `test` GET `{dp}/userinfo`; removed the `sessionToken`/`preAuthentication`
  workaround. **Pending manual check:** verify Test/save in the n8n UI against a real CMEM
  (`task dev`), and confirm the visible `accessTokenUrl` default renders editably (else apply
  the B19 fallback).
- [x] **B23 — Tests** (→ §9)
  Rewrote `test/CorporateMemoryOAuth2Api.test.ts` (extends `oAuth2Api`; hidden
  `grantType`/`authentication`; visible derived `accessTokenUrl`; password fields & `sessionToken`
  asserted absent) and the auth parts of `test/GenericFunctions.test.ts` / the node test (deleted
  the token-cache/`getCmemToken` suites; assert `cmemApiRequest` →
  `httpRequestWithAuthentication('corporateMemoryOAuth2Api', …)` with the resolved URL + method).
  SPARQL/CSV/substitution suites kept green. **31 tests pass; `task lint` + `task build` clean.**
- [x] **B24 — Docs + reviewer reply** (→ §1)
  Updated the README credentials section (client-credentials only; new credential name;
  `baseUrl`/derived `accessTokenUrl`/`clientId`/`clientSecret`, optional `diBaseUrl`/`dpBaseUrl`;
  password-grant note). `task lint` + `task test` (31) + `task build` clean. Reviewer reply
  drafted below.
  **Left to the release step (not done here):** `package.json` version bump to `0.4.0` and the
  auto-generated `CHANGELOG.md` are produced by `task release` (`n8n-node release` / release-it),
  the same flow that cut 0.3.0 — don't hand-edit. Then publish (npm, with provenance) and reply
  to the reviewer.

  **Draft reviewer reply:**
  > Thanks for the review. v0.4.0 refactors the credential to **extend n8n's built-in
  > `oAuth2Api`** using the **client_credentials** grant — n8n now performs the token exchange,
  > caching and refresh; our custom `getCmemToken` helper and in-memory cache are removed, and
  > all requests go through `httpRequestWithAuthentication`. The credential is renamed to
  > *eccenca Corporate Memory OAuth2 API* to satisfy the OAuth2 naming lint rule.
  >
  > We **dropped the resource-owner password grant** rather than request a waiver: `oAuth2Api`
  > supports only `authorizationCode`/`clientCredentials`/`pkce`, and CMEM/Keycloak only accepts
  > a Keycloak-issued Bearer JWT (not the HTTP-Basic style of the generic username/password
  > `authenticate` examples), so a password grant would have required reintroducing custom token
  > code. The client-credentials service-account flow covers the automation use case. Published
  > as v0.4.0; ready for re-review.

## v.later

- [x] **B15 — `oAuth2Api` clientCredentials variant** (→ §4, §7, `R1`)
  **Done via `B19`** (v0.4) — adopted `extends: ['oAuth2Api']` with `clientCredentials`,
  ahead of the original "once [n8n#16857](https://github.com/n8n-io/n8n/issues/16857) is fixed"
  plan, because n8n Cloud verification requires the built-in credential.
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
  - [x] Public **GitHub** repo `eccenca/n8n-nodes-corporate-memory`; npm `repository`/`homepage` match.
  - [x] **GitHub Actions** `ci.yml` + `publish.yml` (npm publish **with provenance**, `id-token: write`).
  - [x] Publish `@eccenca/n8n-nodes-corporate-memory` to npm, then pass
    `npx @n8n/scan-community-package @eccenca/n8n-nodes-corporate-memory`.
  - [x] Consistent author/maintainer identity across npm + GitHub.
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
