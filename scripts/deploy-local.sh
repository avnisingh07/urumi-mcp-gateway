#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
CLUSTER="${K3D_CLUSTER_NAME:-urumi}"
NAMESPACE="${K8S_NAMESPACE:-urumi}"
RELEASE="${HELM_RELEASE_NAME:-urumi-store}"

for cmd in node npm docker k3d kubectl helm; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Required command not found: $cmd" >&2; exit 1; }
done
k3d cluster list | awk 'NR>1 {print $1}' | grep -Fxq "$CLUSTER" || {
  echo "k3d cluster '$CLUSTER' was not found; refusing to create or replace it." >&2
  exit 1
}
kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 || {
  echo "Namespace '$NAMESPACE' does not exist; refusing to create it implicitly." >&2
  exit 1
}
kubectl -n "$NAMESPACE" get secret urumi-chat-provider -o jsonpath='{.data.api-key}' | grep -q . || {
  echo "Missing Secret $NAMESPACE/urumi-chat-provider key api-key. Create it securely before deploying." >&2
  exit 1
}
kubectl -n "$NAMESPACE" get secret urumi-woocommerce-mcp-credentials -o jsonpath='{.data.WOOCOMMERCE_CONSUMER_KEY}' | grep -q . || {
  echo "Missing WooCommerce MCP credentials Secret; refusing to deploy." >&2
  exit 1
}

# A fresh npm ci installs platform-correct optional native dependencies when needed.
if [[ ! -x node_modules/.bin/tsc ]]; then
  npm ci
fi

# Unique tags avoid stale IfNotPresent images and make rollback/recovery easier.
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
BUILD_TAG="local-${GIT_SHA}-$(date -u +%Y%m%d%H%M%S)"

npm run build
npm test --workspace @urumi/support-mcp
npm test --workspace @urumi/inventory-mcp
helm lint deploy/helm/urumi --values deploy/helm/urumi/values.yaml --values deploy/helm/urumi/values-local.yaml
scripts/verify-helm-template.sh

images=(
  "urumi-gateway:${BUILD_TAG}"
  "urumi-dashboard:${BUILD_TAG}"
  "urumi-woocommerce-mcp:${BUILD_TAG}"
  "urumi-inventory-mcp:${BUILD_TAG}"
  "urumi-support-mcp:${BUILD_TAG}"
)
docker build -f apps/gateway/Dockerfile -t "${images[0]}" .
docker build -f apps/dashboard/Dockerfile -t "${images[1]}" .
docker build -f services/woocommerce-mcp/Dockerfile -t "${images[2]}" .
docker build -f services/inventory-mcp/Dockerfile -t "${images[3]}" .
docker build -f services/support-mcp/Dockerfile -t "${images[4]}" .
k3d image import -c "$CLUSTER" "${images[@]}"

helm upgrade --install "$RELEASE" deploy/helm/urumi \
  --namespace "$NAMESPACE" \
  --values deploy/helm/urumi/values.yaml \
  --values deploy/helm/urumi/values-local.yaml \
  --set-string "gateway.image.tag=${BUILD_TAG}" \
  --set-string "dashboard.image.tag=${BUILD_TAG}" \
  --set-string "woocommerceMcp.image.tag=${BUILD_TAG}" \
  --set-string "internalMcpUpstreams.inventory.image.tag=${BUILD_TAG}" \
  --set-string "internalMcpUpstreams.support.image.tag=${BUILD_TAG}" \
  --wait --timeout 10m

kubectl -n "$NAMESPACE" rollout status deployment/"$RELEASE"-gateway --timeout=120s
kubectl -n "$NAMESPACE" rollout status deployment/"$RELEASE"-dashboard --timeout=120s
kubectl -n "$NAMESPACE" rollout status deployment/"$RELEASE"-inventory-mcp --timeout=120s
kubectl -n "$NAMESPACE" rollout status deployment/"$RELEASE"-support-mcp --timeout=120s
kubectl -n "$NAMESPACE" rollout status deployment/"$RELEASE"-woocommerce-mcp --timeout=120s
printf '\nDeployed build tag: %s\n' "$BUILD_TAG"
printf 'To roll back: helm -n %s history %s\n' "$NAMESPACE" "$RELEASE"
