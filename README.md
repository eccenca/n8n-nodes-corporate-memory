# @eccenca/n8n-nodes-corporate-memory

An [n8n](https://n8n.io) community node for
[eccenca Corporate Memory (CMEM)](https://eccenca.com).

Provides a Corporate Memory credential (OAuth2 **client-credentials** grant, via
n8n's built-in OAuth2) and a **Corporate Memory** node with three resources:
**Workflow** (execute DataIntegration workflows), **SPARQL** (SELECT/ASK queries),
and **Query Catalog** (list and run saved, parameterized queries). See
[tasks/spec.md](tasks/spec.md) and [tasks/backlog.md](tasks/backlog.md).

[Installation](#installation) · [Credentials](#credentials) ·
[Operations](#operations) · [Development](#development)

## Installation

In a self-hosted n8n: **Settings → Community Nodes → Install** and enter
`@eccenca/n8n-nodes-corporate-memory`. See the n8n docs on
[installing community nodes](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

Create an **eccenca Corporate Memory OAuth2 API** credential. It extends n8n's
built-in OAuth2 and uses the **client-credentials** grant, so n8n obtains, caches
and refreshes the access token for you (no interactive sign-in).

| Field | Notes |
| ----- | ----- |
| Client ID | OAuth2 client (e.g. the cmemc service-account client) |
| Client Secret | client secret of the (confidential) service-account client |
| Base URL | e.g. `https://cmem.example.com` (trailing slash optional) |
| OAuth Token URL | optional; leave empty to derive `{Base URL}/auth/realms/cmem/protocol/openid-connect/token`; set it for a non-default Keycloak realm or host |
| DataIntegration / DataPlatform Base URL | optional overrides; default to `{Base URL}/dataintegration` and `{Base URL}/dataplatform` |

> Field order follows n8n's OAuth2 credential layout: the inherited fields (Client ID,
> Client Secret, plus *Send Additional Body Properties* and *Allowed HTTP Request Domains*)
> render first, then the CMEM-specific fields.

Use **Test** in the credential dialog to verify the token can be obtained and the
DataPlatform API is reachable.

> The resource-owner **password** grant is not offered: n8n's built-in OAuth2
> supports only the `authorizationCode`, `clientCredentials` and `pkce` grants, and
> the client-credentials service-account flow covers the automation use case.

## Operations

### Resource: Workflow

Project and Workflow are searchable dropdowns populated from your instance.

- **Execute** — run a workflow synchronously (`POST /api/workflow/result/…`),
  optionally with a payload. Pick the **Payload** content type (None / JSON / XML /
  CSV) and the **Result Format** (JSON / XML / CSV / N-Triples) independently — they
  need not match. A workflow with no variable output returns
  `{ executed: true, hasResult: false }`; a JSON array result can be split into one
  item per element.
- **Execute (Async)** — start a workflow execution
  (`POST /api/workflow/executeAsync?output:type=…`); returns `{ activityId, instanceId }`.

### Resource: SPARQL

- **Select Query** — run a SPARQL SELECT/ASK (`GET /proxy/default/sparql`) and get
  one item per result row. **Simplify** returns just each variable's value; off
  returns the full binding object (type, value, datatype, language). Optional
  default/named graph URIs.

### Resource: Query Catalog

Queries live in one or more catalog graphs; a **Catalog Graph** dropdown (default
*All Catalogs*) scopes the picker, mirroring CMEM's own catalog selector.

- **List Queries** — list saved queries across the selected catalog(s); each item
  carries its source `catalogGraph`.
- **Run Report** — execute a saved query by IRI with **parameter substitutions**
  (`{{placeholder}}` → value) and get the CSV result parsed into items
  (`GET /api/queries/reports/perform`); toggle off to return the raw CSV string.

## Development

Requires **Node.js v22+**. Tooling is provided by
[`@n8n/node-cli`](https://www.npmjs.com/package/@n8n/node-cli); a
[`Taskfile.yml`](Taskfile.yml) ([go-task](https://taskfile.dev)) wraps the
lifecycle.

```bash
task deps     # install dependencies
task dev      # run a local n8n with the node hot-reloaded (http://localhost:5678)
task test     # jest unit tests
task lint     # n8n-node lint (verification-grade)
task build    # compile + copy icons into dist/
task check    # lint + test + build (the CI gates)
```

The equivalent npm scripts (`npm run dev|test|lint|build`) work too. Without
go-task, run the npm scripts directly.

Manual end-to-end check: `task dev`, add the Corporate Memory credential, run its
**Test**, then add a **Corporate Memory** node and execute a known workflow.

## CI & publishing

[`.gitlab-ci.yml`](.gitlab-ci.yml) runs lint + test + build on merge requests and
branches, and publishes to npm (with provenance) on `v*` tags. Publishing needs an
`NPM_TOKEN` CI/CD variable; npm provenance becomes mandatory for community nodes
from 2026-05-01.

## License

[MIT](LICENSE).
