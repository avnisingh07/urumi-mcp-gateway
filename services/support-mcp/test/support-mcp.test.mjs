import assert from "node:assert/strict";
import test from "node:test";
import { createMcpHttpHandler, getOrderSupportSummary, loadConfig } from "../dist/index.js";

const envKeys = ["WOOCOMMERCE_BASE_URL", "WOOCOMMERCE_CONSUMER_KEY", "WOOCOMMERCE_CONSUMER_SECRET", "WOOCOMMERCE_REQUEST_TIMEOUT_MS"];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function configureWoo() {
  process.env.WOOCOMMERCE_BASE_URL = "https://woocommerce.example.test";
  process.env.WOOCOMMERCE_CONSUMER_KEY = "test_consumer_key";
  process.env.WOOCOMMERCE_CONSUMER_SECRET = "test_consumer_secret";
  process.env.WOOCOMMERCE_REQUEST_TIMEOUT_MS = "10000";
}
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
async function request(method, params = {}) {
  const response = await createMcpHttpHandler().fetch(new Request("http://localhost/mcp", {
    method: "POST", headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }));
  const text = await response.text();
  const json = response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data: ")).slice(6) : text;
  return { status: response.status, body: JSON.parse(json) };
}

test.after(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test("serves Streamable HTTP MCP support tools on /mcp", async () => {
  assert.deepEqual(loadConfig({}), { port: 3002 });
  assert.throws(() => loadConfig({ PORT: "0" }), /configuration is invalid/);
  const { status, body } = await request("tools/list");
  assert.equal(status, 200);
  assert.deepEqual(body.result.tools.map((tool) => tool.name).sort(), ["get_order_support_summary", "support_status"]);
  const summaryTool = body.result.tools.find((tool) => tool.name === "get_order_support_summary");
  assert.deepEqual(summaryTool.inputSchema.required, ["order_id"]);
});

test("looks up any valid live order ID instead of relying on hardcoded fixtures", async () => {
  configureWoo();
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse({ id: 38, status: "processing" });
  };
  const result = await getOrderSupportSummary(38, mockFetch);
  assert.deepEqual(result, {
    order_id: 38,
    order_status: "processing",
    support_data_available: false,
    open_tickets: null,
    priority: "unknown",
    next_action: "No ticketing system is connected. Review the order status in WooCommerce or connect a support system for ticket details.",
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/wp-json\/wc\/v3\/orders\/38$/);
  assert.equal(calls[0].options.method, "GET");
  assert.match(calls[0].options.headers.Authorization, /^Basic /);
});

test("MCP tool returns live-order support availability for a real order ID", async () => {
  configureWoo();
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/wp-json\/wc\/v3\/orders\/38$/);
    return jsonResponse({ id: 38, status: "processing" });
  };
  const response = await request("tools/call", { name: "get_order_support_summary", arguments: { order_id: 38 } });
  assert.equal(response.status, 200);
  assert.equal(response.body.result.isError, undefined);
  const result = JSON.parse(response.body.result.content[0].text);
  assert.equal(result.order_id, 38);
  assert.equal(result.order_status, "processing");
  assert.equal(result.support_data_available, false);
  assert.equal(result.open_tickets, null);
});

test("returns not_found when WooCommerce does not have the requested order", async () => {
  configureWoo();
  const result = await getOrderSupportSummary(999, async () => jsonResponse({ code: "woocommerce_rest_shop_order_invalid_id" }, 404));
  assert.equal(result, undefined);
});

test("returns sanitized error when WooCommerce is unavailable", async () => {
  configureWoo();
  await assert.rejects(
    () => getOrderSupportSummary(38, async () => jsonResponse({ message: "private upstream detail" }, 500)),
    /could not complete the support request/,
  );
});

test("rejects invalid support inputs", async () => {
  for (const order_id of [0, -1, 1.5, "38", undefined]) {
    const response = await request("tools/call", { name: "get_order_support_summary", arguments: order_id === undefined ? {} : { order_id } });
    assert.equal(response.status, 200);
    assert.equal(response.body.result.isError, true);
  }
});
