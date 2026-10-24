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