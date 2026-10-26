# Backend API contracts

All authenticated endpoints use `Authorization: Bearer <individual gateway API key>`. Invalid or revoked keys return `401 {"error":"unauthorized"}`. Keys are issued once by an admin and stored only as scrypt hashes.

## Fresh-install provisioning

`npm run provision-initial-state --workspace @urumi/gateway` is an operator CLI,
not an HTTP endpoint. It requires runtime environment values for one initial
admin username/key and the WooCommerce, Inventory, and Support MCP URLs. It
creates the state only when the user and upstream tables are empty, saves only a
hash of the supplied API key, prints no raw key, and does not alter an existing
incompatible installation. The optional Helm provisioning Job is disabled by
default and reads the initial key only from an operator-created Kubernetes
Secret.

## Management APIs

Admins only: `GET/POST /api/users`, `POST /api/users/:id/keys`, `DELETE /api/keys/:id`, `GET/POST /api/upstreams`, `PATCH/DELETE /api/upstreams/:id`, `GET /api/upstreams/health`, and `GET /api/audit?limit=1..500`. Members receive `403 {"error":"forbidden"}` for these routes.

`POST /api/users` accepts `{ "username", "role": "admin"|"member" }`. `POST /api/users/:id/keys` returns `{ "apiKey": { "id", "key", "createdAt" } }`; no later endpoint returns that raw key.

`POST /api/upstreams` accepts `{ "name", "url", "enabled"?, "credential"?, "timeoutMs"? }`; PATCH accepts the same mutable fields. Public upstream responses contain `{id,name,url,enabled,timeoutMs}` and never credentials/ciphertext. Unsafe URL errors are `400 {"error":"upstream_url_not_permitted"}`. Health returns `{ upstreams: [{id,name,enabled,state,toolCount,lastCheckedAt,error}] }`, where state is `disabled`, `reachable`, or `unreachable`.

`GET /api/audit` returns redacted event metadata: user/upstream IDs, tool name, timestamp, duration, outcome, and safe error code—never arguments, API keys, or credentials.

## MCP endpoint

`POST /mcp` is Streamable HTTP JSON-RPC. Clients configure the gateway URL and their own Bearer key only. `tools/list` returns enabled/reachable namespaced tools; disabled or unreachable upstream tools are omitted. `tools/call` validates arguments and routes through the owning upstream. Revoking a key causes subsequent MCP requests to return 401.

## Chat endpoint

`POST /api/chat` is available to authenticated admins and members. It accepts `{ "message": string, "history"?: [{"role":"user"|"assistant","content":string}] }`; message limit is 8,000 characters, history limit is 12 entries with 4,000 characters each. The caller is always derived from the API key.

The response is `{ "message", "traces", "status" }`. `status` is `completed`, `stopped`, or `error`; traces expose only tool name, argument keys, status, duration, and safe error category. Missing provider configuration returns `503 {"error":"chat_unavailable"}`. Browser login/session handling and dashboard UI are not implemented.
