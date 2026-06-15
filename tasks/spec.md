# Spec — eccenca Corporate Memory n8n Community Node

> **Status & work tracking:** see [backlog.md](./backlog.md). Backlog items are referenced
> here as `B#`; risks/open questions as `R#`. The backlog is the single source of truth for
> what is done; this document is the stable reference for *what* and *why*.

## 1. Overview

[eccenca Corporate Memory (CMEM)](https://eccenca.com) is a knowledge-graph platform. This
package publishes an [n8n](https://n8n.io) **community node** so automation engineers can drive
CMEM from n8n workflows: execute CMEM data-integration workflows on a payload, run SPARQL SELECT
queries, and run saved (parameterized) catalog queries / "template reports".

- **Package name:** `n8n-nodes-eccenca-corporate-memory`
- **Node displayName:** `Corporate Memory`
- **License:** MIT (confirmed — see `R6`)
- **Tooling:** scaffolded with the official [`@n8n/node-cli`](https://www.npmjs.com/package/@n8n/node-cli) (`npm create @n8n/node`) and operated via a `Taskfile.yml` ([go-task](https://taskfile.dev)). Requires Node.js v22+.
- **Motivation (Jira user story):** *As an automation engineer, in order to ingest data from my
  n8n workflows, I want a CMEM node implementation.* n8n has 1000+ community nodes; integrating
  CMEM extends both ecosystems.

## 2. Goals / Non-Goals

**In scope (v1):**

- Corporate Memory credential type supporting **both** OAuth2 grants:
  **client-credentials** and **password** (Base URL, Client ID, Client
  Secret, and Username/Password for the password grant).
- Start a workflow with an optional payload and get the optional result.

**In scope (v2):**

- SPARQL SELECT query → results processable as n8n items.
- Query-catalog "template report" execution by IRI, **with parameter handover**.

**Non-goals (tracked for `v.later`, `B16`):** SPARQL CONSTRUCT / ASK / UPDATE; graph-store
read/write CRUD; vocabulary/SHACL management; trigger (polling/webhook) nodes; the Companion/chat
endpoints.

## 3. CMEM API reference

CMEM is one product served under one base host. Components are mounted under sub-paths and share
one OAuth2 (Keycloak) authentication. The OpenAPI specs declare `localhost` dev servers, so all
base URLs **must be configurable** (see §4).

- DataIntegration (DI): `{base}/dataintegration` —
  [OpenAPI](https://releases.eccenca.com/OpenAPI/eccenca-DataIntegration-OpenAPI-Reference-latest.json)
- DataPlatform (DP): `{base}/dataplatform` —
  [OpenAPI](https://releases.eccenca.com/OpenAPI/eccenca-DataPlatform-OpenAPI-Reference-latest.json)

### 3.1 Workflow execution — DataIntegration (→ `B6`, `B7`)

| Op | Method | Path | Notes |
| ---- | -------- | ------ | ------- |
| Execute (sync) | `POST` | `/dataintegration/api/workflow/result/{project}/{workflow}` | Body **optional** = variable input (`Content-Type` per input MIME: JSON/XML/CSV). `Accept` = variable-output MIME (JSON/XML/CSV/N-Triples/XLSX). `200` + result, or **`204`** when the workflow has no variable output. |
| Execute (async) | `POST` | `/dataintegration/api/workflow/executeAsync/{project}/{workflow}?output:type={mime}` | Body **optional**; `output:type` query (literal colon) **required**. `201` → `{ activityId, instanceId }`. |
| List workflows | `GET` | `/dataintegration/api/workflow/info` | Array of `{ id, label, projectId, projectLabel, variableInputs[], variableOutputs[] }`. Empty `variableInputs`/`variableOutputs` ⇒ no payload / no result. Powers the project & workflow dropdowns. |

> **Endpoint choice (`R2`, verified on docker.localhost).** `.../executeOnPayload[Asynchronous]`
> *require* a request body (HTTP `415` without one), so they only fit workflows that mandate a
> payload. We use `/api/workflow/result` (sync) and `/api/workflow/executeAsync` (async), which
> accept an **optional** body and therefore cover every case: no input, input-only, output-only,
> both. A workflow's **input and output MIME types are independent**. Async result-polling and
> cancellation use the activity API and are deferred to `v.later` (`B16`).

### 3.2 SPARQL SELECT — DataPlatform (→ `B10`, `B11`)

| Op | Method | Path | Notes |
| ---- | -------- | ------ | ------- |
| Select | `GET` | `/dataplatform/proxy/default/sparql?query=<sparql>` | Optional repeatable `default-graph-uri` / `named-graph-uri`. `Accept: application/sparql-results+json`. Verified on docker.localhost. (`base64encoded` exists but is not exposed in v1.) |

Response (SELECT) is the standard SPARQL JSON results shape:

```json
{ "head": { "vars": ["s", "p", "o"] },
  "results": { "bindings": [ { "s": {"type":"uri","value":"…"}, "…": {} } ] } }
```

### 3.3 Query catalog / template reports — DataPlatform (→ `B12`, `B13`)

| Op | Method | Path | Notes |
| ---- | -------- | ------ | ------- |
| List catalog graphs | `GET` | `/dataplatform/proxy/default/sparql` | SPARQL `COUNT(?qry) WHERE ?qry a shui:SparqlQuery` grouped by `?graph` (+ `rdfs:label`). Queries live in **several** catalog graphs; this matches CMEM's own selector. Powers `getQueryCatalogs`. Verified: 4 catalogs on docker.localhost. |
| List queries | `GET` | `/dataplatform/api/querycatalog?contextGraph=<graph>` | Per-catalog-graph `{ payload: CatalogQuery[] }`; each `{ iri, labels[], descriptions[], queryText, queryTypes[] }`, `queryText` may contain `{{placeholder}}`. The node lists across all catalog graphs (or one) and tags each item with its `catalogGraph`. Powers `getCatalogQueries`. |
| Run report | `GET` | `/dataplatform/api/queries/reports/perform?queryIri=<iri>&substitutions=<json>&contextGraph=<g>` | `substitutions` is a **JSON-encoded map** of `placeholder → value`. Response is **`text/csv` only** (`406` otherwise). `perform` runs **any** catalog query by IRI. Parameter handover verified on docker.localhost. |

### 3.4 Authentication endpoint

Not declared in the specs. CMEM uses Keycloak; the standard token endpoint is
`{base}/auth/realms/cmem/protocol/openid-connect/token`. Realm name and host can differ per
deployment (`R4`), so the token URL is overridable (§4). DP declares `bearerAuth` (HTTP bearer
JWT); DI declares no scheme but production requires the same `Authorization: Bearer <jwt>`.

## 4. Authentication & credential design (→ `B2`, `B3`, `B4`)

Single credential `CorporateMemoryApi` supporting **both** OAuth2 flows
CMEM/Keycloak offer: **`client_credentials`** and **`password`**
(resource-owner). A `grantType` selector switches the relevant fields.

**Decision (`R1`):** ship a **custom token helper** rather than
`extends: ['oAuth2Api']`. n8n's generic OAuth2 grants are unreliable on
self-hosted n8n ([n8n#16857](https://github.com/n8n-io/n8n/issues/16857))
and awkward to exercise headlessly in the credential test. The custom
helper fetches and caches the JWT ourselves and handles both grants. The
`oAuth2Api` variant is kept as a documented `v.later` option (`B15`) to
adopt once upstream is fixed.

**Credential fields:**

| Field | Type | Default / notes |
| ------- | ------ | ----------------- |
| `grantType` — Grant Type | options | `client_credentials` (default) or `password`; controls which fields below are shown. |
| `baseUrl` — CMEM Base URL | string | e.g. `https://cmem.example.com` (trailing slash stripped in helper). |
| `clientId` — OAuth Client ID | string | required. |
| `clientSecret` — OAuth Client Secret | string (password) | required for `client_credentials`; optional for `password` (public Keycloak client). |
| `username` — Username | string | shown/required for the `password` grant only. |
| `password` — Password | string (password) | shown/required for the `password` grant only. |
| `tokenUrl` — OAuth Token URL | string | default `={{$credentials.baseUrl}}/auth/realms/cmem/protocol/openid-connect/token`; overridable (Keycloak may be a separate host/realm). |
| `diBaseUrl` — DataIntegration Base URL | string | optional override; default `={{$credentials.baseUrl}}/dataintegration`. |
| `dpBaseUrl` — DataPlatform Base URL | string | optional override; default `={{$credentials.baseUrl}}/dataplatform`. |

**Token flow (`getCmemToken` in `GenericFunctions.ts`):** `POST {tokenUrl}`
form-urlencoded. For `client_credentials`: `grant_type=client_credentials` with
`client_id`/`client_secret` in the body. For `password`: `grant_type=password`
plus `username`/`password` (and `client_id`, with `client_secret` when the client
is confidential). The token is cached in a module-level map keyed by
`grantType|clientId|username|tokenUrl`, refreshed ~30s before `expires_in`. The
**credential** calls `getCmemToken` from `preAuthentication` and injects the token
via `authenticate` as `Authorization: Bearer {{$credentials.sessionToken}}`. The
**node** calls `cmemApiRequest()`, which resolves the component base, attaches the
bearer token and uses `this.helpers.httpRequest`.

**Credential test (`B4`):** the credential ships a declarative `test` that GETs
`{dpBaseUrl}/userinfo` (DataPlatform); `preAuthentication` fetches the token and
`authenticate` injects the bearer, so both a failing token and an unreachable API
surface in the n8n credential dialog. The test `baseURL` is derived from
`$credentials.baseUrl` directly (not from `preAuthentication` output, which does
not propagate into the test request's URL expression — see `R3`).

## 5. Node model (→ `B5`, `B6`, `B10`, `B12`, `B13`)

**One node, `Corporate Memory`**, resource → operation dropdowns. All operations are
**programmatic** (`execute()` routes on resource+operation): the payload content-type/Accept matrix,
SPARQL row-flattening, and CSV parsing are clumsy declaratively and easier to unit-test in code.

| Resource | Operation | Endpoint | Key parameters |
| ---------- | ----------- | ---------- | ---------------- |
| Workflow | Execute | §3.1 sync | `projectId`/`taskId` (dropdowns via `getProjects`/`getWorkflows` loadOptions), `payloadType` (None/JSON/XML/CSV → `Content-Type`) + payload field, `resultFormat` (JSON/XML/CSV/N-Triples → `Accept`), `splitOutput`. |
| Workflow | Execute (Async) | §3.1 async | as above; `resultFormat` → `output:type`; emits `{ activityId, instanceId }`. |
| SPARQL | Select Query | §3.2 | `query` (multiline), `simplify` toggle, Options: `defaultGraphUri`/`namedGraphUri` (multi). |
| Query Catalog | List Queries | §3.3 list | `catalogGraph` (dropdown via `getQueryCatalogs`, default All); one item per saved query incl. its `catalogGraph`. |
| Query Catalog | Run Report | §3.3 perform | `catalogGraph` (scopes the picker), `queryIri` (dropdown via `getCatalogQueries`, depends on `catalogGraph`), `substitutions` (fixedCollection of name/value pairs + raw-JSON escape hatch), Options: `contextGraph`, `parseCsv` toggle. |

Shared: `Continue On Fail` support; CMEM error bodies mapped to `NodeApiError`.

## 6. Output data contracts (→ `B6`, `B11`, `B14`)

- **Workflow Execute:** `204`/no variable output → `{ executed: true, hasResult: false }`; JSON
  output → one item (or one per element when `splitOutput` and the result is an array);
  XML/CSV/N-Triples → `{ data: "<string>" }`.
- **Workflow Execute (Async):** `{ activityId, instanceId }`.
- **SPARQL Select:** one n8n item **per binding row**. `simplify` on → `{ var: value }` (string
  values, unbound vars omitted); off → `{ var: { type, value, datatype?, "xml:lang"? } }`. ASK →
  `{ boolean }`.
- **Run Report:** CSV parsed (quote/newline-aware, header row = keys) → one item per data row;
  `parseCsv` off → `{ csv: "<string>" }` (optionally binary using `fileName`).

## 7. Versioning strategy (→ `B5`)

- Node uses the versioned-node pattern from the start (`version: [1]`, `defaultVersion: 1`) so
  future breaking changes bump the node version without breaking saved workflows.
- **v1** ships the credential + `Workflow → Execute` (+ Async) to prove the auth path
  end-to-end. **v2** adds `SPARQL` and `Query Catalog` resources — purely **additive** (new options
  and `execute` branches), so only the package semver minor increments, not the node `version`.
- Package semver: `0.1.0` for v1 (pre-verification) → `1.0.0` once verified against a real CMEM.

## 8. Risks & open questions

| ID | Risk / question | Mitigation |
| ---- | ----------------- | ------------ |
| `R1` | n8n generic OAuth2 *clientCredentials* is buggy ([#16857](https://github.com/n8n-io/n8n/issues/16857)). | Custom token helper (§4); revisit `oAuth2Api` via `B15`. |
| `R2` | **Resolved.** `executeOnPayload` 415s without a body; `/api/workflow/result` returns `204` when a workflow has no variable output (verified on docker.localhost). | Use `/api/workflow/result` (sync) + `/api/workflow/executeAsync` (async); `204` ⇒ `{ executed, hasResult: false }`. |
| `R3` | **Resolved.** The DP user endpoint is `/dataplatform/userinfo` (verified on docker.localhost, returns the account); `/dataplatform/api/userinfo` 404s. Also: `preAuthentication` output does not reach the declarative test's `baseURL` expression. | Credential test GETs `/userinfo` with `baseURL` derived from `$credentials.baseUrl`. |
| `R4` | Keycloak realm/host may differ from `cmem` default. | Overridable `tokenUrl` (§4). |
| `R5` | **Addressed.** Report CSV quoting / newlines / escaped quotes. | Quote-aware `parseCsv` + unit tests (`B14`); verified on a 52-row report on docker.localhost. |
| `R6` | **Resolved.** License is **MIT** (confirmed with eccenca). | MIT — aligns with the n8n ecosystem and keeps Creator-Portal verification (`R7`) open. |
| `R7` | n8n verified-community-node requirements (no runtime deps, GitHub-Actions provenance publish). | Track in `B17`. |

## 9. Tooling, testing & dev workflow (→ `B1`, `B8`, `B9`, `B11`, `B14`)

Build/lint/dev/release tooling comes from the official **`@n8n/node-cli`** (the
`n8n-node` command), scaffolded via `npm create @n8n/node`; requires **Node.js
v22+**. A `Taskfile.yml` ([go-task](https://taskfile.dev)) wraps these as
operator-facing targets (`task deps | build | lint | dev | test | release`).

- **Lint:** `n8n-node lint` — bundles `eslint-plugin-n8n-nodes-base`
  (verification-grade) + prettier; `n8n-node lint --fix` to autofix.
- **Unit (jest + ts-jest, `nock`/stubbed `IExecuteFunctions`):** `getToken`
  caching/expiry & error mapping; SPARQL JSON→items flattening (simplify on/off,
  unbound vars) from a recorded fixture; `buildSubstitutions` (pairs → JSON map,
  escaping, raw-JSON override); CSV parser edge cases.
- **Manual / local dev:** `task dev` (`n8n-node dev`) runs n8n with the node
  hot-reloaded at `http://localhost:5678` — no `npm link` needed. Enter the
  credential, run the credential test, then a trivial
  `SELECT * WHERE {?s ?p ?o} LIMIT 1` against a real/staging CMEM.
- **CI:** PR → build + lint + test. Tag `v*` → `n8n-node release` → publish to
  npm **with provenance** (mandatory for community nodes from 2026-05-01; `B9`,
  `R7`).
