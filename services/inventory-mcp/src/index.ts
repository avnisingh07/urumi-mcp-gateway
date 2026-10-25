import { createStatusMcpService } from "@urumi/shared";

const service = createStatusMcpService({ service: "Inventory", serverName: "urumi-inventory-mcp", toolName: "inventory_status", defaultPort: 3001 });
export const { loadConfig, createMcpHttpHandler, createApplication } = service;

function start(): void {
  const { port } = loadConfig();
  createApplication().listen(port, "0.0.0.0", () => console.error(`Inventory MCP listening on port ${port}`));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) start();
