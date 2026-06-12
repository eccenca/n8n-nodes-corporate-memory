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
- **License:** Apache-2.0 (matches eccenca's [`cmemc`](https://github.com/eccenca/cmemc)) — see `R6`
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
|----|--------|------|-------|
| Execute (sync) | `POST` | `/dataintegration/workflow/workflows/{project}/{task}/executeOnPayload` | Request body `application/json` (object) **or** `application/xml` (string). Response `application/json` or `application/xml` (per `Accept`). Payload = workflow's variable **input**; response = variable **output**. Both optional. |
| Execute (async) | `POST` | `/dataintegration/workflow/workflows/{project}/{task}/executeOnPayloadAsynchronous` | `201` + `StartActivityResponse` body + `Location` header → `.../execution/{executionId}`. |
| Cancel | `DELETE` | `/dataintegration/workflow/workflows/{project}/{task}/execution/{executionId}` | `200` / `404`. |

> Open question `R2`: whether `executeOnPayload` requires the workflow to declare a variable
> **output** dataset, and the behavior when there is none (empty `200` vs `204`). Handle empty
> responses gracefully.

### 3.2 SPARQL SELECT — DataPlatform (→ `B10`, `B11`)

| Op | Method | Path | Notes |
|----|--------|------|-------|
| Select | `GET` | `/dataplatform/proxy/{id}/sparql?query=<sparql>` | Use `id` = `default`. Optional query params: `default-graph-uri` (repeatable), `named-graph-uri` (repeatable), `base64encoded`. Send `Accept: application/sparql-results+json` for SELECT. |

Response (SELECT) is the standard SPARQL JSON results shape:

```json
{ "head": { "vars": ["s", "p", "o"] },
  "results": { "bindings": [ { "s": {"type":"uri","value":"…"}, "…": {} } ] } }
```

### 3.3 Query catalog / template reports — DataPlatform (→ `B12`, `B13`)

| Op | Method | Path | Notes |
|----|--------|------|-------|
| List reports | `GET` | `/dataplatform/api/querycatalog` | Returns `CatalogQuery[]`: `{ iri, labels, queryText, queryTypes }`. Optional `langPref[]`, `contextGraph`. Powers a `loadOptions` dropdown. |
| Run report | `GET`/`POST` | `/dataplatform/api/queries/reports/perform?queryIri=<iri>&substitutions=<json>&contextGraph=<g>&fileName=<n>` | `substitutions` is a **JSON-encoded map** of `placeholder → value`; every placeholder in the saved query must be set. Response `text/csv`. Use `POST` when the substitutions map is large (URL length). |

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
|-------|------|-----------------|
| `grantType` — Grant Type | options | `client_credentials` (default) or `password`; controls which fields below are shown. |
| `baseUrl` — CMEM Base URL | string | e.g. `https://cmem.example.com` (trailing slash stripped in helper). |
| `clientId` — OAuth Client ID | string | required. |
| `clientSecret` — OAuth Client Secret | string (password) | required for `client_credentials`; optional for `password` (public Keycloak client). |
| `username` — Username | string | shown/required for the `password` grant only. |
| `password` — Password | string (password) | shown/required for the `password` grant only. |
| `tokenUrl` — OAuth Token URL | string | default `={{$credentials.baseUrl}}/auth/realms/cmem/protocol/openid-connect/token`; overridable (Keycloak may be a separate host/realm). |
| `diBaseUrl` — DataIntegration Base URL | string | optional override; default `={{$credentials.baseUrl}}/dataintegration`. |
| `dpBaseUrl` — DataPlatform Base URL | string | optional override; default `={{$credentials.baseUrl}}/dataplatform`. |

**Token flow (`GenericFunctions.getToken`):** `POST {tokenUrl}`
form-urlencoded. For `client_credentials`: `grant_type=client_credentials`
with HTTP Basic `clientId:clientSecret`. For `password`:
`grant_type=password&username=…&password=…` with `client_id` (and
`client_secret` when the client is confidential). Cache `{ token,
expiresAt }` in a module-level map keyed by `grantType|clientId|username|
tokenUrl`, refreshing ~30s before `expires_in`. `cmemApiRequest()`
resolves the component base, attaches `Authorization: Bearer`, and calls
`this.helpers.httpRequest` (we manage the token, so
`httpRequestWithAuthentication` is not needed).

**Credential test (`B4`):** node-level `methods.credentialTest` → `getToken` then `GET
{dpBaseUrl}/api/userinfo` (fallback `GET {diBaseUrl}/api/workflow/info`, `R3`). Map failures to
friendly messages distinguishing "token failed (check client id/secret/token URL)" from "token OK
but API unreachable (check base URL / base path)".

## 5. Node model (→ `B5`, `B6`, `B10`, `B12`, `B13`)

**One node, `Corporate Memory`**, resource → operation dropdowns. All operations are
**programmatic** (`execute()` routes on resource+operation): the payload content-type/Accept matrix,
SPARQL row-flattening, and CSV parsing are clumsy declaratively and easier to unit-test in code.

| Resource | Operation | Endpoint | Key parameters |
|----------|-----------|----------|----------------|
| Workflow | Execute | §3.1 sync | `projectId`, `taskId`, `payloadType` (None/JSON/XML → Content-Type), `payload` (hidden when None), `acceptType` (JSON/XML), `splitOutput` toggle. |
| Workflow | Execute Async | §3.1 async | as above; emits `{ executionId, location }`. |
| Workflow | Cancel | §3.1 cancel | `projectId`, `taskId`, `executionId`. |
| SPARQL | Select Query | §3.2 | `query` (multiline), `defaultGraphUri`/`namedGraphUri` (multi), `base64encoded` toggle, `simplify` toggle. |
| Query Catalog | List Reports | §3.3 list | optional `contextGraph`; one item per `CatalogQuery`. |
| Query Catalog | Run Report | §3.3 perform | `queryIri` (dropdown via `getCatalogQueries` loadOptions), `substitutions` (fixedCollection of `placeholder`/`value` pairs + raw-JSON escape hatch), optional `contextGraph`/`fileName`, `parseCsv` toggle. |

Shared: `Continue On Fail` support; CMEM error bodies mapped to `NodeApiError`.

## 6. Output data contracts (→ `B6`, `B11`, `B14`)

- **Workflow Execute:** JSON response → one item (or split when an array, if `splitOutput`); XML
  response → `{ data: "<xml…>" }`; empty output → `{}`.
- **Workflow Execute Async:** `{ executionId, location }` (parsed from body + `Location` header).
- **SPARQL Select:** one n8n item **per binding row**. `simplify` on → `{ var: value }` (string
  values, unbound vars omitted/`null`); off → `{ var: { type, value, datatype?, "xml:lang"? } }`.
  Carries `head.vars` for column order where useful.
- **Run Report:** CSV parsed (quote/newline-aware, header row = keys) → one item per data row;
  `parseCsv` off → `{ csv: "<string>" }` (optionally binary using `fileName`).

## 7. Versioning strategy (→ `B5`)

- Node uses the versioned-node pattern from the start (`version: [1]`, `defaultVersion: 1`) so
  future breaking changes bump the node version without breaking saved workflows.
- **v1** ships the credential + `Workflow → Execute` (+ Async/Cancel) to prove the auth path
  end-to-end. **v2** adds `SPARQL` and `Query Catalog` resources — purely **additive** (new options
  + new `execute` branches), so only the package semver minor increments, not the node `version`.
- Package semver: `0.1.0` for v1 (pre-verification) → `1.0.0` once verified against a real CMEM.

## 8. Risks & open questions

| ID | Risk / question | Mitigation |
|----|-----------------|------------|
| `R1` | n8n generic OAuth2 *clientCredentials* is buggy ([#16857](https://github.com/n8n-io/n8n/issues/16857)). | Custom token helper (§4); revisit `oAuth2Api` via `B15`. |
| `R2` | Does `executeOnPayload` require a variable output dataset? Empty-result behavior? | Verify on a real workflow; handle empty `200`/`204` gracefully. |
| `R3` | DP `/api/userinfo` path may vary per deployment (used in credential test). | DI `/api/workflow/info` fallback. |
| `R4` | Keycloak realm/host may differ from `cmem` default. | Overridable `tokenUrl` (§4). |
| `R5` | Report CSV quoting / newlines / encoding edge cases. | Quote-aware parser + unit fixtures (`B14`). |
| `R6` | License: Apache-2.0 vs MIT. | Default Apache-2.0; confirm with eccenca. |
| `R7` | n8n verified-community-node requirements (no runtime deps, GitHub-Actions provenance publish). | Track in `B17`. |

## 9. Testing strategy (→ `B8`, `B9`, `B11`, `B14`)

- **Lint:** `eslint-plugin-n8n-nodes-base` (community config) + a stricter prepublish config gated
  in `prepublishOnly`.
- **Unit (jest + ts-jest, `nock`/stubbed `IExecuteFunctions`):** `getToken` caching/expiry & error
  mapping; SPARQL JSON→items flattening (simplify on/off, unbound vars) from a recorded fixture;
  `buildSubstitutions` (pairs → JSON map, escaping, raw-JSON override); CSV parser edge cases.
- **Manual / local dev:** `npm run build` → `npm link` → link into `~/.n8n/custom`, restart n8n;
  enter credential, run credential test, then a trivial `SELECT * WHERE {?s ?p ?o} LIMIT 1` against
  a real/staging CMEM.
- **CI:** PR → build + lint + test. Tag `v*` → build + lint + test + `npm publish --provenance`
  (`B9`, `R7`).
