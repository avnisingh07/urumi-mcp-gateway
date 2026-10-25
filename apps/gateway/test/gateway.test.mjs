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
} from "../dist/index.js";

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
  const repository = new InMemoryUpstreamRepository();
  const created = await repository.create(upstream("Woo Commerce", "http://woo.test/mcp", { credential: "secret" }));
  assert.equal(created.id, "upstream-1");
  assert.equal((await repository.update(created.id, { enabled: false })).enabled, false);
  await assert.rejects(repository.create(upstream("woo-commerce", "http://other.test/mcp")), /unique tool namespaces/);
  assert.equal(await repository.remove(created.id), true);
});

test("discovers three enabled upstreams, namespaces deterministically, and routes each call", async () => {
  const repository = new InMemoryUpstreamRepository();
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

test("does not call upstream with invalid arguments and disabling removes and blocks tools", async () => {
  const repository = new InMemoryUpstreamRepository();
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
  const repository = new InMemoryUpstreamRepository();
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
  const repository = new InMemoryUpstreamRepository();
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

  const repository = new InMemoryUpstreamRepository();
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

test("PostgreSQL state persists across store reinitialization", { skip: !process.env.GATEWAY_TEST_DATABASE_URL }, async () => {
  const config = { databaseUrl: process.env.GATEWAY_TEST_DATABASE_URL, credentialEncryptionKey: Buffer.alloc(32, 9).toString("base64") };
  const first = PostgresGatewayStore.fromConfig(config);
  await first.migrate();
  const created = await first.create(upstream(`persist-${Date.now()}`, "http://persist.test/mcp", { credential: "stored-secret" }));
  await first.close();
  const second = PostgresGatewayStore.fromConfig(config);
  const restored = await second.get(created.id);
  assert.deepEqual({ ...restored, credential: undefined }, { ...created, credential: undefined });
  assert.equal(restored.credential, "stored-secret");
  await second.remove(created.id);
  await second.close();
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
