import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { Pool } from "pg";
import { createPersistentApplication, PostgresGatewayStore, StreamableHttpUpstreamClient, UpstreamUrlPolicy } from "../dist/index.js";
import { postgresTestSkip } from "./test-database.mjs";

const databaseUrl = process.env.GATEWAY_TEST_DATABASE_URL;
const integrationSkip = postgresTestSkip(databaseUrl);

function mcpResponse(result) { return Response.json({ jsonrpc: "2.0", id: "test", result }); }
function parseMcp(text, contentType) {
  return JSON.parse(contentType?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data: ")).slice(6) : text);
}

test("PostgreSQL-backed authenticated HTTP API persists roles, keys, upstreams, health, and audit", { skip: integrationSkip }, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const policy = new UpstreamUrlPolicy({ resolve: async () => ["203.0.113.10"] });
  const encryptionKey = Buffer.alloc(32, 13).toString("base64");
  const store = PostgresGatewayStore.fromConfig({ databaseUrl, credentialEncryptionKey: encryptionKey, urlPolicy: policy });
  const suffix = randomUUID();
  const userIds = [];
  const upstreamIds = [];
  let server;
  try {
    await store.migrate();
    const admin = await store.createUser(`admin-${suffix}`, "admin");
    userIds.push(admin.id);
    const adminKey = await store.issueApiKey(admin.id);
    let upstreamFailure = false;
    const client = new StreamableHttpUpstreamClient(async (_input, init) => {
      if (upstreamFailure) throw new Error("credential=never-return-this");
      const request = JSON.parse(init.body);
      if (request.method === "tools/call" && request.params.arguments.id === 99) return new Response("sensitive upstream failure", { status: 500 });
      return request.method === "tools/list"
        ? mcpResponse({ tools: [{ name: "lookup", inputSchema: { type: "object", properties: { id: { type: "integer", minimum: 1 } }, required: ["id"], additionalProperties: false } }] })
        : mcpResponse({ content: [{ type: "text", text: JSON.stringify({ id: request.params.arguments.id }) }] });
    });
    server = createPersistentApplication(store, { client, healthTtlMs: 0 });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address();
    const request = async (path, { method = "GET", key, body, mcp = false } = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body ? { "content-type": "application/json" } : {}), ...(mcp ? { accept: "application/json, text/event-stream" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      return { status: response.status, body: text ? (mcp ? parseMcp(text, response.headers.get("content-type")) : JSON.parse(text)) : undefined };
    };

    const memberCreated = await request("/api/users", { method: "POST", key: adminKey.key, body: { username: `member-${suffix}`, role: "member" } });
    assert.equal(memberCreated.status, 201);
    const member = memberCreated.body.user;
    userIds.push(member.id);
    const memberKeyResponse = await request(`/api/users/${member.id}/keys`, { method: "POST", key: adminKey.key, body: {} });
    assert.equal(memberKeyResponse.status, 201);
    const memberKey = memberKeyResponse.body.apiKey;
    assert.match(memberKey.key, /^urumi_/);
    const storedKey = await pool.query("SELECT key_hash FROM gateway_api_keys WHERE id=$1", [memberKey.id]);
    assert.match(storedKey.rows[0].key_hash, /^scrypt\$/);
    assert.notEqual(storedKey.rows[0].key_hash, memberKey.key);
    const secondMemberCreated = await request("/api/users", { method: "POST", key: adminKey.key, body: { username: `member-two-${suffix}`, role: "member" } });
    assert.equal(secondMemberCreated.status, 201);
    const secondMember = secondMemberCreated.body.user; userIds.push(secondMember.id);
    const secondKeyResponse = await request(`/api/users/${secondMember.id}/keys`, { method: "POST", key: adminKey.key, body: {} });
    assert.equal(secondKeyResponse.status, 201);
    const secondKey = secondKeyResponse.body.apiKey;
    const users = await request("/api/users", { key: adminKey.key });
    assert.doesNotMatch(JSON.stringify(users.body), new RegExp(`${memberKey.key}|${secondKey.key}`));

    assert.equal((await request("/api/status", { key: memberKey.key })).status, 200);
    assert.equal((await request("/api/users", { key: memberKey.key })).status, 403);
    assert.equal((await request("/api/upstreams/health", { key: memberKey.key })).status, 403);

    const created = await request("/api/upstreams", { method: "POST", key: adminKey.key, body: { name: `Fixture-${suffix}`, url: "https://upstream.test/mcp", credential: "upstream-secret", timeoutMs: 100 } });
    assert.equal(created.status, 201);
    const upstream = created.body.upstream;
    upstreamIds.push(upstream.id);
    assert.equal(Object.hasOwn(upstream, "credential"), false);
    assert.doesNotMatch(JSON.stringify(created.body), /upstream-secret/);
    const listed = await request("/api/upstreams", { key: adminKey.key });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.upstreams[0].id, upstream.id);
    assert.equal(Object.hasOwn(listed.body.upstreams[0], "credential"), false);
    const updated = await request(`/api/upstreams/${upstream.id}`, { method: "PATCH", key: adminKey.key, body: { url: "https://changed.test/mcp", enabled: false } });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.upstream.enabled, false);
    await request(`/api/upstreams/${upstream.id}`, { method: "PATCH", key: adminKey.key, body: { enabled: true } });

    const health = await request("/api/upstreams/health", { key: adminKey.key });
    assert.equal(health.status, 200);
    assert.deepEqual(health.body.upstreams.map(({ id, name, enabled, state, toolCount, error }) => ({ id, name, enabled, state, toolCount, error })), [{ id: upstream.id, name: `Fixture-${suffix}`, enabled: true, state: "reachable", toolCount: 1, error: null }]);
    assert.doesNotMatch(JSON.stringify(health.body), /secret|https:|203\.0\.113/);

    const tools = await request("/mcp", { method: "POST", key: memberKey.key, mcp: true, body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } });
    assert.equal(tools.status, 200);
    assert.deepEqual(tools.body.result.tools.map((tool) => tool.name), [`fixture_${suffix.replaceAll("-", "_")}__lookup`]);
    const toolName = tools.body.result.tools[0].name;
    const successfulCall = await request("/mcp", { method: "POST", key: memberKey.key, mcp: true, body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: { id: 7 } } } });
    assert.equal(successfulCall.body.result.content[0].text, '{"id":7}');
    const failedCall = await request("/mcp", { method: "POST", key: memberKey.key, mcp: true, body: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: toolName, arguments: { id: 99 } } } });
    assert.equal(failedCall.body.result.isError, true);
    assert.equal((await request("/mcp", { method: "POST", key: secondKey.key, mcp: true, body: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: toolName, arguments: { id: 8 } } } })).body.result.content[0].text, '{"id":8}');
    const audit = await request("/api/audit", { key: adminKey.key });
    assert.deepEqual(audit.body.events.slice(0, 3).map((event) => [event.userId, event.upstreamId, event.toolName, event.outcome]), [[secondMember.id, upstream.id, toolName, "success"], [member.id, upstream.id, toolName, "failure"], [member.id, upstream.id, toolName, "success"]]);

    upstreamFailure = true;
    const failedHealth = await request("/api/upstreams/health", { key: adminKey.key });
    assert.deepEqual(failedHealth.body.upstreams[0].error, "unavailable");
    assert.doesNotMatch(JSON.stringify(failedHealth.body), /never-return-this|changed\.test/);
    assert.equal((await request(`/api/keys/${memberKey.id}`, { method: "DELETE", key: adminKey.key })).status, 204);
    assert.equal((await request("/api/status", { key: memberKey.key })).status, 401);
    assert.equal((await request("/mcp", { method: "POST", key: memberKey.key, mcp: true, body: { jsonrpc: "2.0", id: 5, method: "tools/list", params: {} } })).status, 401);
    assert.equal((await request("/api/chat", { method: "POST", key: memberKey.key, body: { message: "hi" } })).status, 401);
    assert.equal((await request("/api/status", { key: secondKey.key })).status, 200);

    const secondStore = PostgresGatewayStore.fromConfig({ databaseUrl, credentialEncryptionKey: encryptionKey, urlPolicy: policy });
    assert.equal((await secondStore.get(upstream.id)).enabled, true);
    await secondStore.close();
    assert.equal((await request(`/api/upstreams/${upstream.id}`, { method: "DELETE", key: adminKey.key })).status, 204);
    upstreamIds.pop();
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    if (upstreamIds.length) await pool.query("DELETE FROM gateway_audit_events WHERE upstream_id = ANY($1::uuid[])", [upstreamIds]);
    if (userIds.length) await pool.query("DELETE FROM gateway_audit_events WHERE user_id = ANY($1::uuid[])", [userIds]);
    if (upstreamIds.length) await pool.query("DELETE FROM gateway_upstreams WHERE id = ANY($1::uuid[])", [upstreamIds]);
    if (userIds.length) await pool.query("DELETE FROM gateway_users WHERE id = ANY($1::uuid[])", [userIds]);
    await store.close();
    await pool.end();
  }
});
