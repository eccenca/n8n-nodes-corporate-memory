# Spec — eccenca Corporate Memory n8n Community Node

> **Status & work tracking:** see [backlog.md](./backlog.md). Backlog items are referenced
> here as `B#`; risks/open questions as `R#`. The backlog is the single source of truth for
> what is done; this document is the stable reference for *what* and *why*.

## 1. Overview

[eccenca Corporate Memory (CMEM)](https://eccenca.com) is a knowledge-graph platform. This
package publishes an [n8n](https://n8n.io) **community node** so automation engineers can drive
CMEM from n8n workflows: execute CMEM data-integration workflows on a payload, run SPARQL SELECT
queries, and run saved (parameterized) catalog queries / "template reports".

- **Package name:** `@eccenca/n8n-nodes-corporate-memory`
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

## 4. Authentication & credential design (→ `B2`, `B3`, `B4`, `B19`)

> **v0.4 change (n8n Cloud verification feedback, `B19`–`B24`).** The credential now
> **extends n8n's built-in `oAuth2Api`** and pins the **`clientCredentials`** grant. n8n
> owns the token exchange, caching and refresh — the node performs **no** custom token
> handling. This replaces the v0.3 custom `getCmemToken` helper (`R1`) and drops the
> resource-owner **password** grant (`R8`). The text below describes the v0.4 design; the
> v0.3 custom-helper design is preserved in git history.

Single credential `CorporateMemoryOAuth2Api` (`name: 'corporateMemoryOAuth2Api'`,
displayName *eccenca Corporate Memory OAuth2 API*), `extends: ['oAuth2Api']`, grant
`clientCredentials` (CMEM service-account client). n8n injects
`Authorization: Bearer <token>` automatically for every request issued via
`httpRequestWithAuthentication('corporateMemoryOAuth2Api', …)`.

> **Naming (verification rule).** The lint rule `cred-class-oauth2-naming` requires any
> `oAuth2Api`-extending credential to carry an `OAuth2` marker, so the class/`name`/
> `displayName` were renamed from `CorporateMemoryApi`/`corporateMemoryApi` (v0.3). This is
> an additional reason v0.4 is breaking for saved credentials — they must be recreated.

**Why client-credentials only — password grant dropped (`R8`).** n8n's `oAuth2Api`
supports exactly three grants — `authorizationCode`, `clientCredentials`, `pkce`
(verified verbatim in upstream `OAuth2Api.credentials.ts`); there is **no** resource-owner
`password` grant. The username/password examples in the n8n `authenticate` docs are
*generic* authentication — injecting credential fields directly into each request (HTTP
Basic / header / query), **not** an OAuth2 token exchange. CMEM/Keycloak accept only a
Keycloak-issued `Authorization: Bearer <JWT>` (not HTTP Basic), so a password grant would
still require our own token-endpoint call — exactly what the reviewer asked us to remove.
The client-credentials service-account flow covers the automation use case, so the
password grant is dropped in v0.4.

**Credential definition (`extends: ['oAuth2Api']`):**

| Field | Source | Default / notes |
| ----- | ------ | --------------- |
| `grantType` | override → `hidden` | `clientCredentials`. |
| `accessTokenUrl` | override → `hidden` | The endpoint n8n actually uses. Derived via a ternary expression: the `tokenUrl` override when set, else `{baseUrl}/auth/realms/cmem/protocol/openid-connect/token` (trailing slash on `baseUrl` stripped with `.replace(/\/+$/, "")`). Hidden so it does **not** render at the top of the inherited block (see Field order). |
| `scope` | override → `hidden` | `''` (Keycloak issues a service-account token without scope). |
| `authentication` | override → `hidden` | `body` (send `client_id`/`client_secret` in the urlencoded token body — matches v0.3 behaviour). |
| `authQueryParameters` | override → `hidden` | `''`. `authUrl` is left to oAuth2Api, which hides it for the client-credentials grant. |
| `clientId` | override (in place) → visible | required. Kept overridden for the CMEM-specific description; stays in its inherited position. |
| `clientSecret` | override (in place) → visible | required (confidential service-account client). |
| `baseUrl` — **Base URL** | custom | required; e.g. `https://cmem.example.com`. Drives the derived URLs. |
| `tokenUrl` — **OAuth Token URL** | custom | **optional** override of the Keycloak token endpoint; empty default. Feeds `accessTokenUrl`. Editable for a non-default realm/host (`R4`). |
| `diBaseUrl` — DataIntegration Base URL | custom | optional override; node derives `{baseUrl}/dataintegration` when blank. |
| `dpBaseUrl` — DataPlatform Base URL | custom | optional override; node derives `{baseUrl}/dataplatform` when blank. |

**Field order (n8n constraint).** With `extends`, n8n adds the inherited `oAuth2Api`
properties first (in their fixed order; overrides stay in place) and **appends our custom
properties after them** (`mergeNodeProperties` `push`es new names — verified in upstream).
So a custom field **cannot precede the inherited fields** — "Base URL" cannot be the very
first field. To get the token URL to the **bottom**, the inherited `accessTokenUrl` is
`hidden` and re-exposed as the custom `tokenUrl` field. Rendered order:
Client ID · Client Secret · Send Additional Body Properties · Allowed HTTP Request Domains ·
**Base URL** · **OAuth Token URL** · DataIntegration Base URL · DataPlatform Base URL.

Removed vs v0.3: the `grantType` *options selector*, `username`, `password`, the hidden
`sessionToken`, and `preAuthentication` / `authenticate`. The v0.3 `tokenUrl` field is kept
but is now an *optional* override (empty default) feeding the hidden `accessTokenUrl`.

**Request path (`cmemApiRequest` in `GenericFunctions.ts`).** `getCmemToken`, the
module-level token cache (`tokenCache`, `clearCmemTokenCache`), `resolveTokenUrl` and
`buildTokenRequestBody` are **removed**. The request helpers follow the **idiomatic n8n
pattern** (cf. `Elasticsearch/GenericFunctions.ts`): they are written **`this`-based** —
`async function cmemApiRequest(this: IExecuteFunctions | ILoadOptionsFunctions, …)` (type alias
`CmemFunctions`) — read the credential internally via `this.getCredentials('corporateMemoryOAuth2Api')`
for base-URL resolution (`resolveComponentBaseUrl`, `normalizeBaseUrl` stay), and issue the
call via `this.helpers.httpRequestWithAuthentication.call(this, 'corporateMemoryOAuth2Api',
options)`, so n8n applies (and refreshes) the OAuth2 token. `listQueryCatalogGraphs` /
`listCatalogQueries` are likewise `this`-based and chain via `cmemApiRequest.call(this, …)`.
Callers (the node's `execute` and the four `loadOptions`) invoke them with `.call(this, …)` and
no longer pre-fetch credentials or thread a custom requester — the node is purely
parameters + routing.

> **Why `.call(this, …)` (gotcha).** n8n's `httpRequestWithAuthentication` reads `this` (it calls
> `this.getNode()` and resolves the credential off the node context). Invoking it as a bare
> `helpers.method(…)` leaves `this` as the `helpers` object and fails loadOptions with *"this.getNode
> is not a function"* (the credential test uses a different code path and is unaffected). The
> earlier custom `CmemRequester` structural type is dropped in favour of the standard
> `IExecuteFunctions | ILoadOptionsFunctions` context.

`CorporateMemoryCredentials` narrows to `{ baseUrl; clientId?; clientSecret?; diBaseUrl?;
dpBaseUrl? }` (read only for base-URL resolution; the token is n8n's concern).

**Credential test (`B4`):** unchanged in intent — a declarative `test` that GETs
`{dpBaseUrl}/userinfo`. With `oAuth2Api` + `clientCredentials`, n8n obtains the token for
the test automatically (no redirect), so the hidden `expirable` `sessionToken` and
`preAuthentication` workaround (`R3`) are no longer needed.

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

**Error detail surfacing (`cmemApiRequest`).** On a failed request the helper recovers CMEM's
own error body and rethrows a `NodeApiError` whose **message** is the CMEM detail (e.g. the
missing report parameters), instead of n8n's generic *"Bad request – please check your
parameters"*. Two n8n behaviours make this necessary: (1) n8n only mines a *parsed object* body
for a message — the Run Report path uses `Accept: text/csv` / `parseJson:false`, so CMEM's JSON
error arrives as an unparsed **string** that the default extractor skips; and (2) for a 4xx,
n8n overwrites the headline with its generic status message and demotes any detail to the
(hidden) description. So the helper parses the body (handling RFC-7807 `title`/`detail`,
`message`, `error_description`, `errors[]`), and passes the extracted string as the explicit
`message`. **Body location:** n8n wraps the failure in a `NodeApiError` whose `.cause` is the
underlying axios/legacy error; on the OAuth2 path that error carries the body on **`.error`**
(its `.response` is stripped of `data`) and its `.message` is `"<status> - <json>"`. The helper
therefore looks at `.error`/`.response.data`/`.response.body`/`.body`/`.data` on both the error
and its `.cause`, and finally parses the JSON tail of the message. A compact-JSON fallback
ensures something useful shows even for an unexpected field name. When nothing readable is found
(e.g. a network error) it rethrows unchanged. The node catch tags the resulting `NodeApiError`
with `itemIndex` (construction is idempotent, so the enriched message is preserved).

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
- **v0.4** (`B19`–`B24`) is the auth refactor onto `oAuth2Api` for n8n Cloud verification.
  It is **breaking for existing saved credentials** (grant selector + username/password
  removed; users re-enter the credential), but the **node `version` stays `1`** — the change
  is in the credential, not the node interface. Package semver minor: `0.3.0` → `0.4.0`.

## 8. Risks & open questions

| ID | Risk / question | Mitigation |
| ---- | ----------------- | ------------ |
| `R1` | **Superseded (v0.4).** v0.3 shipped a custom token helper, citing buggy generic OAuth2 *clientCredentials* ([#16857](https://github.com/n8n-io/n8n/issues/16857)). n8n Cloud verification **requires** the built-in `oAuth2Api`. | Adopt `extends: ['oAuth2Api']` + `clientCredentials` (§4, `B19`); remove the custom helper. If the upstream bug bites on self-hosted, document the n8n version floor; Cloud (the verification target) is unaffected. |
| `R8` | Resource-owner **password** grant is not supported by `oAuth2Api` (grants: `authorizationCode`/`clientCredentials`/`pkce` only) and the docs' username/password `authenticate` examples are *generic* (Basic/header) auth, which CMEM rejects. | **Drop** the password grant in v0.4 (§4); client-credentials covers the automation use case. Reviewer invited a waiver request, but dropping is cleaner — note the rationale in the reviewer reply (`B24`). |
| `R2` | **Resolved.** `executeOnPayload` 415s without a body; `/api/workflow/result` returns `204` when a workflow has no variable output (verified on docker.localhost). | Use `/api/workflow/result` (sync) + `/api/workflow/executeAsync` (async); `204` ⇒ `{ executed, hasResult: false }`. |
| `R3` | **Resolved.** DP user endpoint is `/dataplatform/userinfo` (`/api/userinfo` 404s). n8n invokes `preAuthentication` **only** when the credential has a `hidden` `expirable` property; and the test `baseURL` resolves before `preAuthentication`. | Added hidden `expirable` `sessionToken`; `authenticate` injects it; test GETs `/userinfo` with `baseURL` from static `$credentials` fields. |
| `R4` | Keycloak realm/host may differ from `cmem` default. | Overridable `accessTokenUrl` (derived from `baseUrl`, editable) (§4). |
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
