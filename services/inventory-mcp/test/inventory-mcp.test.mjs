import assert from "node:assert/strict";
import test from "node:test";
import { createMcpHttpHandler, loadConfig } from "../dist/index.js";

test("serves Streamable HTTP MCP inventory tools on /mcp", async () => {
  assert.deepEqual(loadConfig({}), { port: 3001 });
  assert.throws(() => loadConfig({ PORT: "0" }), /configuration is invalid/);
  const response = await createMcpHttpHandler().fetch(new Request("http://localhost/mcp", {
    method: "POST", headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  }));
  const text = await response.text();
  const body = JSON.parse(response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data: ")).slice(6) : text);
  assert.equal(response.status, 200);
  assert.deepEqual(body.result.tools.map((tool) => tool.name), ["inventory_status"]);
});
