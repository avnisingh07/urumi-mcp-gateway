Implemented M0 workspace baseline only.
Changed:
- Root: package.json, package-lock.json, .gitignore, tsconfig.base.json
- Apps: apps/gateway, apps/dashboard
- Services: services/woocommerce-mcp, services/inventory-mcp, services/support-mcp
- Shared package: packages/shared
Details:
- Configured npm workspaces for apps/*, services/*, and packages/*.
- Added minimal TypeScript manifests, configs, and entry points for all six packages.
- Added pinned React 19.1.1 and TypeScript dependencies for the dashboard scaffold; no UI screens or business logic.
- Added root build and typecheck scripts that run every workspace.
- Expanded .gitignore for environment files while retaining .env.example, build output, logs, temp files, and credential files.
- Preserved existing docs, AGENTS.md, and the empty scripts/k3d-up.sh; no cluster commands were run.
Commands run and results:
- npm install — passed; added 13 packages, audit found 0 vulnerabilities.
  - The initial sandboxed attempt could not resolve the npm registry; rerunning with approved registry access succeeded.
- npm run build — passed for all six workspaces.
- npm run typecheck — passed for all six workspaces.
- git diff --check — passed.
No blockers. The pre-existing staged AGENTS.md and scripts/k3d-up.sh remain untouched.
Implemented M1 in the existing urumi cluster. The WooCommerce store is deployed and reachable.
- Release: urumi-store in namespace urumi, Helm revision 5
- Storefront: http://store.urumi.local:8081
- Both WordPress and MariaDB pods: 1/1 Ready
- PVCs: WordPress 2Gi, MariaDB 1Gi, both Bound via local-path
- WooCommerce: installed and active
- Storefront verification: HTTP 200, title Urumi Store
Changed files:
- [.gitignore](/Users/avnisingh/Desktop/urumi-mcp/urumi-mcp-gateway/.gitignore)
- [README.md](/Users/avnisingh/Desktop/urumi-mcp/urumi-mcp-gateway/README.md)
- [Chart.yaml](/Users/avnisingh/Desktop/urumi-mcp/urumi-mcp-gateway/deploy/helm/urumi/Chart.yaml)
- [Chart.lock](/Users/avnisingh/Desktop/urumi-mcp/urumi-mcp-gateway/deploy/helm/urumi/Chart.lock)
- [values.yaml](/Users/avnisingh/Desktop/urumi-mcp/urumi-mcp-gateway/deploy/helm/urumi/values.yaml)
- [values-local.yaml](/Users/avnisingh/Desktop/urumi-mcp/urumi-mcp-gateway/deploy/helm/urumi/values-local.yaml)
- [credentials.yaml](/Users/avnisingh/Desktop/urumi-mcp/urumi-mcp-gateway/deploy/helm/urumi/templates/credentials.yaml)
The chart pins Bitnami WordPress 33.0.12 with bundled MariaDB 27.0.8. It creates a generated-once Kubernetes Secret (urumi-store-credentials) for WordPress and MariaDB credentials; no credential values are committed. Resources, readiness/liveness probes, ingress, persistent volumes, and local port handling are configured.
Commands run:
- Preflight: git status, docker info, k3d cluster list, kubectl get nodes/pods/storageclass/ingressclass, helm repo list, and OCI chart inspection.
  - Existing cluster was healthy, unused, and preserved.
  - Docker Desktop: 3.83 GiB RAM, 8 CPUs.
  - Traefik host port: 8081.
- helm dependency build deploy/helm/urumi — passed.
- helm lint deploy/helm/urumi — passed (informational suggestion: chart icon recommended).
- helm upgrade --install ... --wait --timeout 15m — deployed successfully.
- kubectl rollout status ... — WordPress Deployment and MariaDB StatefulSet passed.
- wp plugin is-active woocommerce — passed.
- curl --resolve store.urumi.local:8081:127.0.0.1 ... — HTTP 200.
- git diff --check — passed.
Manual remaining steps:
1. Add 127.0.0.1 store.urumi.local to /etc/hosts.
2. Retrieve the admin password using the documented command in README; sign in as admin at /wp-admin/.
3. Configure/use cash on delivery, complete a test checkout, and confirm the order in WooCommerce admin.
4. Perform the final order/data persistence check across relevant pod restarts.
No cluster was deleted or recreated, and AGENTS.md was not modified.

M1 - 

## A. Current scaffold

- `services/woocommerce-mcp` is an empty TypeScript package:
  - [index.ts](/Users/avnisingh/Desktop/urumi-mcp/urumi-mcp-gateway/services/woocommerce-mcp/src/index.ts) exports only a package marker.
  - [package.json](/Users/avnisingh/Desktop/urumi-mcp/urumi-mcp-gateway/services/woocommerce-mcp/package.json) has only build/typecheck scripts and no runtime dependencies.
  - [tsconfig.json](/Users/avnisingh/Desktop/urumi-mcp/urumi-mcp-gateway/services/woocommerce-mcp/tsconfig.json) inherits strict NodeNext TypeScript settings.
- The root npm workspace and `@urumi/shared` are minimal; no MCP SDK, HTTP library, validator, test runner, or Node typings are installed.
- M1 is healthy:
  - `urumi-store-wordpress` and `urumi-store-mariadb-0` are Ready.
  - WordPress service is internal `ClusterIP`: `urumi-store-wordpress` on port 80.
  - Public access is only through the existing Traefik Ingress.
  - The Helm chart uses Secrets, resource limits, probes, non-root security contexts, and no service-account token mount.
- The current Helm chart only deploys WordPress/MariaDB. It has no MCP workload, image build, or MCP-specific values yet.

## B. Proposed M2 files

Create or modify only these application/test files initially:

- `services/woocommerce-mcp/package.json`
  - Add exact-pinned runtime dependencies: official MCP SDK, Node adapter, Zod.
  - Add Node typings and a minimal test runner as dev dependencies.
  - Add `test` script.
- `services/woocommerce-mcp/src/index.ts`
  - HTTP server startup, `/mcp`, `/healthz`, and `/readyz`.
- `services/woocommerce-mcp/src/config.ts`
  - Parse required environment configuration once; reject missing/invalid values without printing secrets.
- `services/woocommerce-mcp/src/woocommerce-client.ts`
  - Timeout-bound REST client, Basic auth construction, response/error normalization.
- `services/woocommerce-mcp/src/tools.ts`
  - MCP tool registration, Zod schemas, output shaping.
- `services/woocommerce-mcp/src/types.ts`
  - Narrow internal types for WooCommerce REST responses/request payloads.
- `services/woocommerce-mcp/src/errors.ts`
  - Sanitized operational error types/mapping.
- `services/woocommerce-mcp/test/*.test.ts`
  - Unit and transport/integration-style tests using mocked `fetch`.

Likely defer Dockerfile and Helm Deployment/Service/Secret templates to M8, which explicitly covers completing container builds and Helm configuration. The M2 server should nevertheless be designed to run from `PORT`, expose health endpoints, and use only environment configuration so it is directly container-ready.

## C. MCP SDK and transport

Use the official v2 SDK packages, pinned to compatible exact versions after confirming the install:

- `@modelcontextprotocol/server`
- `@modelcontextprotocol/node`
- `zod`

Use Streamable HTTP at `POST /mcp`, with a stateless request-per-server factory. This suits an internal Kubernetes service: no session storage, no in-memory session cleanup, and one stable HTTP endpoint for the future gateway. The official SDK identifies Streamable HTTP as the recommended remote-server transport; stdio is inappropriate because this service will run independently in the cluster. [Official SDK server guide](https://ts.sdk.modelcontextprotocol.io/server)

Do not add Express/Fastify unless the selected MCP Node adapter genuinely requires it. A Node HTTP server plus the official Node adapter is sufficient and keeps M2 lean.

## D. Safe WooCommerce configuration

Required runtime configuration:

- `PORT` — default may be `3000`; non-secret.
- `WOOCOMMERCE_BASE_URL` — internal cluster URL, expected to be `http://urumi-store-wordpress.urumi.svc.cluster.local`.
- `WOOCOMMERCE_CONSUMER_KEY`
- `WOOCOMMERCE_CONSUMER_SECRET`
- Optional `WOOCOMMERCE_REQUEST_TIMEOUT_MS`, bounded to a safe range.

Create a dedicated WooCommerce REST API key with only the required permissions, ideally read/write because product creation and status updates are required. Store its key and secret in a dedicated Kubernetes Secret later, mounted as environment variables only in the MCP pod. Never place either in Helm values, `.env.example`, test fixtures, logs, MCP error text, or browser-accessible configuration.

One implementation-time check is needed: verify the internal WordPress service accepts REST requests at `/wp-json/wc/v3` without redirecting due to the store’s external canonical hostname. If it redirects, use the internal Service for routing while setting the expected Host header, or adjust the WordPress proxy/canonical configuration narrowly—without exposing the MCP service.

## E. M2 tests and acceptance checks

Automated:

- Config rejects missing URLs/credentials, malformed URLs, and invalid timeout values without echoing secrets.
- Each tool publishes the expected input schema.
- Invalid arguments never call WooCommerce:
  - IDs/page/per-page must be positive bounded integers.
  - product name non-empty; price valid positive decimal.
  - order status constrained to supported writable statuses.
- Request formation:
  - Correct WooCommerce REST paths, query parameters, payloads, and Basic auth.
  - Timeouts abort requests.
- Failure handling:
  - WooCommerce 4xx/5xx, malformed JSON, network errors, and timeouts yield useful sanitized MCP errors.
  - Credentials and upstream response internals are absent from errors/logs.
- HTTP transport:
  - `/healthz` returns healthy while the process is running.
  - `/readyz` validates configuration and dependency reachability.
  - MCP initialize, tool discovery, and one successful call work over Streamable HTTP.

Manual/cluster acceptance:

- Create REST credentials in WooCommerce admin and store them in Kubernetes Secret.
- Run the service internally; confirm no Ingress, LoadBalancer, or NodePort is created for it.
- Verify all five tools against real store data.
- Create a disposable product, confirm it exists through WooCommerce admin/store API.
- Fetch a real order, update its status, then re-fetch/admin-check persistence.
- Confirm health probes pass and invalid/upstream-failure responses remain sanitized.

## F. Decisions / assumptions

1. **MCP SDK major version:** I recommend current v2 official packages rather than the maintenance-line `@modelcontextprotocol/sdk` v1. The project has no existing MCP dependency, so there is no migration cost. The exact versions should be pinned after checking compatible package releases during implementation.

2. **Deployment scope:** M2’s assignment text makes service deployment a manual responsibility, while M8 owns completed Docker/Helm configuration. I recommend implementing the server and tests in M2, then adding its image and internal Helm Service in M8. If you want real-cluster verification during M2, authorize adding a small Dockerfile and internal-only Helm workload now.

3. **REST key setup:** A human must create the WooCommerce REST API credentials in `/wp-admin/`; this cannot safely be invented or committed.

4. **Tool response shape:** Recommend returning a small, intentional subset of product/order fields rather than raw WooCommerce responses, to reduce exposure of customer/address/payment metadata. Confirmation is needed if the reviewer expects full raw records.