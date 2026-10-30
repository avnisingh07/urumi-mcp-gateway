# Urumi MCP Gateway

A Kubernetes-deployed, multi-upstream Model Context Protocol (MCP)
Gateway. It exposes independent Streamable HTTP MCP services through one
authenticated endpoint and provides tool discovery/routing, API-key
authentication, role-based access control, persistent configuration,
upstream health handling, and audit metadata.

> **Verified status:** The local k3d deployment was tested through an
> external MCP Inspector client. MCP initialization, User B API-key
> authentication, tool discovery, and tool execution across the
> configured upstreams were verified. Tests not yet run are explicitly
> marked pending below.

## Contents

-   [Overview](#overview)
-   [Architecture](#architecture)
-   [Capabilities](#capabilities)
-   [Technology stack](#technology-stack)
-   [Repository layout](#repository-layout)
-   [Prerequisites](#prerequisites)
-   [Local development](#local-development)
-   [Kubernetes deployment](#kubernetes-deployment)
-   [External MCP client connection](#external-mcp-client-connection)
-   [Upstream services and tools](#upstream-services-and-tools)
-   [Authentication and
    authorization](#authentication-and-authorization)
-   [Gateway API](#gateway-api)
-   [Health and failure handling](#health-and-failure-handling)
-   [Testing and verification](#testing-and-verification)
-   [Security considerations](#security-considerations)
-   [Known limitations and remaining
    tests](#known-limitations-and-remaining-tests)
-   [Demo evidence](#demo-evidence)

## Overview

The Gateway aggregates independent Streamable HTTP MCP servers without
embedding their tools. It discovers tools from enabled upstreams,
namespaces them to prevent collisions, validates arguments against
advertised JSON Schemas, and forwards calls to the owning upstream.

Configured upstreams:

1.  **WooCommerce MCP** --- product and order operations backed by the
    local WooCommerce store.
2.  **Inventory MCP** --- inventory status and stock lookup.
3.  **Support MCP** --- support status and order-support summaries.

An MCP client connects to one Gateway endpoint rather than configuring
each upstream separately.

## Architecture

``` text
                 External MCP Client
                    MCP Inspector
                         |
              Streamable HTTP + API key
                         |
                         v
               Local NGINX proxy
                         |
                 Host: gateway.urumi.local
                         |
                         v
                  Traefik Ingress
                         |
                         v
                    MCP Gateway
                   /     |      \
                  v      v       v
            WooCommerce Inventory Support
                 MCP      MCP      MCP
                  |        |        |
                  v        v        v
              WordPress Inventory Support
               + MariaDB  service  service

                    PostgreSQL
                Gateway persistent state
```

PostgreSQL stores Gateway users, API-key hashes, upstream registrations,
encrypted upstream credentials, and redacted audit metadata. WooCommerce
uses WordPress and MariaDB. Inventory and Support are independent MCP
services.

### Kubernetes components

  -------------------------------------------------------------------------------
  Component               Kubernetes service/workload     Responsibility
  ----------------------- ------------------------------- -----------------------
  Gateway                 `urumi-store-gateway`           Aggregation,
                                                          authentication,
                                                          discovery and routing

  WooCommerce MCP         `urumi-store-woocommerce-mcp`   Commerce tools

  Inventory MCP           `urumi-store-inventory-mcp`     Inventory tools

  Support MCP             `urumi-store-support-mcp`       Support tools

  PostgreSQL              `urumi-store-postgres`          Gateway persistence

  WordPress               `urumi-store-wordpress`         WooCommerce application

  MariaDB                 `urumi-store-mariadb`           WordPress database

  Dashboard               `urumi-store-dashboard`         Dashboard application
  -------------------------------------------------------------------------------

The Gateway and upstream MCP services use internal Kubernetes Services.
External MCP access in the local development environment is routed
through NGINX and Traefik.

## Capabilities

-   Aggregate independent Streamable HTTP MCP upstreams behind one
    `/mcp` endpoint.
-   Discover enabled upstream tools independently.
-   Namespace tools as `<normalized_upstream_name>__<tool_name>`.
-   Reject namespace collisions.
-   Validate tool arguments against upstream-advertised JSON Schemas.
-   Route calls to the owning upstream.
-   Authenticate API keys and enforce admin/member permissions.
-   Store scrypt-hashed API keys and encrypted upstream credentials.
-   Persist Gateway state in PostgreSQL.
-   Register, edit, enable, disable, and remove upstreams through admin
    APIs.
-   Apply per-upstream timeouts and preserve healthy upstream tools when
    another upstream is unavailable.
-   Record redacted audit metadata.

## Technology stack

  Layer                          Technologies
  ------------------------------ ---------------------------------
  Runtime and language           Node.js, TypeScript
  MCP transport                  Streamable HTTP
  API                            HTTP, JSON-RPC
  Persistence                    PostgreSQL
  Commerce                       WordPress, WooCommerce, MariaDB
  Containers                     Docker
  Orchestration                  Kubernetes, k3d
  Packaging                      Helm
  Ingress                        Traefik
  Local proxy                    NGINX
  External client verification   MCP Inspector

## Repository layout

``` text
apps/
  gateway/                 # MCP Gateway and database migrations
  dashboard/               # Dashboard application

services/
  woocommerce-mcp/         # WooCommerce MCP service
  inventory-mcp/           # Inventory MCP service
  support-mcp/              # Support MCP service

deploy/
  helm/
    urumi/                  # Helm chart and environment values

docs/
  api-contracts.md          # HTTP and MCP API contracts

scripts/
  verify-helm-template.sh   # Helm rendering verification
```

Use the checked-in repository tree as the source of truth if directory
names differ in your branch.

## Prerequisites

-   Docker Desktop
-   k3d
-   kubectl
-   Helm
-   Node.js and npm

The Kubernetes commands below assume a k3d cluster named `urumi` and
namespace `urumi`.

## Local development

### Start Inventory MCP

From the repository root:

``` sh
npm run build --workspace @urumi/inventory-mcp
npm run start --workspace @urumi/inventory-mcp
```

### Start Support MCP

In a separate terminal:

``` sh
npm run build --workspace @urumi/support-mcp
npm run start --workspace @urumi/support-mcp
```

Inventory and Support expose Streamable HTTP at `/mcp`, plus
`GET /healthz` and `GET /readyz`.

Initial tools:

-   Inventory: `inventory_status`
-   Support: `support_status`

Inventory also exposes `get_stock({ product_id })`. Fixture IDs `101`,
`102`, and `202` return deterministic stock records; other positive IDs
return a predictable `not_found` tool error.

Support also exposes `get_order_support_summary({ order_id })`. Fixture
IDs `202` and `203` return deterministic support summaries; other
positive IDs return a predictable `not_found` error.

### Register local loopback upstreams

For local loopback upstreams, run a development-only Gateway with:

``` sh
UPSTREAM_DEVELOPMENT_ALLOW_PRIVATE=true
```

Then register upstreams using an existing administrator key:

``` sh
curl -X POST http://127.0.0.1:3100/api/upstreams \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"name":"Inventory","url":"http://127.0.0.1:3001/mcp","timeoutMs":10000}'

curl -X POST http://127.0.0.1:3100/api/upstreams \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"name":"Support","url":"http://127.0.0.1:3002/mcp","timeoutMs":10000}'
```

These commands are local-development examples and do not register
upstreams in a Kubernetes release automatically.

## Kubernetes deployment

### Build and import images

Build and import the images required by the chart and local values:

``` sh
docker build -f apps/gateway/Dockerfile -t urumi-gateway:latest .
docker build -f apps/dashboard/Dockerfile -t urumi-dashboard:latest .
docker build -f services/inventory-mcp/Dockerfile -t urumi-inventory-mcp:latest .
docker build -f services/support-mcp/Dockerfile -t urumi-support-mcp:latest .

k3d image import -c urumi \
  urumi-gateway:latest \
  urumi-dashboard:latest \
  urumi-inventory-mcp:latest \
  urumi-support-mcp:latest
```

Ensure the WooCommerce MCP image and all other chart images are
available to the cluster as configured.

### Validate and render Helm templates

``` sh
helm dependency build deploy/helm/urumi

helm lint deploy/helm/urumi \
  --values deploy/helm/urumi/values.yaml \
  --values deploy/helm/urumi/values-local.yaml

sh scripts/verify-helm-template.sh

helm template urumi-store deploy/helm/urumi \
  --namespace urumi \
  --values deploy/helm/urumi/values.yaml \
  --values deploy/helm/urumi/values-local.yaml
```

Render production-like values without applying them:

``` sh
helm template urumi-store deploy/helm/urumi \
  --namespace urumi \
  --values deploy/helm/urumi/values.yaml \
  --values deploy/helm/urumi/values-prod.yaml
```

### Install or upgrade

Run an upgrade only after images, values, and required Secrets are
ready:

``` sh
helm upgrade --install urumi-store deploy/helm/urumi \
  --namespace urumi \
  --create-namespace \
  --values deploy/helm/urumi/values.yaml \
  --values deploy/helm/urumi/values-local.yaml \
  --wait \
  --timeout 15m
```

Inspect deployment state:

``` sh
kubectl get pods -n urumi
kubectl get services -n urumi
kubectl get ingress -n urumi
```

Inventory and Support are internal `ClusterIP` Services. Do not expose
upstream MCP services directly through public Ingresses, NodePorts, or
LoadBalancers.

### Persistent state and Secrets

The chart deploys PostgreSQL as a persistent StatefulSet. Gateway
startup waits for PostgreSQL readiness and applies the idempotent
migration. The migration does not drop or truncate existing state.

The `urumi-gateway-credentials` Secret holds the PostgreSQL password,
database URL, and upstream-credential encryption key. Helm preserves the
Secret on upgrades using `lookup`. Back up PostgreSQL data and this
Secret together.

Never commit API keys, database passwords, WooCommerce consumer
credentials, provider credentials, or encryption keys.

### Fresh-install provisioning

For a brand-new database, the explicit `provision-initial-state` command
creates the initial administrator and WooCommerce, Inventory, and
Support registrations. It is deliberately not run automatically by the
Gateway process.

Generate an API key outside the repository and store it securely before
provisioning:

``` sh
export GATEWAY_INITIAL_ADMIN_USERNAME=admin
export GATEWAY_INITIAL_ADMIN_API_KEY="urumi_$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
export GATEWAY_INITIAL_WOOCOMMERCE_URL=http://127.0.0.1:3000/mcp
export GATEWAY_INITIAL_INVENTORY_URL=http://127.0.0.1:3001/mcp
export GATEWAY_INITIAL_SUPPORT_URL=http://127.0.0.1:3002/mcp

npm run provision-initial-state --workspace @urumi/gateway
```

The command stores only the scrypt hash. It is transactional and creates
initial state only if the user and upstream tables are empty. A rerun
with matching configuration is a no-op; conflicting existing state fails
without changing users, keys, credentials, or registrations.

For Helm, the provisioning Job is disabled by default. For a fresh
release only, create an operator-managed Secret containing the initial
username and raw key, then enable `gateway.initialProvisioning.enabled`
and set `gateway.initialProvisioning.existingSecret`. Protect the Secret
until the administrator has securely retrieved the key. After successful
provisioning, disable/remove the one-time Job and delete the
initial-admin Secret. Do not enable this Job for an existing database
unless its state matches the documented initial configuration.

### WooCommerce store

The local M1 deployment uses the pinned Bitnami WordPress Helm chart
with its MariaDB dependency. WordPress and MariaDB use separate
persistent volumes backed by the k3d `local-path` StorageClass.

``` sh
helm dependency build deploy/helm/urumi

helm upgrade --install urumi-store deploy/helm/urumi \
  --namespace urumi \
  --create-namespace \
  --values deploy/helm/urumi/values.yaml \
  --values deploy/helm/urumi/values-local.yaml \
  --wait \
  --timeout 15m
```

The local storefront was configured at:

``` text
http://store.urumi.local:8081
```

Add the hosts entry if required by your local cluster setup:

``` sh
sudo sh -c 'echo "127.0.0.1 store.urumi.local" >> /etc/hosts'
```

Retrieve the WordPress administrator password from the Kubernetes Secret
only when needed:

``` sh
kubectl -n urumi get secret urumi-store-credentials \
  -o jsonpath='{.data.wordpress-password}' | base64 --decode
echo
```

WooCommerce is installed and activated during WordPress initialization.

The WooCommerce MCP service exposes `/mcp`, `GET /healthz`, and
`GET /readyz`. It is intended to be reached internally through a
Kubernetes `ClusterIP` Service.

Required environment variables:

``` text
WOOCOMMERCE_BASE_URL=http://urumi-store-wordpress.urumi.svc.cluster.local
WOOCOMMERCE_CONSUMER_KEY=<WooCommerce REST API consumer key>
WOOCOMMERCE_CONSUMER_SECRET=<WooCommerce REST API consumer secret>
```

Create REST credentials with the minimum required permissions and mount
them from a dedicated Kubernetes Secret. Do not place them in Helm
values, `.env.example`, source code, tests, or logs.

## External MCP client connection

The Gateway exposes one MCP endpoint:

``` text
/mcp
```

### MCP Inspector: deployed local environment

Use these settings in MCP Inspector:

  Setting        Value
  -------------- ---------------------------------
  Transport      Streamable HTTP
  URL            `http://gateway.urumi.test/mcp`
  Header         `Authorization`
  Header value   `Bearer <USER_API_KEY>`

Use the API key belonging to the user being tested. Do not commit or
share raw keys.

The `.test` hostname is a local development alias. The local NGINX proxy
listens on host port `80` and forwards to the k3d node's Traefik
endpoint. The Kubernetes Ingress rule expects `gateway.urumi.local`;
therefore, the proxy must send that host header upstream.

Tested local NGINX configuration:

``` nginx
server {
  listen 80;

  location / {
    proxy_pass http://172.18.0.3:80;
    proxy_set_header Host gateway.urumi.local;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

The node IP and proxy configuration are environment-specific. Adjust
them for another k3d cluster. This is a local development arrangement,
not a production ingress design.

The local hosts entry for the Inspector URL is:

``` text
127.0.0.1 gateway.urumi.test
```

The Ingress host remains `gateway.urumi.local`; NGINX forwards that
expected host so Traefik selects the correct Ingress rule.

### Local port-forward alternative

For direct local development, if required:

``` sh
kubectl -n urumi port-forward service/urumi-store-gateway 3100:3100
```

Then use:

``` text
http://127.0.0.1:3100/mcp
```

This is a local development alternative, not the external Ingress/proxy
path demonstrated above.

## Upstream services and tools

Gateway tool names use the normalized upstream name, followed by `__`,
followed by the upstream tool name.

  --------------------------------------------------------------------------
  Upstream                            Example Gateway tools
  ----------------------------------- --------------------------------------
  WooCommerce                         `woocommerce__list_products`,
                                      `woocommerce__create_product`,
                                      `woocommerce__list_orders`,
                                      `woocommerce__get_order`,
                                      `woocommerce__update_order_status`

  Inventory                           `inventory__inventory_status`,
                                      `inventory__get_stock`

  Support                             `support__support_status`,
                                      `support__get_order_support_summary`
  --------------------------------------------------------------------------

The live tool list depends on enabled upstreams and the tools each
upstream advertises. Use MCP `tools/list` to retrieve the current
catalogue.

### WooCommerce

The WooCommerce MCP service exposes product and order operations:

-   List products
-   Create a product
-   List orders
-   Get an order
-   Update an order status

### Inventory

-   `inventory_status`
-   `get_stock({ product_id })`

### Support

-   `support_status`
-   `get_order_support_summary({ order_id })`

The Gateway queries enabled upstreams independently during discovery. A
failed or timed-out upstream is omitted while healthy upstream tools
remain available. Disabled upstreams are removed from discovery and
rejected at call time, including when a client has an older tool list.

## Authentication and authorization

Management routes use:

``` http
Authorization: Bearer <API_KEY>
```

The Gateway supports administrator and member roles:

  Capability                                Admin   Member
  --------------------------------------- ------- --------
  Invoke permitted tools through `/mcp`       Yes      Yes
  View `/api/status`                          Yes      Yes
  Manage users                                Yes       No
  Issue/revoke API keys                       Yes       No
  Manage upstreams                            Yes       No
  View audit metadata                         Yes       No

The raw API key is returned only when issued through
`POST /api/users/:id/keys`. The database stores a salted scrypt hash,
not the raw key. Each user should use their own key. Revoking a key
invalidates subsequent requests made with it.

## Gateway API

The complete implemented HTTP and MCP contract is documented in
[`docs/api-contracts.md`](docs/api-contracts.md).

  -----------------------------------------------------------------------------
  Route                         Purpose                 Access
  ----------------------------- ----------------------- -----------------------
  `POST /mcp`                   MCP JSON-RPC requests   Authenticated users

  `GET /api/status`             Gateway status          Admin/member

  `GET /api/upstreams/health`   Upstream health         Admin

  `/api/users`                  User management         Admin

  `/api/keys`                   API-key management      Admin

  `/api/upstreams`              Upstream management     Admin

  `/api/audit`                  Audit metadata          Admin

  `POST /api/chat`              Server-side             Authenticated users
                                chat/tool-use API       
  -----------------------------------------------------------------------------

Refer to `docs/api-contracts.md` for exact methods, path parameters,
request bodies, and response schemas.

Example: disable an upstream:

``` sh
curl -X PATCH http://127.0.0.1:3100/api/upstreams/<UPSTREAM_ID> \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"enabled":false}'
```

Example: revoke an API key:

``` sh
curl -X DELETE http://127.0.0.1:3100/api/keys/<KEY_ID> \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

Use actual IDs returned by the management API. These examples assume the
local Gateway is available at `127.0.0.1:3100`.

## Health and failure handling

-   WooCommerce, Inventory, and Support expose health/readiness
    endpoints as described above.
-   Upstream timeouts are configurable per upstream (100--30,000 ms).
-   Health checks run independently and are coalesced/cached for five
    seconds to avoid polling storms.
-   Health responses expose sanitized metadata: upstream ID/name,
    enabled/reachable state, tool count, timestamp, and sanitized error
    category.
-   Failed or timed-out upstreams are omitted from discovery while
    healthy upstream tools remain available.
-   Disabled upstreams are excluded from discovery and rejected at call
    time.
-   Downstream errors are sanitized and do not expose upstream URLs,
    response bodies, or credentials.

## Testing and verification

The following checks were completed in the local deployed environment:

  -----------------------------------------------------------------------
  Verification                        Result
  ----------------------------------- -----------------------------------
  Kubernetes workloads deployed and   Passed
  healthy during integration testing  

  Gateway reachable through local     Passed
  NGINX → Traefik → Ingress           

  External MCP Inspector connection   Passed
  using Streamable HTTP               

  User B API-key authentication       Passed

  MCP initialization with protocol    Passed
  `2025-03-26`                        

  MCP initialization with protocol    Passed
  `2025-11-25`                        

  Tool discovery through the external Passed
  MCP client                          

  Tool execution across configured    Passed
  upstream services                   
  -----------------------------------------------------------------------

The initialization response identified the Gateway as
`urumi-mcp-gateway`, version `0.1.0`.

### Additional acceptance tests

Run and capture these before marking them complete:

  -----------------------------------------------------------------------
  Test                    Expected result         Status
  ----------------------- ----------------------- -----------------------
  Member attempts an      Access denied           Pending final evidence
  admin-only operation                            

  Revoke User B key, then Subsequent request      Pending final evidence
  reuse it                returns `401`           

  Disable one upstream    Its tools disappear;    Pending final evidence
                          healthy upstream tools  
                          remain                  

  Make one upstream       Gateway continues       Pending final evidence
  unreachable or stop its exposing healthy        
  pod                     upstream tools          

  Restore/recreate the    Kubernetes restores the Pending final evidence
  stopped pod             workload and upstream   
                          becomes available       

  WooCommerce             Order is created and    Confirm against actual
  cash-on-delivery        visible in WooCommerce  test run
  checkout                                        

  Restart relevant pods   Persistent              Confirm against actual
                          WooCommerce/order and   test run
                          Gateway state remains   
                          available               
  -----------------------------------------------------------------------

Do not mark a test as passed until the result has been observed and
captured. For disruptive tests, preserve baseline evidence and use a
test key/upstream where possible.

## Security considerations

-   API keys are stored as salted scrypt hashes.
-   Upstream credentials are encrypted at rest in Gateway persistence.
-   Raw API keys are returned only at issuance time.
-   Management APIs are restricted to administrators.
-   Gateway credentials are not forwarded to upstream servers.
-   Upstream registration rejects embedded URL credentials and blocks
    loopback, private, link-local, multicast, unspecified, and
    cloud-metadata destinations by default.
-   Private Kubernetes service destinations must be explicitly allowed
    through a narrow policy such as `*.svc.cluster.local`.
-   `UPSTREAM_DEVELOPMENT_ALLOW_PRIVATE=true` is for local development
    only.
-   Secrets must be supplied through environment variables or Kubernetes
    Secrets, never committed to source control.
-   Back up PostgreSQL data and the Gateway credentials Secret together.

### DNS rebinding hardening

Hostname resolution is repeated before production upstream requests.
However, the current Node `fetch` transport does not pin the validated
address for the TCP connection. A hostile DNS server could rebind
between validation and connection. Production deployments should use
trusted DNS and egress controls. Address pinning/custom connection
dispatch remains a hardening task.

## Known limitations and remaining tests

-   Dashboard capabilities should be described according to the exact
    deployed build. The presence of Gateway APIs does not imply that
    every dashboard management workflow is implemented.
-   `POST /api/chat` is non-streaming and requires an OpenAI-compatible
    Chat Completions provider. Configure `CHAT_PROVIDER_BASE_URL`,
    `CHAT_PROVIDER_API_KEY`, and `CHAT_MODEL`, plus optional
    `CHAT_TIMEOUT_MS` and `CHAT_MAX_ITERATIONS`. If provider
    configuration is incomplete, the endpoint returns
    `503 {"error":"chat_unavailable"}`.
-   The chat API derives the caller from the Bearer API key; it does not
    accept a user ID in the request body as an identity claim.
-   DNS rebinding hardening remains outstanding.
-   API-key revocation, upstream-disable behavior, pod failure recovery,
    checkout, and persistence checks should be reported as complete only
    when supported by recorded test evidence.

The chat API accepts a request shaped like:

``` json
{
  "message": "Check stock for product 101",
  "history": [
    {
      "role": "user",
      "content": "Earlier question"
    }
  ]
}
```

The response contains `message`, `traces`, and `status`. Traces contain
the Gateway tool name, argument keys, status, duration, and a safe error
category. They do not expose raw tool output, API keys, upstream URLs,
or credentials. Messages are limited to 8,000 characters, history to 12
short messages, tool results to 16,000 characters, and the tool loop to
`CHAT_MAX_ITERATIONS`.

## Demo evidence


The following demonstrations showcase the end-to-end application workflow,
dashboard functionality, and AI-driven interaction across the integrated
WooCommerce and MCP Gateway ecosystem.

### 1. WooCommerce Store — End-to-End Storefront Workflow

Demonstrates the WooCommerce administration and customer-facing storefront,
including product management, browsing products, adding items to the cart,
and completing an order checkout.

**Demonstrated capabilities:**
- WooCommerce administration and product management.
- Customer-facing storefront and product browsing.
- Cart and checkout workflow.
- Order creation and verification.

[Watch Demo 1 — Store https://drive.google.com/file/d/1BtqSc7G-NcqGe4eQcM-QHlDMX2XBOGGB/view?usp=share_link

### 2. Dashboard and AI Agent — End-to-End Integration

Demonstrates the dashboard functionality and AI agent interacting with the
commerce system through natural-language prompts.

**Demonstrated workflow:**
1. Add a new product through the AI agent using a natural-language prompt.
2. Verify that the product is available in the WooCommerce store.
3. Create an order through the customer-facing storefront.
4. Retrieve and verify the newly created order through the dashboard using
   an AI agent prompt.

**Demonstrated capabilities:**
- Dashboard integration with backend services.
- Natural-language interaction with the AI agent.
- AI-driven product creation.
- Order retrieval and verification.
- Data consistency across the storefront and dashboard.

[Watch Demo 2 — Dashboard and AI Agent]https://drive.google.com/file/d/1scGrlLe1vvIY9phWYcB0eHvFwF5bJcYM/view?usp=share_link

------------------------------------------------------------------------

## Submission checklist

-   [ ] Confirm the README matches the submitted commit and deployed
    build.
-   [ ] Confirm all demo links are accessible to reviewers.
-   [ ] Keep environment-specific values and secrets out of the
    repository.
-   [ ] Keep test results aligned with observed evidence.
-   [ ] Use `docs/api-contracts.md` as the detailed API contract
    reference.
