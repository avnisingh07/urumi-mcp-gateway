#!/bin/sh
set -eu

chart=deploy/helm/urumi
rendered=$(mktemp)
production=$(mktemp)
trap 'rm -f "$rendered" "$production"' EXIT

helm template urumi-store "$chart" --namespace urumi --values "$chart/values.yaml" --values "$chart/values-local.yaml" >"$rendered"
for name in urumi-store-gateway urumi-store-postgres urumi-store-dashboard; do
  rg -F "name: $name" "$rendered" >/dev/null
done
rg -F 'kind: StatefulSet' "$rendered" >/dev/null
rg -F 'kind: Ingress' "$rendered" >/dev/null
rg -F 'secretKeyRef: { name: urumi-gateway-credentials, key: database-url }' "$rendered" >/dev/null
rg -F 'UPSTREAM_DEVELOPMENT_ALLOW_PRIVATE' "$rendered" >/dev/null
rg -F 'value: "false"' "$rendered" >/dev/null
for field in livenessProbe readinessProbe resources:; do
  rg -F "$field" "$rendered" >/dev/null
done
helm template urumi-store "$chart" --namespace urumi --values "$chart/values.yaml" --values "$chart/values-prod.yaml" >"$production"
rg -A1 -F 'name: UPSTREAM_DEVELOPMENT_ALLOW_PRIVATE' "$production" | rg -F 'value: "false"' >/dev/null
