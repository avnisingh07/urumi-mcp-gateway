import assert from "node:assert/strict";
import test from "node:test";
import {
  createMcpHttpHandler,
  healthResponse,
  loadConfig,
  readinessResponse,
  WooCommerceClient,
} from "../dist/index.js";

const environment = {
  WOOCOMMERCE_BASE_URL: "http://woocommerce.internal/",
  WOOCOMMERCE_CONSUMER_KEY: "ck_test_key",
  WOOCOMMERCE_CONSUMER_SECRET: "cs_test_secret",
};

function config() {
  return loadConfig(environment);
}

async function mcpRequest(fetchImplementation, body) {
  const handler = createMcpHttpHandler(new WooCommerceClient(config(), fetchImplementation));
  const response = await handler.fetch(new Request("http://localhost/mcp", {
    method: "POST",
    headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  const responseText = await response.text();
  const json = response.headers.get("content-type")?.includes("text/event-stream")
    ? responseText.split("\n").find((line) => line.startsWith("data: "))?.slice("data: ".length)
    : responseText;
  return { status: response.status, body: JSON.parse(json ?? "") };
}

const product = {
  id: 101,
  name: "Test product",
  slug: "test-product",
  status: "draft",
  type: "simple",
  regular_price: "12.50",
  price: "12.50",
  stock_status: "instock",
  permalink: "http://example.test/product/test-product",
  billing: { email: "must-not-leak@example.test" },
};

const order = {
  id: 202,
  status: "processing",
  currency: "USD",
  total: "12.50",
  date_created: "2026-10-24T00:00:00",
  date_modified: "2026-10-24T00:00:00",
  payment_method_title: "must-not-leak",
  billing: { email: "must-not-leak@example.test" },
  line_items: [{ id: 1, product_id: 101, name: "Test product", quantity: 1, total: "12.50", sku: "must-not-leak" }],
};

function successfulWooFetch(calls = []) {
  return async (input, init) => {
    calls.push([new URL(input), init]);
    const url = new URL(input);
    if (url.pathname.endsWith("system_status")) return Response.json({ environment: {} });
    if (url.pathname.endsWith("products") && init?.method === "POST") return Response.json(product);
    if (url.pathname.endsWith("products")) return Response.json([product]);
    if (/orders\/\d+$/.test(url.pathname) && init?.method === "PUT") return Response.json({ ...order, status: "completed" });
    if (/orders\/\d+$/.test(url.pathname)) return Response.json(order);
    if (url.pathname.endsWith("orders")) return Response.json([order]);
    return new Response(null, { status: 404 });
  };
}

test("loads safe configuration and rejects invalid settings without returning secrets", () => {
  assert.deepEqual(loadConfig(environment), {
    port: 3000,
    baseUrl: "http://woocommerce.internal",
    consumerKey: "ck_test_key",
    consumerSecret: "cs_test_secret",
    requestTimeoutMs: 10_000,
  });
  assert.throws(
    () => loadConfig({ WOOCOMMERCE_BASE_URL: "http://woocommerce.internal" }),
    /WooCommerce MCP configuration is invalid/,
  );
  assert.throws(
    () => loadConfig({ ...environment, WOOCOMMERCE_REQUEST_TIMEOUT_MS: "50" }),
    /WooCommerce MCP configuration is invalid/,
  );
});

test("constructs authenticated REST API requests for all five operations", async () => {
  const calls = [];
  const client = new WooCommerceClient(config(), successfulWooFetch(calls));
  await client.listProducts({ page: 2, per_page: 25, search: "shirt", status: "publish" });
  await client.createProduct({ name: "New product", type: "simple", regular_price: "10.00" });
  await client.listOrders({ page: 3, per_page: 5, status: "processing" });
  await client.getOrder(42);
  await client.updateOrderStatus(42, "completed");

  assert.equal(calls[0][0].toString(), "http://woocommerce.internal/wp-json/wc/v3/products?page=2&per_page=25&search=shirt&status=publish");
  assert.equal(new Headers(calls[0][1].headers).get("authorization"), `Basic ${Buffer.from("ck_test_key:cs_test_secret").toString("base64")}`);
  assert.equal(calls[1][0].pathname, "/wp-json/wc/v3/products");
  assert.equal(calls[1][1].method, "POST");
  assert.equal(calls[1][1].body, JSON.stringify({ name: "New product", type: "simple", regular_price: "10.00" }));
  assert.equal(calls[2][0].toString(), "http://woocommerce.internal/wp-json/wc/v3/orders?page=3&per_page=5&status=processing");
  assert.equal(calls[3][0].pathname, "/wp-json/wc/v3/orders/42");
  assert.equal(calls[4][0].pathname, "/wp-json/wc/v3/orders/42");
  assert.equal(calls[4][1].method, "PUT");
  assert.equal(calls[4][1].body, JSON.stringify({ status: "completed" }));
});

test("normalizes malformed response, network, timeout, and HTTP failures", async () => {
  const shortTimeoutConfig = loadConfig({ ...environment, WOOCOMMERCE_REQUEST_TIMEOUT_MS: "100" });
  await assert.rejects(
    new WooCommerceClient(shortTimeoutConfig, async () => new Response("sensitive", { status: 500 })).getOrder(1),
    /WooCommerce could not complete this request/,
  );
  await assert.rejects(
    new WooCommerceClient(shortTimeoutConfig, async () => new Response("not-json")).getOrder(1),
    /WooCommerce returned an invalid response/,
  );
  await assert.rejects(
    new WooCommerceClient(shortTimeoutConfig, async () => Promise.reject(new Error("cs_test_secret"))).getOrder(1),
    /The WooCommerce service is unavailable/,
  );
  const neverReturns = (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
  await assert.rejects(new WooCommerceClient(shortTimeoutConfig, neverReturns).getOrder(1), /The WooCommerce request timed out/);
});

test("serves health, readiness, MCP initialization, discovery, and all five redacted tools", async () => {
  const wooFetch = successfulWooFetch();
  assert.equal((await healthResponse()).status, 200);
  assert.equal((await readinessResponse(new WooCommerceClient(config(), wooFetch))).status, 200);

  const initialize = await mcpRequest(wooFetch, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  });
  assert.equal(initialize.status, 200);

  const listed = await mcpRequest(wooFetch, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.deepEqual(listed.body.result.tools.map((tool) => tool.name), [
    "list_products",
    "create_product",
    "list_orders",
    "get_order",
    "update_order_status",
  ]);

  for (const [name, arguments_] of [
    ["list_products", { page: 1, per_page: 10 }],
    ["create_product", { name: "Test product", regular_price: "12.50" }],
    ["list_orders", { page: 1, per_page: 10 }],
    ["get_order", { order_id: 202 }],
    ["update_order_status", { order_id: 202, status: "completed" }],
  ]) {
    const response = await mcpRequest(wooFetch, {
      jsonrpc: "2.0",
      id: name,
      method: "tools/call",
      params: { name, arguments: arguments_ },
    });
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.body.result.content[0].text, /must-not-leak/);
  }
});

test("rejects invalid tool arguments before upstream calls and sanitizes failures", async () => {
  let called = false;
  const failingWooFetch = async () => {
    called = true;
    return new Response("sensitive-upstream-body", { status: 500 });
  };

  for (const params of [
    { name: "create_product", arguments: { name: "", regular_price: "0" } },
    { name: "list_products", arguments: { page: 0, per_page: 10 } },
    { name: "get_order", arguments: { order_id: 0 } },
    { name: "update_order_status", arguments: { order_id: 202, status: "unknown" } },
  ]) {
    const response = await mcpRequest(failingWooFetch, { jsonrpc: "2.0", id: params.name, method: "tools/call", params });
    assert.equal(response.status, 200);
    assert.equal(called, false);
  }

  const failure = await mcpRequest(failingWooFetch, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "get_order", arguments: { order_id: 202 } },
  });
  assert.equal(failure.body.result.isError, true);
  assert.match(failure.body.result.content[0].text, /WooCommerce could not complete this request/);
  assert.doesNotMatch(failure.body.result.content[0].text, /sensitive-upstream-body/);
});
