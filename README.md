# n8n-nodes-eccenca-corporate-memory

An [n8n](https://n8n.io) community node for
[eccenca Corporate Memory (CMEM)](https://eccenca.com).

This is **v1**: a Corporate Memory credential (OAuth2 client-credentials **and**
password grants) and a **Corporate Memory** node that executes DataIntegration
workflows. SPARQL SELECT queries and query-catalog "template reports" are planned
for v2 — see [tasks/backlog.md](tasks/backlog.md).

[Installation](#installation) · [Credentials](#credentials) ·
[Operations](#operations) · [Development](#development)

## Installation

In a self-hosted n8n: **Settings → Community Nodes → Install** and enter
`n8n-nodes-eccenca-corporate-memory`. See the n8n docs on
[installing community nodes](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

Create a **Corporate Memory API** credential:

| Field | Notes |
| ----- | ----- |
| Grant Type | `Client Credentials` (default) or `Password` |
| CMEM Base URL | e.g. `https://cmem.example.com` (no trailing slash) |
| Client ID | OAuth2 client (e.g. the cmemc service-account client) |
| Client Secret | required for client credentials; optional for a public password-grant client |
| Username / Password | shown for the password grant only |
| OAuth Token URL | optional override; defaults to `{Base URL}/auth/realms/cmem/protocol/openid-connect/token` |
| DataIntegration / DataPlatform Base URL | optional overrides; default to `{Base URL}/dataintegration` and `{Base URL}/dataplatform` |

Use **Test** in the credential dialog to verify the token can be obtained and the
DataPlatform API is reachable.

## Operations

### Resource: Workflow

- **Execute** — run a workflow synchronously on an optional payload
  (`POST .../executeOnPayload`). Choose the payload type (None / JSON / XML) and
  the result format (JSON / XML). Optionally split a JSON array result into one
  item per element.
- **Execute (Async)** — start a workflow execution
  (`POST .../executeOnPayloadAsynchronous`); returns `{ executionId, location }`.
- **Cancel** — cancel a running execution (`DELETE .../execution/{executionId}`).

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

[MIT](LICENSE). Note: the license is provisional — if eccenca pursues n8n's
verified-community-node program, MIT matches the n8n ecosystem; an internal-only
node could instead use Apache-2.0 to match `cmemc`. See risk `R6` in
[tasks/spec.md](tasks/spec.md).
