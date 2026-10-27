import { createStatusMcpService } from "@urumi/shared";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

/**
 * The Support MCP currently has no ticketing-system integration. It verifies
 * the requested order against the live WooCommerce API and reports that
 * ticket-specific fields are unavailable instead of fabricating fixture data.
 */
export type OrderSupportSummary = {
  order_id: number;
  order_status: string;
  support_data_available: false;
  open_tickets: null;
  priority: "unknown";
  next_action: string;
};

type WooCommerceOrder = { id: number; status: string };
type FetchImplementation = (input: URL | string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadWooCommerceConfig(environment: NodeJS.ProcessEnv = process.env) {
  const baseUrl = environment.WOOCOMMERCE_BASE_URL?.replace(/\/+$/, "");
  const consumerKey = environment.WOOCOMMERCE_CONSUMER_KEY;
  const consumerSecret = environment.WOOCOMMERCE_CONSUMER_SECRET;
  const timeoutMs = Number(environment.WOOCOMMERCE_REQUEST_TIMEOUT_MS ?? 10_000);

  if (
    !baseUrl || !baseUrl.startsWith("https://") || !consumerKey || !consumerSecret ||
    !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000
  ) {
    throw new Error("WooCommerce support configuration is invalid.");
  }
  return { baseUrl, consumerKey, consumerSecret, timeoutMs };
}

export async function getOrderSupportSummary(
  orderId: number,
  fetchImplementation: FetchImplementation = fetch,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<OrderSupportSummary | undefined> {
  if (!Number.isSafeInteger(orderId) || orderId < 1) throw new Error("Invalid order ID.");
  const config = loadWooCommerceConfig(environment);
  const url = new URL(`wp-json/wc/v3/orders/${orderId}`, `${config.baseUrl}/`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const credentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64");

  try {
    const response = await fetchImplementation(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Basic ${credentials}` },
      signal: controller.signal,
    });
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(response.status === 401 || response.status === 403
        ? "WooCommerce rejected the support service credentials."
        : "WooCommerce could not complete the support request.");
    }

    const value: unknown = await response.json();
    if (!isRecord(value) || value.id !== orderId || typeof value.status !== "string") {
      throw new Error("WooCommerce returned an invalid order response.");
    }
    const order = value as unknown as WooCommerceOrder;
    return {
      order_id: order.id,
      order_status: order.status,
      support_data_available: false,
      open_tickets: null,
      priority: "unknown",
      next_action: "No ticketing system is connected. Review the order status in WooCommerce or connect a support system for ticket details.",
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("WooCommerce support request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function registerSupportTools(server: McpServer): void {
  server.registerTool(
    "get_order_support_summary",
    {
      description: "Verify an order against live WooCommerce data and report support-ticket availability. Ticket counts and priority are not available until a ticketing system is integrated.",
      inputSchema: z.object({ order_id: z.number().int().min(1).max(2_147_483_647) }),
    },
    async ({ order_id }) => {
      try {
        const summary = await getOrderSupportSummary(order_id);
        return summary
          ? { content: [{ type: "text" as const, text: JSON.stringify(summary) }] }
          : { content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found", order_id }) }], isError: true };
      } catch {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "support_upstream_unavailable" }) }], isError: true };
      }
    },
  );
}

const service = createStatusMcpService({
  service: "Support",
  serverName: "urumi-support-mcp",
  toolName: "support_status",
  defaultPort: 3002,
  registerTools: registerSupportTools,
});
export const { loadConfig, createMcpHttpHandler, createApplication } = service;

function start(): void {
  const { port } = loadConfig();
  loadWooCommerceConfig();
  createApplication().listen(port, "0.0.0.0", () => console.error(`Support MCP listening on port ${port}`));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) start();
