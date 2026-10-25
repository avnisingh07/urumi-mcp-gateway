import assert from "node:assert/strict";
import test from "node:test";
import { createMcpHttpHandler, getOrderSupportSummary, loadConfig } from "../dist/index.js";

async function request(method, params = {}) {
  const response = await createMcpHttpHandler().fetch(new Request("http://localhost/mcp", {
    method: "POST", headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }));
  const text = await response.text();
  const json = response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data: ")).slice(6) : text;
  return { status: response.status, body: JSON.parse(json) };
}

test("serves Streamable HTTP MCP support tools on /mcp", async () => {
  assert.deepEqual(loadConfig({}), { port: 3002 });
  assert.throws(() => loadConfig({ PORT: "0" }), /configuration is invalid/);
  const { status, body } = await request("tools/list");
  assert.equal(status, 200);
  assert.deepEqual(body.result.tools.map((tool) => tool.name).sort(), ["get_order_support_summary", "support_status"]);
  const summaryTool = body.result.tools.find((tool) => tool.name === "get_order_support_summary");
  assert.deepEqual(summaryTool.inputSchema.required, ["order_id"]);
});

test("returns deterministic support summaries and predictable not-found results", async () => {
  assert.deepEqual(getOrderSupportSummary(202), { order_id: 202, open_tickets: 1, priority: "high", next_action: "Contact the customer about the processing delay." });
  assert.equal(getOrderSupportSummary(999), undefined);
  const known = await request("tools/call", { name: "get_order_support_summary", arguments: { order_id: 202 } });
  assert.equal(known.status, 200);
  assert.deepEqual(JSON.parse(known.body.result.content[0].text), { order_id: 202, open_tickets: 1, priority: "high", next_action: "Contact the customer about the processing delay." });
  const unknown = await request("tools/call", { name: "get_order_support_summary", arguments: { order_id: 999 } });
  assert.equal(unknown.body.result.isError, true);
  assert.deepEqual(JSON.parse(unknown.body.result.content[0].text), { error: "not_found", order_id: 999 });
});

test("rejects invalid support inputs", async () => {
  for (const order_id of [0, -1, 1.5, "202", undefined]) {
    const response = await request("tools/call", { name: "get_order_support_summary", arguments: order_id === undefined ? {} : { order_id } });
    assert.equal(response.status, 200);
    assert.equal(response.body.result.isError, true);
  }
});
