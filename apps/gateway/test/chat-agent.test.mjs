import assert from "node:assert/strict";
import test from "node:test";
import { ChatAgent, GatewayCore, InMemoryUpstreamRepository, StreamableHttpUpstreamClient, UpstreamUrlPolicy } from "../dist/index.js";

const policy = new UpstreamUrlPolicy({ resolve: async () => ["203.0.113.1"] });
const response = (result) => Response.json({ jsonrpc: "2.0", id: 1, result });

test("chat agent dynamically discovers tools, executes through GatewayCore, and attributes the caller", async () => {
  const repo = new InMemoryUpstreamRepository(policy); await repo.create({ name: "Inventory", url: "https://inventory.test/mcp", enabled: true, timeoutMs: 100 });
  const audit = []; const core = new GatewayCore(repo, new StreamableHttpUpstreamClient(async (_url, init) => {
    const request = JSON.parse(init.body); return request.method === "tools/list" ? response({ tools: [{ name: "get_stock", inputSchema: { type: "object", properties: { product_id: { type: "integer", minimum: 1 } }, required: ["product_id"] } }] }) : response({ content: [{ type: "text", text: '{"available":24}' }] });
  }), { recordAudit: async (event) => audit.push(event) });
  const replies = [{ content: null, toolCalls: [{ id: "call-1", name: "inventory__get_stock", arguments: { product_id: 101 } }] }, { content: "There are 24 available.", toolCalls: [] }];
  const agent = new ChatAgent(core, { complete: async () => replies.shift() }, 3);
  const result = await agent.respond("stock?", [], { id: "authenticated-user" });
  assert.deepEqual(result, { message: "There are 24 available.", status: "completed", traces: [{ toolName: "inventory__get_stock", status: "success", durationMs: result.traces[0].durationMs, error: null, argumentKeys: ["product_id"] }] });
  assert.equal(audit[0].userId, "authenticated-user");
});

test("chat agent bounds iterations and sanitizes invalid tool failures", async () => {
  const repo = new InMemoryUpstreamRepository(policy); await repo.create({ name: "Inventory", url: "https://inventory.test/mcp", enabled: true, timeoutMs: 100 });
  const core = new GatewayCore(repo, new StreamableHttpUpstreamClient(async (_url, init) => JSON.parse(init.body).method === "tools/list" ? response({ tools: [{ name: "get_stock", inputSchema: { type: "object", properties: { product_id: { type: "integer", minimum: 1 } }, required: ["product_id"] } }] }) : response({ content: [] })));
  const agent = new ChatAgent(core, { complete: async () => ({ content: null, toolCalls: [{ id: "x", name: "inventory__get_stock", arguments: { product_id: 0 } }] }) }, 1);
  const result = await agent.respond("x", [], { id: "user" });
  assert.equal(result.status, "stopped"); assert.equal(result.traces[0].error, "invalid_arguments"); assert.deepEqual(result.traces[0].argumentKeys, ["product_id"]);
});

test("chat traces an MCP tool error response as a failure", async () => {
  const repo = new InMemoryUpstreamRepository(policy); await repo.create({ name: "Inventory", url: "https://inventory.test/mcp", enabled: true, timeoutMs: 100 });
  const core = new GatewayCore(repo, new StreamableHttpUpstreamClient(async (_url, init) => JSON.parse(init.body).method === "tools/list"
    ? response({ tools: [{ name: "get_stock", inputSchema: { type: "object", properties: { product_id: { type: "integer", minimum: 1 } }, required: ["product_id"] } }] })
    : response({ content: [{ type: "text", text: '{"error":"not_found"}' }], isError: true })));
  const replies = [{ content: null, toolCalls: [{ id: "not-found", name: "inventory__get_stock", arguments: { product_id: 35 } }] }, { content: "No stock record was found.", toolCalls: [] }];
  const result = await new ChatAgent(core, { complete: async () => replies.shift() }, 2).respond("stock?", [], { id: "user" });
  assert.equal(result.status, "completed");
  assert.deepEqual({ ...result.traces[0], durationMs: undefined }, { toolName: "inventory__get_stock", status: "failure", durationMs: undefined, error: "tool_error", argumentKeys: ["product_id"] });
});
