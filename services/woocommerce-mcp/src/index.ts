import { createServer, type Server } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { loadConfig, type WooCommerceConfig } from "./config.js";
import { createWooCommerceMcpServer } from "./tools.js";
import { WooCommerceClient, type FetchImplementation } from "./woocommerce-client.js";

export { loadConfig, type WooCommerceConfig } from "./config.js";
export { WooCommerceClient, type FetchImplementation } from "./woocommerce-client.js";
export { createWooCommerceMcpServer } from "./tools.js";

export function healthResponse(): Response {
  return Response.json({ status: "ok" });
}

export async function readinessResponse(client: WooCommerceClient): Promise<Response> {
  try {
    await client.checkReady();
    return Response.json({ status: "ready" });
  } catch {
    return Response.json({ status: "not_ready" }, { status: 503 });
  }
}

export function createMcpHttpHandler(client: WooCommerceClient) {
  return createMcpHandler(() => createWooCommerceMcpServer(client), {
    maxRequestBodySize: 1_048_576,
  });
}

export function createApplication(
  config: WooCommerceConfig,
  fetchImplementation?: FetchImplementation,
): Server {
  const client = new WooCommerceClient(config, fetchImplementation);
  const mcpHandler = createMcpHttpHandler(client);
  const handleMcp = toNodeHandler(mcpHandler, { maxRequestBodySize: 1_048_576 });

  return createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

    if (request.method === "GET" && pathname === "/healthz") {
      void healthResponse().text().then((body) => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(body);
      });
      return;
    }

    if (request.method === "GET" && pathname === "/readyz") {
      void readinessResponse(client).then(async (readyResponse) => {
        response.writeHead(readyResponse.status, { "Content-Type": "application/json" });
        response.end(await readyResponse.text());
      });
      return;
    }

    if (pathname === "/mcp") {
      void handleMcp(request, response);
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end('{"error":"not_found"}');
  });
}

function start(): void {
  const config = loadConfig();
  const application = createApplication(config);
  application.listen(config.port, "0.0.0.0", () => {
    console.error(`WooCommerce MCP listening on port ${config.port}`);
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  start();
}
