#!/bin/sh
set -eu

chart=deploy/helm/urumi
rendered=$(mktemp)
production=$(mktemp)
trap 'rm -f "$rendered" "$production"' EXIT

helm template urumi-store "$chart" --namespace urumi --values "$chart/values.yaml" --values "$chart/values-local.yaml" >"$rendered"
for name in urumi-store-gateway urumi-store-postgres urumi-store-dashboard urumi-store-woocommerce-mcp urumi-store-inventory-mcp urumi-store-support-mcp; do
  rg -F "name: $name" "$rendered" >/dev/null
done
! rg -F 'gateway-initial-provisioning' "$rendered" >/dev/null
rg -F 'kind: StatefulSet' "$rendered" >/dev/null
rg -F 'kind: Ingress' "$rendered" >/dev/null
rg -F 'secretKeyRef: { name: urumi-gateway-credentials, key: database-url }' "$rendered" >/dev/null
rg -F 'UPSTREAM_DEVELOPMENT_ALLOW_PRIVATE' "$rendered" >/dev/null
rg -F 'CHAT_PROVIDER_BASE_URL' "$rendered" >/dev/null
rg -F 'CHAT_PROVIDER_API_KEY' "$rendered" >/dev/null
rg -F 'name: urumi-chat-provider' "$rendered" >/dev/null
rg -F 'WOOCOMMERCE_CONSUMER_SECRET' "$rendered" >/dev/null
rg -F 'value: "false"' "$rendered" >/dev/null
for field in livenessProbe readinessProbe resources:; do
  rg -F "$field" "$rendered" >/dev/null
done
helm template urumi-store "$chart" --namespace urumi --values "$chart/values.yaml" --values "$chart/values-prod.yaml" >"$production"
for environment in "$production"; do
  for name in urumi-store-gateway urumi-store-postgres urumi-store-dashboard urumi-store-woocommerce-mcp urumi-store-inventory-mcp urumi-store-support-mcp; do
    rg -F "name: $name" "$environment" >/dev/null
  done
done
! rg -F 'gateway-initial-provisioning' "$production" >/dev/null
rg -A1 -F 'name: UPSTREAM_DEVELOPMENT_ALLOW_PRIVATE' "$production" | rg -F 'value: "false"' >/dev/null
! rg -F 'CHAT_PROVIDER_API_KEY' "$production" >/dev/null
