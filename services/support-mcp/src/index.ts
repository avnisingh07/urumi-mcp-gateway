import { createStatusMcpService } from "@urumi/shared";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export type OrderSupportSummary = { order_id: number; open_tickets: number; priority: "low" | "normal" | "high"; next_action: string };

const summaryByOrderId: Readonly<Record<number, OrderSupportSummary>> = {
  202: { order_id: 202, open_tickets: 1, priority: "high", next_action: "Contact the customer about the processing delay." },
  203: { order_id: 203, open_tickets: 0, priority: "normal", next_action: "No support action is required." },
};

/** Deterministic fixture data for cross-service demonstrations; unknown IDs are not found. */
export function getOrderSupportSummary(orderId: number): OrderSupportSummary | undefined {
  return summaryByOrderId[orderId];
}

function registerSupportTools(server: McpServer): void {
  server.registerTool(
    "get_order_support_summary",
    { description: "Get a deterministic support summary for a known order ID.", inputSchema: z.object({ order_id: z.number().int().positive() }) },
    async ({ order_id }) => {
      const summary = getOrderSupportSummary(order_id);
      return summary
        ? { content: [{ type: "text" as const, text: JSON.stringify(summary) }] }
        : { content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found", order_id }) }], isError: true };
    },
  );
}

const service = createStatusMcpService({ service: "Support", serverName: "urumi-support-mcp", toolName: "support_status", defaultPort: 3002, registerTools: registerSupportTools });
export const { loadConfig, createMcpHttpHandler, createApplication } = service;

function start(): void {
  const { port } = loadConfig();
  createApplication().listen(port, "0.0.0.0", () => console.error(`Support MCP listening on port ${port}`));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) start();
