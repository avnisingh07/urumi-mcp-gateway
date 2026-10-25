import assert from "node:assert/strict";
import test from "node:test";
import { createMcpHttpHandler, getStock, loadConfig } from "../dist/index.js";

async function request(method, params = {}) {
  const response = await createMcpHttpHandler().fetch(new Request("http://localhost/mcp", {
    method: "POST", headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }));
  const text = await response.text();
  const json = response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data: ")).slice(6) : text;
  return { status: response.status, body: JSON.parse(json) };
}

test("serves Streamable HTTP MCP inventory tools on /mcp", async () => {
  assert.deepEqual(loadConfig({}), { port: 3001 });
  assert.throws(() => loadConfig({ PORT: "0" }), /configuration is invalid/);
  const { status, body } = await request("tools/list");
  assert.equal(status, 200);
  assert.deepEqual(body.result.tools.map((tool) => tool.name).sort(), ["get_stock", "inventory_status"]);
  const getStockTool = body.result.tools.find((tool) => tool.name === "get_stock");
  assert.deepEqual(getStockTool.inputSchema.required, ["product_id"]);
});

test("returns deterministic stock records and predictable not-found results", async () => {
  assert.deepEqual(getStock(101), { product_id: 101, available: 24, reserved: 3, status: "in_stock" });
  assert.equal(getStock(999), undefined);
  const known = await request("tools/call", { name: "get_stock", arguments: { product_id: 101 } });
  assert.equal(known.status, 200);
  assert.deepEqual(JSON.parse(known.body.result.content[0].text), { product_id: 101, available: 24, reserved: 3, status: "in_stock" });
  const unknown = await request("tools/call", { name: "get_stock", arguments: { product_id: 999 } });
  assert.equal(unknown.body.result.isError, true);
  assert.deepEqual(JSON.parse(unknown.body.result.content[0].text), { error: "not_found", product_id: 999 });
});

test("rejects invalid stock inputs", async () => {
  for (const product_id of [0, -1, 1.5, "101", undefined]) {
    const response = await request("tools/call", { name: "get_stock", arguments: product_id === undefined ? {} : { product_id } });
    assert.equal(response.status, 200);
    assert.equal(response.body.result.isError, true);
  }
});
