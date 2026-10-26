# Backend acceptance matrix

This is the M9 repository-level acceptance record. “Verified” means covered by
the cited automated test or rendered-static check; it does not represent a live
cluster or paid-provider test.

| Requirement | Implementation location | Verification evidence | Remaining gap | Result |
| --- | --- | --- | --- | --- |
| Upstream CRUD, enable/disable, removal | `apps/gateway/src/index.ts`, `gateway-store.ts` | PostgreSQL API integration test; gateway lifecycle tests | No live-cluster request exercised | verified |
| Namespaced discovery, routing, schema validation, failure isolation | `gateway-core.ts`, `upstream-client.ts` | Gateway aggregation, workflow, timeout, disable tests | Live upstream outage drill remains manual | verified |
| SSRF policy and redirect handling | `upstream-url-policy.ts`, `upstream-client.ts` | IPv4/IPv6/DNS-policy and redirect regression tests | Node fetch cannot pin the validated DNS address; production needs trusted DNS/egress policy | partially verified |
| Per-upstream health | `upstream-health.ts`, `/api/upstreams/health` | Reachable, disabled, failed, cached/concurrent health tests | Pod-death behavior needs a later live deployment check | verified |
| Roles, users, keys, and revocation | `gateway-store.ts`, `index.ts` | PostgreSQL two-user/admin/member/revocation test | None at repository test scope | verified |
| Credentials and key storage | `security.ts`, `gateway-store.ts` | Hash-at-rest and no-credential-response assertions | Secret-manager operational controls are deployment responsibilities | verified |
| Audit attribution and redaction | `gateway-core.ts`, `gateway-store.ts` | Successful and failed calls from two users asserted in PostgreSQL | Live audit retention/backup policy is operational | verified |
| Inventory and Support domain tools | `services/inventory-mcp`, `services/support-mcp` | Service tests and Gateway workflow test | Fixture data is deliberately deterministic, not production inventory/support data | verified |
| Server-side chat/tool loop | `chat-agent.ts`, `/api/chat` | Mock-provider chat-agent and HTTP tests | No paid-provider smoke test by design; dashboard chat UI is out of scope | verified |
| External MCP-client contract | `/mcp`, README, `api-contracts.md` | Authenticated MCP protocol/API tests, documented Inspector configuration | Manual Inspector test with two separately issued keys remains useful | partially verified |
| Helm deployment scaffolding and persistence | `deploy/helm/urumi` | Helm lint, local/production render, `verify-helm-template.sh` | No install, migration, PVC, Ingress, or pod-health test was run against a cluster | partially verified |
| Dashboard | Existing placeholder deployment only | Render checks | Final generated dashboard, browser auth, and chat UI intentionally deferred | missing (out of M9 scope) |

The API contract frozen for the backend handoff is in
[`api-contracts.md`](api-contracts.md). Changes to it should be treated as
cross-client compatibility changes.
