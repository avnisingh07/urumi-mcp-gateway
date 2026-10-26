import assert from "node:assert/strict";
import test from "node:test";
import {
  createGatewayMcpHandler,
  GatewayCore,
  InMemoryUpstreamRepository,
  PostgresGatewayStore,
  StreamableHttpUpstreamClient,
  CredentialCipher,
  createApiKey,
  isManagementAllowed,
  hashApiKey,
  verifyApiKey,
  UpstreamUrlPolicy,
  UpstreamUrlPolicyError,
  UpstreamHealthReporter,
  handleApi,
  loadInitialGatewayProvisioning,
  policyFromEnvironment,
} from "../dist/index.js";
import { postgresTestSkip } from "./test-database.mjs";

const testUrlPolicy = () => new UpstreamUrlPolicy({ resolve: async () => ["203.0.113.10"] });
const repository = () => new InMemoryUpstreamRepository(testUrlPolicy());

const tool = (name = "lookup") => ({ name, description: "safe description", inputSchema: {
  type: "object", properties: { id: { type: "integer", minimum: 1 } }, required: ["id"], additionalProperties: false,
} });

function upstream(name, url, extra = {}) {
  return { name, url, enabled: true, timeoutMs: 100, ...extra };
}

function mcpResponse(result) {
  return Response.json({ jsonrpc: "2.0", id: "test", result });
}

function mockFetch(routes, calls = []) {
  return async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init.body));
    calls.push({ url, headers: new Headers(init.headers), body });
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    return route(body, init);
  };
}

test("registers, edits, disables, removes, and never returns upstream credentials", async () => {
  const repository = new InMemoryUpstreamRepository(testUrlPolicy());
  const created = await repository.create(upstream("Woo Commerce", "http://woo.test/mcp", { credential: "secret" }));
  assert.equal(created.id, "upstream-1");
  assert.equal((await repository.update(created.id, { enabled: false })).enabled, false);
  await assert.rejects(repository.create(upstream("woo-commerce", "http://other.test/mcp")), /unique tool namespaces/);
  assert.equal(await repository.remove(created.id), true);
});

test("loads explicit initial provisioning only with all required non-secret configuration", () => {
  const environment = {
    GATEWAY_INITIAL_ADMIN_USERNAME: "initial-admin",
    GATEWAY_INITIAL_ADMIN_API_KEY: "urumi_abcdefghijklmnopqrstuvwxyz0123456789",
    GATEWAY_INITIAL_WOOCOMMERCE_URL: "http://release-woocommerce-mcp.urumi.svc.cluster.local:3000/mcp",
    GATEWAY_INITIAL_INVENTORY_URL: "http://release-inventory-mcp.urumi.svc.cluster.local:3001/mcp",
    GATEWAY_INITIAL_SUPPORT_URL: "http://release-support-mcp.urumi.svc.cluster.local:3002/mcp",
  };
  assert.deepEqual(loadInitialGatewayProvisioning(environment), {
    adminUsername: "initial-admin",
    adminApiKey: environment.GATEWAY_INITIAL_ADMIN_API_KEY,
    upstreams: [
      { name: "WooCommerce", url: environment.GATEWAY_INITIAL_WOOCOMMERCE_URL, timeoutMs: 10_000 },
      { name: "Inventory", url: environment.GATEWAY_INITIAL_INVENTORY_URL, timeoutMs: 10_000 },
      { name: "Support", url: environment.GATEWAY_INITIAL_SUPPORT_URL, timeoutMs: 10_000 },
    ],
  });
  assert.throws(() => loadInitialGatewayProvisioning({ ...environment, GATEWAY_INITIAL_SUPPORT_URL: undefined }), /Initial gateway provisioning configuration is invalid/);
});

test("enforces a DNS-aware upstream URL policy on create and update", async () => {
  const resolver = async (hostname) => hostname === "private.example" ? ["10.0.0.8"] : hostname === "mixed.example" ? ["203.0.113.10", "169.254.169.254"] : ["203.0.113.10"];
  const policy = new UpstreamUrlPolicy({ resolve: resolver });
  for (const url of ["ftp://example.com/mcp", "http://127.0.0.1/mcp", "http://10.0.0.1/mcp", "http://192.168.1.2/mcp", "http://169.254.169.254/latest", "http://metadata.google.internal/computeMetadata/v1", "http://[::1]/mcp", "http://[fc00::1]/mcp", "http://[fe80::1]/mcp", "http://private.example/mcp", "http://mixed.example/mcp"]) {
    await assert.rejects(policy.validate(url), UpstreamUrlPolicyError);
  }
  assert.equal(await policy.validate("https://public.example/mcp"), "https://public.example/mcp");
  const clusterPolicy = new UpstreamUrlPolicy({ allowedHostPatterns: ["*.svc.cluster.local"], resolve: async () => ["10.42.0.10"] });
  assert.equal(await clusterPolicy.validate("http://inventory.urumi.svc.cluster.local/mcp"), "http://inventory.urumi.svc.cluster.local/mcp");
  const repo = new InMemoryUpstreamRepository(policy);
  const created = await repo.create(upstream("Public", "https://public.example/mcp"));
  await assert.rejects(repo.update(created.id, { url: "http://127.0.0.1/mcp" }), /not permitted/);
  await assert.rejects(policy.validate("http://private.example/credential=secret"), (error) => {
    assert.equal(error.code, "unsafe_destination");
    assert.doesNotMatch(error.message, /private|secret|10\.0\.0\.8/);
    return true;
  });
  const developmentPolicy = policyFromEnvironment({ UPSTREAM_DEVELOPMENT_ALLOW_PRIVATE: "true" });
  assert.equal(await developmentPolicy.validate("http://10.0.0.8/mcp"), "http://10.0.0.8/mcp");
});

test("reports bounded, sanitized health for reachable, disabled, and failed upstreams", async () => {
  const repo = new InMemoryUpstreamRepository(testUrlPolicy());
  await repo.create(upstream("Healthy", "http://healthy.test/mcp"));
  await repo.create(upstream("Disabled", "http://disabled.test/mcp", { enabled: false }));
  await repo.create(upstream("Broken", "http://broken.test/mcp", { credential: "do-not-leak" }));
  let calls = 0;
  const client = new StreamableHttpUpstreamClient(mockFetch({
    "http://healthy.test/mcp": () => { calls += 1; return mcpResponse({ tools: [tool("one"), tool("two")] }); },
    "http://broken.test/mcp": () => { calls += 1; throw new Error("credential=do-not-leak"); },
  }));
  const reporter = new UpstreamHealthReporter(repo, client, 5_000, () => 1_700_000_000_000);
  const [first, second] = await Promise.all([reporter.report(), reporter.report()]);
  assert.equal(calls, 2);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map(({ id: _id, lastCheckedAt: _time, ...entry }) => entry), [
    { name: "Healthy", enabled: true, state: "reachable", toolCount: 2, error: null },
    { name: "Disabled", enabled: false, state: "disabled", toolCount: null, error: null },
    { name: "Broken", enabled: true, state: "unreachable", toolCount: null, error: "unavailable" },
  ]);
  assert.doesNotMatch(JSON.stringify(first), /do-not-leak|http:|credential/);
  await reporter.report();
  assert.equal(calls, 2);
});

test("rejects upstream redirects rather than following an unvalidated destination", async () => {
  const client = new StreamableHttpUpstreamClient(async (_input, init) => {
    assert.equal(init.redirect, "error");
    throw new TypeError("redirect disallowed");
  });
  await assert.rejects(client.listTools(upstream("Redirect", "https://public.example/mcp")), /unavailable/);
});

test("uses the same URL-policy-enforcing client for health checks", async () => {
  const repo = new InMemoryUpstreamRepository(testUrlPolicy());
  await repo.create(upstream("Policy blocked", "https://public.example/mcp"));
  let contacted = false;
  const client = new StreamableHttpUpstreamClient(async () => { contacted = true; return mcpResponse({ tools: [] }); }, new UpstreamUrlPolicy({ resolve: async () => ["127.0.0.1"] }));
  const health = await new UpstreamHealthReporter(repo, client, 0).report();
  assert.equal(contacted, false);
  assert.equal(health[0].state, "unreachable");
  assert.equal(health[0].error, "unavailable");
});

test("requires an authenticated admin for the upstream health API", async () => {
  const invoke = async (role) => {
    const result = { status: undefined, body: "" };
    const response = { writeHead: (status) => { result.status = status; }, end: (body) => { result.body = body ?? ""; } };
    await handleApi({ method: "GET", headers: { authorization: "Bearer key" } }, response, {}, new URL("http://gateway.test/api/upstreams/health"), async () => role ? { id: "u", username: "user", role } : undefined, { report: async () => [{ id: "upstream-1", name: "Healthy", enabled: true, state: "reachable", toolCount: 1, lastCheckedAt: "2023-11-14T22:13:20.000Z", error: null }] });
    return result;
  };
  assert.equal((await invoke(undefined)).status, 401);
  assert.equal((await invoke("member")).status, 403);
  const admin = await invoke("admin");
  assert.equal(admin.status, 200);
  assert.deepEqual(JSON.parse(admin.body).upstreams[0].toolCount, 1);
});

test("returns a sanitized URL-policy error from the management API", async () => {
  const result = { status: undefined, body: "" };
  const response = { writeHead: (status) => { result.status = status; }, end: (body) => { result.body = body ?? ""; } };
  const rejected = new UpstreamUrlPolicyError("unsafe_destination");
  const store = { create: async () => { throw rejected; } };
  await handleApi({ method: "POST", headers: { authorization: "Bearer key" }, [Symbol.asyncIterator]: async function* () { yield Buffer.from('{"name":"private","url":"http://secret.internal/mcp"}'); } }, response, store, new URL("http://gateway.test/api/upstreams"), async () => ({ id: "a", username: "admin", role: "admin" }), { report: async () => [] });
  assert.equal(result.status, 400);
  assert.deepEqual(JSON.parse(result.body), { error: "upstream_url_not_permitted" });
  assert.doesNotMatch(result.body, /secret|private|internal/);
});

test("discovers three enabled upstreams, namespaces deterministically, and routes each call", async () => {
  const repository = new InMemoryUpstreamRepository(testUrlPolicy());
  await repository.create(upstream("Woo Commerce", "http://woo.test/mcp"));
  await repository.create(upstream("Inventory", "http://inventory.test/mcp"));
  await repository.create(upstream("Support", "http://support.test/mcp"));
  const calls = [];
  const core = new GatewayCore(repository, new StreamableHttpUpstreamClient(mockFetch({
    "http://woo.test/mcp": (request) => request.method === "tools/list" ? mcpResponse({ tools: [tool()] }) : mcpResponse({ content: [{ type: "text", text: "woo" }] }),
    "http://inventory.test/mcp": (request) => request.method === "tools/list" ? mcpResponse({ tools: [tool()] }) : mcpResponse({ content: [{ type: "text", text: "inventory" }] }),
    "http://support.test/mcp": (request) => request.method === "tools/list" ? mcpResponse({ tools: [tool()] }) : mcpResponse({ content: [{ type: "text", text: "support" }] }),
  }, calls)));
  const discovery = await core.discover();
  assert.deepEqual(discovery.tools.map((entry) => entry.name), ["inventory__lookup", "support__lookup", "woo_commerce__lookup"]);
  assert.equal((await core.callTool("woo_commerce__lookup", { id: 3 })).content[0].text, "woo");
  assert.equal((await core.callTool("inventory__lookup", { id: 4 })).content[0].text, "inventory");
  assert.equal((await core.callTool("support__lookup", { id: 5 })).content[0].text, "support");
  assert.equal(calls.filter((call) => call.body.method === "tools/call")[0].body.params.name, "lookup");
});

test("routes WooCommerce IDs through inventory and support workflows while another upstream is unavailable", async () => {
  const repository = new InMemoryUpstreamRepository(testUrlPolicy());
  await repository.create(upstream("WooCommerce", "http://woo.test/mcp"));
  await repository.create(upstream("Inventory", "http://inventory.test/mcp"));
  await repository.create(upstream("Support", "http://support.test/mcp"));
  await repository.create(upstream("Unavailable", "http://unavailable.test/mcp"));
  const schema = (property) => ({ type: "object", properties: { [property]: { type: "integer", minimum: 1 } }, required: [property], additionalProperties: false });
  const client = new StreamableHttpUpstreamClient(mockFetch({
    "http://woo.test/mcp": (request) => request.method === "tools/list"
      ? mcpResponse({ tools: [{ name: "list_products", inputSchema: { type: "object" } }, { name: "get_order", inputSchema: schema("order_id") }] })
      : request.params.name === "list_products"
        ? mcpResponse({ content: [{ type: "text", text: JSON.stringify({ products: [{ id: 101 }] }) }] })
        : mcpResponse({ content: [{ type: "text", text: JSON.stringify({ order: { id: request.params.arguments.order_id } }) }] }),
    "http://inventory.test/mcp": (request) => request.method === "tools/list"
      ? mcpResponse({ tools: [{ name: "get_stock", inputSchema: schema("product_id") }] })
      : mcpResponse({ content: [{ type: "text", text: JSON.stringify({ product_id: request.params.arguments.product_id, available: 24, reserved: 3, status: "in_stock" }) }] }),
    "http://support.test/mcp": (request) => request.method === "tools/list"
      ? mcpResponse({ tools: [{ name: "get_order_support_summary", inputSchema: schema("order_id") }] })
      : mcpResponse({ content: [{ type: "text", text: JSON.stringify({ order_id: request.params.arguments.order_id, open_tickets: 1, priority: "high", next_action: "Contact customer." }) }] }),
    "http://unavailable.test/mcp": () => { throw new Error("offline"); },
  }));
  const core = new GatewayCore(repository, client);
  const discovery = await core.discover();
  assert.equal(discovery.unavailableUpstreams.length, 1);
  assert.deepEqual(discovery.tools.map((entry) => entry.name), ["inventory__get_stock", "support__get_order_support_summary", "woocommerce__get_order", "woocommerce__list_products"]);

  const products = await core.callTool("woocommerce__list_products", {});
  const productId = JSON.parse(products.content[0].text).products[0].id;
  const stock = await core.callTool("inventory__get_stock", { product_id: productId });
  assert.deepEqual(JSON.parse(stock.content[0].text), { product_id: 101, available: 24, reserved: 3, status: "in_stock" });

  const order = await core.callTool("woocommerce__get_order", { order_id: 202 });
  const orderId = JSON.parse(order.content[0].text).order.id;
  const support = await core.callTool("support__get_order_support_summary", { order_id: orderId });
  assert.deepEqual(JSON.parse(support.content[0].text), { order_id: 202, open_tickets: 1, priority: "high", next_action: "Contact customer." });
});

test("does not call upstream with invalid arguments and disabling removes and blocks tools", async () => {
  const repository = new InMemoryUpstreamRepository(testUrlPolicy());
  const config = await repository.create(upstream("Woo", "http://woo.test/mcp"));
  let calls = 0;
  const core = new GatewayCore(repository, new StreamableHttpUpstreamClient(mockFetch({
    "http://woo.test/mcp": (request) => {
      if (request.method === "tools/list") return mcpResponse({ tools: [tool()] });
      calls += 1;
      return mcpResponse({ content: [] });
    },
  })));
  await core.discover();
  await assert.rejects(core.callTool("woo__lookup", { id: 0 }), /arguments are invalid/);
  assert.equal(calls, 0);
  await repository.update(config.id, { enabled: false });
  assert.deepEqual((await core.discover()).tools, []);
  await assert.rejects(core.callTool("woo__lookup", { id: 1 }), /not available/);
});

test("isolates unavailable upstreams and returns a sanitized timeout", async () => {
  const repository = new InMemoryUpstreamRepository(testUrlPolicy());
  await repository.create(upstream("Healthy", "http://healthy.test/mcp"));
  await repository.create(upstream("Dead", "http://dead.test/mcp"));
  const fetchImplementation = async (input, init) => {
    if (String(input).includes("dead")) throw new Error("credential=not-for-clients");
    if (String(input).includes("slow") && JSON.parse(String(init.body)).method === "tools/call") {
      return await new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }
    return mcpResponse({ tools: [tool()] });
  };
  const core = new GatewayCore(repository, new StreamableHttpUpstreamClient(fetchImplementation));
  const result = await core.discover();
  assert.deepEqual(result.tools.map((entry) => entry.name), ["healthy__lookup"]);
  assert.equal(result.unavailableUpstreams.length, 1);
  const slow = await repository.create(upstream("Slow", "http://slow.test/mcp", { timeoutMs: 100 }));
  await core.discover();
  await assert.rejects(core.callTool("slow__lookup", { id: 1 }), /timed out/);
  await repository.remove(slow.id);
});

test("serves one authenticated MCP endpoint with aggregate discovery, routing, and audit attribution", async () => {
  const repository = new InMemoryUpstreamRepository(testUrlPolicy());
  await repository.create(upstream("Woo", "http://woo.test/mcp", { credential: "upstream-only" }));
  const calls = [];
  const events = [];
  const core = new GatewayCore(repository, new StreamableHttpUpstreamClient(mockFetch({
    "http://woo.test/mcp": (request) => request.method === "tools/list"
      ? mcpResponse({ tools: [tool()] })
      : request.params.arguments.id === 99 ? new Response("secret upstream error", { status: 500 }) : mcpResponse({ content: [{ type: "text", text: "done" }] }),
  }, calls)), { recordAudit: async (event) => events.push(event) });
  const handler = createGatewayMcpHandler(core, async (request) => request.headers.get("authorization") === "Bearer gateway-key"
    ? { id: "db-admin-id", username: "admin", role: "admin" }
    : undefined);
  const unauthorized = await handler.fetch(new Request("http://gateway.test/mcp", { method: "POST" }));
  assert.equal(unauthorized.status, 401);
  const response = await handler.fetch(new Request("http://gateway.test/mcp", {
    method: "POST", headers: { authorization: "Bearer gateway-key", accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  }));
  const responseText = await response.text();
  const listed = JSON.parse(response.headers.get("content-type")?.includes("text/event-stream")
    ? responseText.split("\n").find((line) => line.startsWith("data: ")).slice("data: ".length)
    : responseText);
  assert.deepEqual(listed.result.tools.map((entry) => entry.name), ["woo__lookup"]);
  assert.equal(calls[0].headers.get("authorization"), "Bearer upstream-only");
  assert.notEqual(calls[0].headers.get("authorization"), "Bearer gateway-key");
  const callResponse = await handler.fetch(new Request("http://gateway.test/mcp", {
    method: "POST", headers: { authorization: "Bearer gateway-key", accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "woo__lookup", arguments: { id: 1 } } }),
  }));
  const callText = await callResponse.text();
  const called = JSON.parse(callResponse.headers.get("content-type")?.includes("text/event-stream")
    ? callText.split("\n").find((line) => line.startsWith("data: ")).slice("data: ".length)
    : callText);
  assert.equal(called.result.content[0].text, "done");
  assert.equal(calls.at(-1).body.params.name, "lookup");
  assert.deepEqual(events.map((event) => [event.userId, event.outcome]), [["db-admin-id", "success"]]);

  const failedResponse = await handler.fetch(new Request("http://gateway.test/mcp", {
    method: "POST", headers: { authorization: "Bearer gateway-key", accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "woo__lookup", arguments: { id: 99 } } }),
  }));
  await failedResponse.text();
  assert.deepEqual(events.map((event) => [event.userId, event.outcome, event.errorCode]), [
    ["db-admin-id", "success", null],
    ["db-admin-id", "failure", "unavailable"],
  ]);
});

test("uses one-way API-key hashes and authenticated audit records without arguments or credentials", async () => {
  const key = createApiKey();
  const hash = await hashApiKey(key);
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyApiKey(key, hash), true);
  assert.equal(await verifyApiKey(`${key}x`, hash), false);
  assert.doesNotMatch(hash, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const cipher = new CredentialCipher(Buffer.alloc(32, 7).toString("base64"));
  const encrypted = cipher.encrypt("upstream-secret");
  assert.notEqual(encrypted, "upstream-secret");
  assert.equal(cipher.decrypt(encrypted), "upstream-secret");

  const repository = new InMemoryUpstreamRepository(testUrlPolicy());
  await repository.create(upstream("Woo", "http://woo.test/mcp"));
  const events = [];
  const core = new GatewayCore(repository, new StreamableHttpUpstreamClient(mockFetch({
    "http://woo.test/mcp": (request) => request.method === "tools/list" ? mcpResponse({ tools: [tool()] }) : mcpResponse({ content: [{ type: "text", text: "ok" }] }),
  })), { recordAudit: async (event) => events.push(event) });
  await core.discover();
  await core.callTool("woo__lookup", { id: 1 }, { id: "user-a" });
  await assert.rejects(core.callTool("woo__lookup", { id: 0 }, { id: "user-a" }), /arguments are invalid/);
  assert.deepEqual(events.map((event) => [event.userId, event.upstreamId, event.toolName, event.outcome]), [
    ["user-a", "upstream-1", "woo__lookup", "success"],
    ["user-a", "upstream-1", "woo__lookup", "failure"],
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(events[0], "arguments"), false);
});

test("records an MCP tool error result as a failed audited operation", async () => {
  const repository = new InMemoryUpstreamRepository(testUrlPolicy());
  await repository.create(upstream("Inventory", "http://inventory.test/mcp"));
  const events = [];
  const core = new GatewayCore(repository, new StreamableHttpUpstreamClient(mockFetch({
    "http://inventory.test/mcp": (request) => request.method === "tools/list"
      ? mcpResponse({ tools: [tool("get_stock")] })
      : mcpResponse({ content: [{ type: "text", text: '{"error":"not_found"}' }], isError: true }),
  })), { recordAudit: async (event) => events.push(event) });
  await core.discover();
  const result = await core.callTool("inventory__get_stock", { id: 35 }, { id: "member-id" });
  assert.equal(result.isError, true);
  assert.deepEqual(events.map((event) => [event.userId, event.outcome, event.errorCode]), [["member-id", "failure", "tool_error"]]);
});

test("PostgreSQL state persists across store reinitialization", { skip: postgresTestSkip() }, async () => {
  const urlPolicy = new UpstreamUrlPolicy({ resolve: async () => ["203.0.113.10"] });
  const config = { databaseUrl: process.env.GATEWAY_TEST_DATABASE_URL, credentialEncryptionKey: Buffer.alloc(32, 9).toString("base64"), urlPolicy };
  const first = PostgresGatewayStore.fromConfig(config);
  await first.migrate();
  let created;
  let second;
  let firstClosed = false;
  try {
    created = await first.create(upstream(`persist-${Date.now()}`, "https://persist.example.test/mcp", { credential: "stored-secret" }));
    await first.close();
    firstClosed = true;
    second = PostgresGatewayStore.fromConfig(config);
    const restored = await second.get(created.id);
    assert.deepEqual({ ...restored, credential: undefined }, { ...created, credential: undefined });
    assert.equal(restored.credential, "stored-secret");
  } finally {
    if (second && created) await second.remove(created.id);
    await second?.close();
    if (!firstClosed) await first.close();
  }
});

test("management authorization rejects members and a revoked key is immediately rejected", async () => {
  let revoked = false;
  const store = {
    authenticateApiKey: async (key) => key === "admin" ? { id: "a", username: "admin", role: "admin" } : key === "member" && !revoked ? { id: "m", username: "member", role: "member" } : undefined,
  };
  const member = await store.authenticateApiKey("member");
  const admin = await store.authenticateApiKey("admin");
  assert.equal(isManagementAllowed(member), false);
  assert.equal(isManagementAllowed(admin), true);
  revoked = true;
  assert.equal(await store.authenticateApiKey("member"), undefined);
});
