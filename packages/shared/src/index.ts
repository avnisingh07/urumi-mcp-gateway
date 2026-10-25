export const sharedPackage = "@urumi/shared";

/** A stored upstream credential is deliberately absent from public API responses. */
export type UpstreamConfiguration = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  /** Static upstream bearer token. It is server-side only. */
  credential?: string;
  timeoutMs: number;
};

export type PublicUpstreamConfiguration = Omit<UpstreamConfiguration, "credential">;

export type McpToolDefinition = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type GatewayTool = McpToolDefinition & {
  upstreamId: string;
  upstreamName: string;
  upstreamToolName: string;
};

import { createServer, type Server } from "node:http";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { z } from "zod";

export type StatusMcpService = {
  loadConfig(environment?: NodeJS.ProcessEnv): { port: number };
  createMcpHttpHandler(): ReturnType<typeof createMcpHandler>;
  createApplication(): Server;
};

/** Shared Streamable HTTP transport and probes for stateless internal MCP services. */
export function createStatusMcpService(options: { service: string; serverName: string; toolName: string; defaultPort: number; registerTools?: (server: McpServer) => void }): StatusMcpService {
  const portSchema = z.coerce.number().int().min(1).max(65_535).default(options.defaultPort);
  const loadConfig = (environment: NodeJS.ProcessEnv = process.env) => {
    const result = portSchema.safeParse(environment.PORT);
    if (!result.success) throw new Error(`${options.service} MCP configuration is invalid.`);
    return { port: result.data };
  };
  const createMcpHttpHandler = () => createMcpHandler(() => {
    const server = new McpServer({ name: options.serverName, version: "0.1.0" });
    server.registerTool(options.toolName, { description: `Return the ${options.service} MCP service status.`, inputSchema: z.object({}) }, async () => ({ content: [{ type: "text", text: JSON.stringify({ status: "ok", service: options.service.toLowerCase() }) }] }));
    options.registerTools?.(server);
    return server;
  }, { maxRequestBodySize: 1_048_576 });
  const createApplication = () => {
    const handleMcp = toNodeHandler(createMcpHttpHandler(), { maxRequestBodySize: 1_048_576 });
    return createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (request.method === "GET" && (pathname === "/healthz" || pathname === "/readyz")) {
        response.writeHead(200, { "Content-Type": "application/json" }); response.end('{"status":"ok"}'); return;
      }
      if (pathname === "/mcp") { void handleMcp(request, response); return; }
      response.writeHead(404, { "Content-Type": "application/json" }); response.end('{"error":"not_found"}');
    });
  };
  return { loadConfig, createMcpHttpHandler, createApplication };
}
