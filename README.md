# Urumi MCP Gateway

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