import { createStatusMcpService } from "@urumi/shared";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export type StockRecord = { product_id: number; available: number; reserved: number; status: "in_stock" | "low_stock" | "out_of_stock" };

const stockByProductId: Readonly<Record<number, StockRecord>> = {
  101: { product_id: 101, available: 24, reserved: 3, status: "in_stock" },
  102: { product_id: 102, available: 2, reserved: 1, status: "low_stock" },
  202: { product_id: 202, available: 0, reserved: 0, status: "out_of_stock" },
};

/** Deterministic fixture data for cross-service demonstrations; unknown IDs are not found. */
export function getStock(productId: number): StockRecord | undefined {
  return stockByProductId[productId];
}

function registerInventoryTools(server: McpServer): void {
  server.registerTool(
    "get_stock",
    { description: "Get deterministic inventory availability for a known product ID.", inputSchema: z.object({ product_id: z.number().int().positive() }) },
    async ({ product_id }) => {
      const stock = getStock(product_id);
      return stock
        ? { content: [{ type: "text" as const, text: JSON.stringify(stock) }] }
        : { content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found", product_id }) }], isError: true };
    },
  );
}

const service = createStatusMcpService({ service: "Inventory", serverName: "urumi-inventory-mcp", toolName: "inventory_status", defaultPort: 3001, registerTools: registerInventoryTools });
export const { loadConfig, createMcpHttpHandler, createApplication } = service;

function start(): void {
  const { port } = loadConfig();
  createApplication().listen(port, "0.0.0.0", () => console.error(`Inventory MCP listening on port ${port}`));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) start();
