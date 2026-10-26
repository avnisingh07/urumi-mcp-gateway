# Urumi MCP Gateway

## Multi-upstream MCP services (M4)

The gateway aggregates independent Streamable HTTP MCP upstreams; it does not
embed their tools. The currently available upstream endpoints are:

| Upstream | Local endpoint | Kubernetes endpoint |
| --- | --- | --- |
| WooCommerce | `http://127.0.0.1:3000/mcp` (existing port-forward) | `http://urumi-store-woocommerce-mcp.urumi.svc.cluster.local:3000/mcp` |
| Inventory | `http://127.0.0.1:3001/mcp` | `http://urumi-store-inventory-mcp.urumi.svc.cluster.local:3001/mcp` |
| Support | `http://127.0.0.1:3002/mcp` | `http://urumi-store-support-mcp.urumi.svc.cluster.local:3002/mcp` |

Inventory and Support also provide `GET /healthz` and `GET /readyz`. Their
initial tools are `inventory_status` and `support_status`, respectively; no
credentials or external service are required to run them.

Inventory additionally exposes `get_stock({ product_id })`, where `product_id`
is a positive integer. Known fixture IDs `101`, `102`, and `202` return a
deterministic `{ product_id, available, reserved, status }` record; other
positive IDs return the predictable MCP tool error
`{ "error": "not_found", "product_id": ... }`. Support additionally exposes
`get_order_support_summary({ order_id })`. Fixture IDs `202` and `203` return
`{ order_id, open_tickets, priority, next_action }`; other positive IDs return
the equivalent `not_found` error. These fixtures permit a cross-upstream demo:
use a WooCommerce product or order ID as the Inventory or Support input.

From the repository root, build once and start them in separate terminals:

```sh
npm run build --workspace @urumi/inventory-mcp
npm run start --workspace @urumi/inventory-mcp
```

```sh
npm run build --workspace @urumi/support-mcp
npm run start --workspace @urumi/support-mcp
```

To add local loopback upstreams explicitly, start a development-only gateway
with `UPSTREAM_DEVELOPMENT_ALLOW_PRIVATE=true`. This does not change existing
registrations automatically; then use an existing admin API key:

```sh
curl -X POST http://127.0.0.1:3100/api/upstreams \
  -H "Authorization: Bearer $ADMIN_API_KEY" -H 'Content-Type: application/json' \
  --data '{"name":"Inventory","url":"http://127.0.0.1:3001/mcp","timeoutMs":10000}'
curl -X POST http://127.0.0.1:3100/api/upstreams \
  -H "Authorization: Bearer $ADMIN_API_KEY" -H 'Content-Type: application/json' \
  --data '{"name":"Support","url":"http://127.0.0.1:3002/mcp","timeoutMs":10000}'
```

MCP Inspector should target `http://127.0.0.1:3100/mcp` with the existing API
key as a Bearer token. `tools/list` will show `inventory__inventory_status`,
`support__support_status`, and the enabled WooCommerce tools. Disabling an
upstream through `PATCH /api/upstreams/:id` with `{"enabled":false}` removes
its namespace immediately; discovery continues when any other upstream fails.

To build images and render or deploy the Helm release manually (these commands
do not register gateway upstreams), run:

```sh
docker build -f services/inventory-mcp/Dockerfile -t urumi-inventory-mcp:latest .
docker build -f services/support-mcp/Dockerfile -t urumi-support-mcp:latest .
helm dependency build deploy/helm/urumi
helm lint deploy/helm/urumi --values deploy/helm/urumi/values.yaml --values deploy/helm/urumi/values-local.yaml
helm template urumi-store deploy/helm/urumi --namespace urumi --values deploy/helm/urumi/values.yaml --values deploy/helm/urumi/values-local.yaml
helm upgrade --install urumi-store deploy/helm/urumi --namespace urumi --create-namespace --values deploy/helm/urumi/values.yaml --values deploy/helm/urumi/values-local.yaml --wait
```

The Inventory and Support Helm Services are always internal `ClusterIP`
Services. Build/load their images into the target cluster before the final
`helm upgrade`; this repository does not deploy or restart live workloads.

## Kubernetes Gateway, PostgreSQL, and dashboard scaffold (M7)

The same chart now deploys a persistent PostgreSQL StatefulSet, an internal-only
Gateway Service, and an internal dashboard Service. Gateway startup waits for
PostgreSQL readiness and then applies the idempotent gateway migration at
startup; it never drops or truncates existing state. The generated-once
`urumi-gateway-credentials` Secret holds the PostgreSQL password, full internal
database URL, and upstream-credential encryption key. Helm preserves that
Secret on upgrades with `lookup`; back up both its data and the PostgreSQL PVC
before any production upgrade or restore.

The dashboard Ingress is separate from the storefront. It currently serves the
existing empty placeholder application only—no login, API client, chat, or
working management UI has been added. Its Nginx deployment proxies future
browser `/api/` requests to the internal Gateway service, so the Gateway and
upstream MCP services do not need public Ingresses.

For local k3d, build and import the two new images before rendering or
deploying. Use the cluster's actual name in place of `urumi` if different:

```sh
docker build -f apps/gateway/Dockerfile -t urumi-gateway:latest .
docker build -f apps/dashboard/Dockerfile -t urumi-dashboard:latest .
k3d image import -c urumi urumi-gateway:latest urumi-dashboard:latest
```

Add the dashboard host alongside the existing storefront host:

```sh
sudo sh -c 'echo "127.0.0.1 dashboard.urumi.local" >> /etc/hosts'
```

Production-like `values-prod.yaml` uses registry image names, larger PostgreSQL
storage/resources, TLS-enabled dashboard ingress, and keeps
`UPSTREAM_DEVELOPMENT_ALLOW_PRIVATE=false`. Both environments permit only the
narrow Kubernetes service suffix (`*.svc.cluster.local`) for private upstream
addresses. Before a production deployment, either let the chart generate the
gateway Secret once or create it explicitly without committing values:

```sh
URUMI_POSTGRES_PASSWORD="$(openssl rand -hex 24)"
URUMI_GATEWAY_ENCRYPTION_KEY="$(openssl rand -base64 32)"
kubectl -n urumi create secret generic urumi-gateway-credentials \
  --from-literal=postgres-password="$URUMI_POSTGRES_PASSWORD" \
  --from-literal=database-url="postgresql://urumi_gateway:$URUMI_POSTGRES_PASSWORD@urumi-store-postgres:5432/urumi_gateway" \
  --from-literal=upstream-credential-encryption-key="$URUMI_GATEWAY_ENCRYPTION_KEY"
```

The generated hexadecimal database password is URL-safe and must match in both
Secret fields. Back up the PostgreSQL PVC/database and this Secret together. To
render without applying changes:

```sh
helm lint deploy/helm/urumi --values deploy/helm/urumi/values.yaml --values deploy/helm/urumi/values-local.yaml
sh scripts/verify-helm-template.sh
helm template urumi-store deploy/helm/urumi --namespace urumi --values deploy/helm/urumi/values.yaml --values deploy/helm/urumi/values-local.yaml
helm template urumi-store deploy/helm/urumi --namespace urumi --values deploy/helm/urumi/values.yaml --values deploy/helm/urumi/values-prod.yaml
```

## Local WooCommerce store (M1)

The M1 deployment uses the pinned Bitnami WordPress Helm chart with its bundled
MariaDB dependency. WordPress data and MariaDB data use separate persistent
volumes provided by the k3d cluster's `local-path` StorageClass. Credentials are
generated once by the Helm chart into the `urumi-store-credentials` Kubernetes
Secret; they are not stored in this repository or in Helm values files.

Prerequisites: the existing `urumi` k3d cluster, Helm, and Docker Desktop.

```sh
helm dependency build deploy/helm/urumi
helm upgrade --install urumi-store deploy/helm/urumi \
  --namespace urumi --create-namespace \
  --values deploy/helm/urumi/values.yaml \
  --values deploy/helm/urumi/values-local.yaml \
  --wait --timeout 15m
```

The k3d load balancer exposes Traefik on host port `8081`. Add this local-only
mapping once, then open `http://store.urumi.local:8081`:

```sh
sudo sh -c 'echo "127.0.0.1 store.urumi.local" >> /etc/hosts'
```

For a command-line check without changing `/etc/hosts`:

```sh
curl --resolve store.urumi.local:8081:127.0.0.1 http://store.urumi.local:8081/
```

Retrieve the WordPress administrator password only from the cluster when
needed; do not copy it into a committed file:

```sh
kubectl -n urumi get secret urumi-store-credentials \
  -o jsonpath='{.data.wordpress-password}' | base64 --decode; echo
```

Sign in at `http://store.urumi.local:8081/wp-admin/` with username `admin`.
WooCommerce is installed and activated during WordPress's first initialization.
Manual M1 checks still required: complete a cash-on-delivery test checkout,
confirm the resulting order in WooCommerce admin, and verify persistence across
the relevant pod restarts.

## WooCommerce MCP service (M2)

The custom WooCommerce MCP service exposes a Streamable HTTP endpoint at
`/mcp`, plus `GET /healthz` and `GET /readyz`. It is designed for an internal
Kubernetes `ClusterIP` Service only; do not create an Ingress, NodePort, or
LoadBalancer for it.

Required environment variables:

```text
WOOCOMMERCE_BASE_URL=http://urumi-store-wordpress.urumi.svc.cluster.local
WOOCOMMERCE_CONSUMER_KEY=<WooCommerce REST API consumer key>
WOOCOMMERCE_CONSUMER_SECRET=<WooCommerce REST API consumer secret>
```

Optional values are `PORT` (default `3000`) and
`WOOCOMMERCE_REQUEST_TIMEOUT_MS` (default `10000`, accepted range 100–30000).
Create the REST key in WooCommerce admin with the minimum required read/write
permission, then mount it into the MCP workload from a dedicated Kubernetes
Secret. Do not add its values to Helm values, `.env.example`, source code,
tests, or logs.

## MCP gateway core (M3)

The gateway aggregates enabled Streamable HTTP upstreams behind one `/mcp`
endpoint. Gateway tool names are deterministic: the normalized upstream name,
then `__`, then the upstream tool name. For example, `Woo Commerce` exposing
`list_orders` becomes `woo_commerce__list_orders`. Upstream names that would
produce the same namespace are rejected, so a collision is never silently
overwritten.

`GatewayCore` accepts an `UpstreamRepository`; the current in-memory adapter is
the M3 backend seam for registration, editing, enable/disable, and removal.
The later persistent admin backend should implement the same interface. Its
public configuration helper excludes credentials. `createGatewayMcpHandler`
requires an authentication function and denies requests by default: wire the
existing API-key verifier into that parameter when it is available. Gateway
credentials are not forwarded upstream; only an upstream's own optional static
credential is sent.

Each enabled upstream is queried independently during discovery. Failed or
timed-out upstreams are omitted while healthy tools remain available. Tool
arguments are checked against the upstream's advertised JSON Schema before a
call is forwarded. Disabled upstreams are removed from discovery and rejected
at call time even if a client has an older tool list.

The gateway uses HTTP POST JSON-RPC compatible with stateless Streamable HTTP
servers, including the existing WooCommerce MCP endpoint. Its timeout is
configured per upstream (`100`–`30000` ms); errors returned downstream are
sanitized and never include URLs, response bodies, or credentials.

## Persistent gateway state and API keys (M5)

The gateway persists users, scrypt-hashed API keys, encrypted upstream credentials, upstream state, and redacted audit metadata in PostgreSQL. The gateway applies `apps/gateway/migrations/001_gateway_state.sql` at startup. Use a database role restricted to the gateway database.

For local development, create an empty PostgreSQL database, export `DATABASE_URL` and a freshly generated `UPSTREAM_CREDENTIAL_ENCRYPTION_KEY` (the `.env.example` is a reference only), then run `npm run build`. Create the first administrator exactly once with `npm run bootstrap-admin --workspace @urumi/gateway -- admin`; save its one-time stdout value in a password manager, then start with `npm run start --workspace @urumi/gateway`. Keep the encryption key in a secret manager or Kubernetes Secret; it is required to read stored upstream credentials.

Management routes use `Authorization: Bearer <API key>`. Only admins can use `/api/users`, `/api/keys`, `/api/upstreams`, and `/api/audit`; members may call `/mcp` and view `/api/status`. A raw key is returned only by `POST /api/users/:id/keys`; the database stores only its salted hash.

## Upstream URL policy and health

Upstream registration accepts only HTTP(S) URLs without embedded credentials.
The gateway resolves hostnames before create/update and rejects loopback, private,
link-local, multicast, unspecified, and cloud-metadata destinations by default.
Set `UPSTREAM_ALLOWED_HOSTS` to narrowly allow named internal services that resolve
to private addresses, for example `*.svc.cluster.local` in Kubernetes. For local
development only, `UPSTREAM_DEVELOPMENT_ALLOW_PRIVATE=true` permits private
addresses; do not use it in production. Metadata and link-local addresses remain
blocked.

Admins can poll `GET /api/upstreams/health`. Results include only the upstream ID,
name, enabled state, reachable/disabled state, tool count, timestamp, and a
sanitized error category. Checks use normal per-upstream timeouts, run independently,
and are coalesced/cached for five seconds to avoid polling storms.

Hostname resolution is repeated immediately before production upstream requests,
but the current Node `fetch` transport does not pin the validated address for the
TCP connection. A hostile DNS server could therefore rebind between validation and
connection. Deploy production gateways with trusted DNS and egress policy; address
pinning/custom connection dispatch is a remaining hardening task.

## Server-side chat API (M8)

`POST /api/chat` is a non-streaming API-key-authenticated backend contract for
the future dashboard. It derives the caller only from `Authorization: Bearer
<gateway API key>`; a user ID in the body is neither accepted nor used. Both
admins and members may chat, while every tool invocation follows the existing
GatewayCore discovery, validation, routing, disable checks, timeout handling,
and audit attribution path.

```json
{"message":"Check stock for product 101","history":[{"role":"user","content":"Earlier question"}]}
```

The response is `{ "message", "traces", "status" }`. Each trace contains
only the gateway tool name, argument keys, status, duration, and a safe error
category—never raw tool output, API keys, upstream URLs, or credentials.
Messages are limited to 8,000 characters, history to 12 short messages, tool
results to 16,000 characters, and the loop to `CHAT_MAX_ITERATIONS`.

The supported provider is an OpenAI-compatible Chat Completions endpoint.
Set `CHAT_PROVIDER_BASE_URL`, `CHAT_PROVIDER_API_KEY`, and `CHAT_MODEL` on the
Gateway (plus optional `CHAT_TIMEOUT_MS` and `CHAT_MAX_ITERATIONS`). Provider
credentials remain server-side. If this configuration is incomplete,
`POST /api/chat` returns `503 {"error":"chat_unavailable"}`. The dashboard
is still a placeholder; this milestone does not provide browser login, chat UI,
or streaming.
