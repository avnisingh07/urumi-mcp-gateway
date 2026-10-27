import { createStatusMcpService } from "@urumi/shared";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export type StockRecord = {
  product_id: number;
  available: number | null;
  reserved: null;
  status: "in_stock" | "out_of_stock" | "on_backorder" | "unknown";
  manage_stock: boolean;
};

type WooCommerceProduct = {
  id: number;
  stock_quantity: number | null;
  stock_status: string;
  manage_stock: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadWooCommerceConfig() {
  const baseUrl = process.env.WOOCOMMERCE_BASE_URL?.replace(/\/+$/, "");
  const consumerKey = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const consumerSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
  const timeoutMs = Number(process.env.WOOCOMMERCE_REQUEST_TIMEOUT_MS ?? 10_000);

  if (
    !baseUrl ||
    !baseUrl.startsWith("https://") ||
    !consumerKey ||
    !consumerSecret ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 30_000
  ) {
    throw new Error("WooCommerce inventory configuration is invalid.");
  }

  return { baseUrl, consumerKey, consumerSecret, timeoutMs };
}

export async function getStock(productId: number): Promise<StockRecord | undefined> {
  const config = loadWooCommerceConfig();
  const url = new URL(
    `wp-json/wc/v3/products/${productId}`,
    `${config.baseUrl}/`,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const credentials = Buffer.from(
    `${config.consumerKey}:${config.consumerSecret}`,
  ).toString("base64");

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${credentials}`,
      },
      signal: controller.signal,
    });

    if (response.status === 404) return undefined;

    if (!response.ok) {
      // Do not include credentials or upstream response bodies in tool errors.
      throw new Error(
        response.status === 401 || response.status === 403
          ? "WooCommerce rejected the inventory service credentials."
          : "WooCommerce could not complete the inventory request.",
      );
    }

    const value: unknown = await response.json();

    if (
      !isRecord(value) ||
      value.id !== productId ||
      typeof value.stock_status !== "string" ||
      typeof value.manage_stock !== "boolean" ||
      !(
        typeof value.stock_quantity === "number" ||
        value.stock_quantity === null
      )
    ) {
      throw new Error("WooCommerce returned an invalid product response.");
    }

    const product = value as unknown as WooCommerceProduct;

    const status: StockRecord["status"] =
      product.stock_status === "instock"
        ? "in_stock"
        : product.stock_status === "outofstock"
          ? "out_of_stock"
          : product.stock_status === "onbackorder"
            ? "on_backorder"
            : "unknown";

    return {
      product_id: product.id,
      available: product.manage_stock ? product.stock_quantity : null,
      reserved: null,
      status,
      manage_stock: product.manage_stock,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("WooCommerce inventory request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function registerInventoryTools(server: McpServer): void {
  server.registerTool(
    "get_stock",
    {
      description:
        "Get live stock status and managed quantity for a WooCommerce product ID. Reserved quantity is not tracked by this service.",
      inputSchema: {
        product_id: z.number().int().positive(),
      },
    },
    async ({ product_id }) => {
      try {
        const stock = await getStock(product_id);

        return stock
          ? {
              content: [
                { type: "text" as const, text: JSON.stringify(stock) },
              ],
            }
          : {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ error: "not_found", product_id }),
                },
              ],
              isError: true,
            };
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "inventory_upstream_unavailable",
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}

const service = createStatusMcpService({
  service: "Inventory",
  serverName: "urumi-inventory-mcp",
  toolName: "inventory_status",
  defaultPort: 3001,
  registerTools: registerInventoryTools,
});

export const { loadConfig, createMcpHttpHandler, createApplication } = service;

function start(): void {
  const { port } = loadConfig();
  // Fail fast if the required WooCommerce configuration is missing.
  loadWooCommerceConfig();
  createApplication().listen(port, "0.0.0.0", () => {
    console.error(`Inventory MCP listening on port ${port}`);
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  start();
}