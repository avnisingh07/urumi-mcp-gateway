import assert from "node:assert/strict";
import test from "node:test";
import {
  createMcpHttpHandler,
  getStock,
  loadConfig,
} from "../dist/index.js";

const wooProduct = {
  id: 101,
  stock_quantity: 24,
  stock_status: "instock",
  manage_stock: true,
};

async function withWooCommerce(mockFetch, run) {
  const envKeys = [
    "WOOCOMMERCE_BASE_URL",
    "WOOCOMMERCE_CONSUMER_KEY",
    "WOOCOMMERCE_CONSUMER_SECRET",
    "WOOCOMMERCE_REQUEST_TIMEOUT_MS",
  ];

  const originalEnv = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
  );
  const originalFetch = globalThis.fetch;

  process.env.WOOCOMMERCE_BASE_URL =
    "https://woocommerce.example.test";
  process.env.WOOCOMMERCE_CONSUMER_KEY = "test_consumer_key";
  process.env.WOOCOMMERCE_CONSUMER_SECRET = "test_consumer_secret";
  process.env.WOOCOMMERCE_REQUEST_TIMEOUT_MS = "10000";
  globalThis.fetch = mockFetch;

  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;

    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function request(method, params = {}) {
  const response = await createMcpHttpHandler().fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    }),
  );

  const text = await response.text();
  const json = response.headers
    .get("content-type")
    ?.includes("text/event-stream")
    ? text.split("\n").find((line) => line.startsWith("data: ")).slice(6)
    : text;

  return { status: response.status, body: JSON.parse(json) };
}

test("serves Streamable HTTP MCP inventory tools on /mcp", async () => {
  assert.deepEqual(loadConfig({}), { port: 3001 });
  assert.throws(
    () => loadConfig({ PORT: "0" }),
    /configuration is invalid/,
  );

  const { status, body } = await request("tools/list");

  assert.equal(status, 200);
  assert.deepEqual(
    body.result.tools.map((tool) => tool.name).sort(),
    ["get_stock", "inventory_status"],
  );

  const getStockTool = body.result.tools.find(
    (tool) => tool.name === "get_stock",
  );
  assert.deepEqual(getStockTool.inputSchema.required, ["product_id"]);
});

test("fetches live product stock from WooCommerce", async () => {
  await withWooCommerce(
    async (url, options) => {
      assert.match(String(url), /\/wp-json\/wc\/v3\/products\/101$/);
      assert.equal(options.method, "GET");
      assert.match(options.headers.Authorization, /^Basic /);
      return jsonResponse(wooProduct);
    },
    async () => {
      assert.deepEqual(await getStock(101), {
        product_id: 101,
        available: 24,
        reserved: null,
        status: "in_stock",
        manage_stock: true,
      });

      const { status, body } = await request("tools/call", {
        name: "get_stock",
        arguments: { product_id: 101 },
      });

      assert.equal(status, 200);
      assert.deepEqual(
        JSON.parse(body.result.content[0].text),
        {
          product_id: 101,
          available: 24,
          reserved: null,
          status: "in_stock",
          manage_stock: true,
        },
      );
    },
  );
});

test("returns not_found when WooCommerce returns 404", async () => {
  await withWooCommerce(
    async () => jsonResponse({ code: "woocommerce_rest_product_invalid_id" }, 404),
    async () => {
      assert.equal(await getStock(999), undefined);

      const { body } = await request("tools/call", {
        name: "get_stock",
        arguments: { product_id: 999 },
      });

      assert.equal(body.result.isError, true);
      assert.deepEqual(
        JSON.parse(body.result.content[0].text),
        { error: "not_found", product_id: 999 },
      );
    },
  );
});

test("returns null available quantity when stock management is disabled", async () => {
  await withWooCommerce(
    async () =>
      jsonResponse({
        id: 40,
        stock_quantity: null,
        stock_status: "instock",
        manage_stock: false,
      }),
    async () => {
      assert.deepEqual(await getStock(40), {
        product_id: 40,
        available: null,
        reserved: null,
        status: "in_stock",
        manage_stock: false,
      });
    },
  );
});

test("reports upstream failures without exposing credentials", async () => {
  await withWooCommerce(
    async () => jsonResponse({ message: "upstream failure" }, 500),
    async () => {
      const { body } = await request("tools/call", {
        name: "get_stock",
        arguments: { product_id: 101 },
      });

      assert.equal(body.result.isError, true);
      assert.deepEqual(
        JSON.parse(body.result.content[0].text),
        { error: "inventory_upstream_unavailable" },
      );
    },
  );
});

test("rejects invalid stock inputs", async () => {
  for (const product_id of [0, -1, 1.5, "101", undefined]) {
    const { status, body } = await request("tools/call", {
      name: "get_stock",
      arguments:
        product_id === undefined ? {} : { product_id },
    });

    assert.equal(status, 200);
    assert.equal(body.result.isError, true);
  }
});
