# Live backend acceptance record

This record distinguishes commands executed against the local environment from
automated coverage. It does not claim browser, authenticated-client, or
cluster-failure behavior that was not exercised.

| Test | Status | Evidence and actual result | Remaining action |
| --- | --- | --- | --- |
| Baseline local runtime | PASS | `k3d-urumi` was the current context. Gateway `/healthz` and `/readyz`, WooCommerce MCP port-forward `/healthz`, and local Inventory/Support `/healthz` each returned `200`. The storefront returned `200` when checked from the permitted local environment. | None for this baseline. |
| Unauthenticated MCP protection | PASS | `POST http://127.0.0.1:3100/mcp` without Bearer authentication returned `401 {"error":"unauthorized"}`. | Authenticated external-client verification remains separate. |
| A — real storefront checkout and order retrieval | BLOCKED | The checkout page was probed read-only, but no payment-method marker was available from the non-browser HTML probe. No order/product was created. | An operator must confirm the offline test payment flow in a browser and authorize the persistent test-order creation. Then record the generated order ID and validate it through authenticated `woocommerce__list_orders` and `woocommerce__get_order`. |
| B — temporary member key and revocation | BLOCKED | The admin key was deliberately unavailable to the acceptance session; its value was neither searched for nor printed. No users or keys were changed. | Run the documented API sequence from an operator-owned terminal holding the existing admin key; retain the temporary user if no delete-user API is available. |
| C — Support disable/re-enable | BLOCKED | The admin key was unavailable, so Support registration was not changed. | With the operator key, capture current enabled state, PATCH only Support to `enabled:false`, check authenticated `tools/list`, then restore the exact prior state in a `finally`/cleanup step. |
| D — failure isolation | NOT RUN live | The current `k3d-urumi` release contains WooCommerce MCP, WordPress, and MariaDB only; Inventory and Support are local Node processes. No pod/process was interrupted because Support has no confirmed restart supervisor and the deployed chart was not upgraded. | After deploying the M10 chart to the confirmed local cluster, capture the target Deployment/replica state and conduct a controlled single-upstream interruption with recovery verification. Automated isolation tests already cover this behavior. |
| E — tool-level audit outcome | PASS (automated fix) | `GatewayCore` previously recorded every successful HTTP/JSON-RPC response as success. It now records MCP `result.isError === true` as `outcome:"failure", errorCode:"tool_error"`; chat traces use the same failure classification. Unit and PostgreSQL integration regressions cover this without recording arguments or tool output. | Optionally confirm the fixed behavior against a live authenticated `inventory__get_stock` not-found response after the operator makes the key available. |

## Safety record

No administrator key, temporary user/key, upstream registration, product, order,
payment, Kubernetes workload, persistent volume, database schema, or Helm
release was changed during the read-only live checks. The currently running
Gateway, port-forward, and local upstream processes were not restarted.

## Completed automated verification

The following command used only the dedicated database named
`urumi_gateway_test`:

```sh
GATEWAY_TEST_DATABASE_URL='postgres://urumi:local-dev-password@127.0.0.1:5433/urumi_gateway_test' \
  npm test --workspace @urumi/gateway
```

Result: **23 passed, 0 failed, 0 skipped**. This includes the real PostgreSQL
HTTP regression proving that an MCP response with `isError: true` persists an
audit event with `outcome: "failure"` and `errorCode: "tool_error"`. It also
includes the chat trace regression. `npm run typecheck --workspace
@urumi/gateway` and `git diff --check` passed.

## Exact safe next actions

1. In an operator-owned terminal that already holds the administrator key, run
   Tests B and C with a cleanup trap that restores Support's prior enabled state.
2. Confirm a local/offline checkout method in the browser, then explicitly
   authorize a clearly named test order before Test A creates persistent data.
3. Deploy the already-rendered M10 chart only when authorized, then run Test D
   against a confirmed one-replica upstream Deployment and wait for recovery.
