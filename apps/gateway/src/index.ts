import { createServer, type Server } from "node:http";
import { createMcpHandler, fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { GatewayCore, GatewayToolError } from "./gateway-core.js";
import { InMemoryUpstreamRepository, publicConfiguration, type UpstreamRepository } from "./upstream-repository.js";
import { PostgresGatewayStore, type AuthenticatedUser } from "./gateway-store.js";
import { loadGatewayConfig } from "./config.js";
import { UpstreamHealthReporter } from "./upstream-health.js";
import { StreamableHttpUpstreamClient } from "./upstream-client.js";
import { UpstreamUrlPolicyError } from "./upstream-url-policy.js";
import { ChatAgent, OpenAiCompatibleProvider, type ChatMessage } from "./chat-agent.js";

export { GatewayCore, GatewayToolError, validateJsonSchema } from "./gateway-core.js";
export { InMemoryUpstreamRepository, publicConfiguration, upstreamNamespace, type UpstreamRepository, type UpstreamInput } from "./upstream-repository.js";
export { StreamableHttpUpstreamClient, UpstreamError, type FetchImplementation } from "./upstream-client.js";
export { PostgresGatewayStore, type AuthenticatedUser, type GatewayUser, type AuditEvent, type IssuedApiKey } from "./gateway-store.js";
export { loadInitialGatewayProvisioning } from "./provision-initial-state.js";
export { CredentialCipher, createApiKey, hashApiKey, verifyApiKey, type Role } from "./security.js";
export { loadGatewayConfig, type GatewayConfig } from "./config.js";
export { UpstreamHealthReporter, type UpstreamHealth } from "./upstream-health.js";
export { UpstreamUrlPolicy, UpstreamUrlPolicyError, policyFromEnvironment, type DnsResolver } from "./upstream-url-policy.js";
export { ChatAgent, OpenAiCompatibleProvider, type ChatMessage, type ChatResult, type ChatTrace, type ChatProvider } from "./chat-agent.js";

export type GatewayAuthenticator = (request: Request) => Promise<AuthenticatedUser | boolean | undefined>;

function createMcpHandlerForCaller(core: GatewayCore, caller: AuthenticatedUser | undefined) {
  return createMcpHandler(async () => {
    const server = new McpServer({ name: "urumi-mcp-gateway", version: "0.1.0" });
    const { tools } = await core.discover();
    for (const tool of tools) {
      server.registerTool(tool.name, {
        description: tool.description,
        inputSchema: fromJsonSchema(tool.inputSchema),
      }, async (arguments_) => {
        try {
          return await core.callTool(tool.name, arguments_, caller) as { content: [{ type: "text"; text: string }]; isError?: boolean };
        } catch (error) {
          const message = error instanceof GatewayToolError ? error.message : "Tool could not be completed.";
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
        }
      });
    }
    return server;
  }, { maxRequestBodySize: 1_048_576 });
}

/** Authentication is injected; production uses the API-key lookup from PostgresGatewayStore. */
export function createGatewayMcpHandler(core: GatewayCore, authenticate: GatewayAuthenticator) {
  return {
    fetch: async (request: Request) => {
      const authenticated = await authenticate(request);
      if (!authenticated) return Response.json({ error: "unauthorized" }, { status: 401 });
      // The SDK may construct its own Request instance. Capture the verified
      // database principal in this per-request closure instead of keying a map
      // by Request identity.
      return createMcpHandlerForCaller(core, typeof authenticated === "boolean" ? undefined : authenticated).fetch(request);
    },
  };
}

export function createApplication(repository: UpstreamRepository = new InMemoryUpstreamRepository(), authenticate: GatewayAuthenticator = async () => false): Server {
  const core = new GatewayCore(repository);
  const mcpHandler = createGatewayMcpHandler(core, authenticate);
  const handleMcp = toNodeHandler(mcpHandler, { maxRequestBodySize: 1_048_576 });
  return createServer((request, response) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname === "/mcp") { void handleMcp(request, response); return; }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end('{"error":"not_found"}');
  });
}

/** Full M5 HTTP surface. All management routes are server-side admin-only. */
export function createPersistentApplication(store: PostgresGatewayStore, options: { client?: StreamableHttpUpstreamClient; healthTtlMs?: number; chatAgent?: ChatAgent } = {}): Server {
  const authenticate = async (request: Request) => {
    const value = request.headers.get("authorization");
    return value?.startsWith("Bearer ") ? store.authenticateApiKey(value.slice(7)) : undefined;
  };
  const client = options.client ?? new StreamableHttpUpstreamClient(fetch, store.urlPolicy);
  const core = new GatewayCore(store, client, store);
  const health = new UpstreamHealthReporter(store, client, options.healthTtlMs);
  const mcpHandler = createGatewayMcpHandler(core, authenticate);
  const handleMcp = toNodeHandler(mcpHandler, { maxRequestBodySize: 1_048_576 });
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/mcp") { void handleMcp(request, response); return; }
    if (request.method === "GET" && url.pathname === "/readyz") { void store.checkReady().then(() => json(response, 200, { status: "ready" }), () => json(response, 503, { status: "not_ready" })); return; }
    void handleApi(request, response, store, url, authenticate, health, options.chatAgent);
  });
}

export async function handleApi(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, store: PostgresGatewayStore, url: URL, authenticate: GatewayAuthenticator, health: UpstreamHealthReporter, chatAgent?: ChatAgent): Promise<void> {
  if (request.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/readyz")) return json(response, 200, { status: "ok" });
  const webRequest = new Request(`http://gateway.local${url.pathname}${url.search}`, { method: request.method, headers: request.headers as HeadersInit });
  const user = await authenticate(webRequest);
  if (!user || typeof user === "boolean") return json(response, 401, { error: "unauthorized" });
  if (request.method === "GET" && url.pathname === "/api/status") return json(response, 200, { status: "ok", user: { username: user.username, role: user.role } });
  if (request.method === "POST" && url.pathname === "/api/chat") {
    try {
      if (!chatAgent) return json(response, 503, { error: "chat_unavailable" });
      const body = await readJson(request); const message = string(body.message); const history = chatHistory(body.history);
      if (message.length > 8_000) throw new Error("invalid");
      return json(response, 200, await chatAgent.respond(message, history, user));
    } catch { return json(response, 400, { error: "invalid_request" }); }
  }
  if (url.pathname.startsWith("/api/") && !isManagementAllowed(user)) return json(response, 403, { error: "forbidden" });
  try {
    const body = ["POST", "PATCH"].includes(request.method ?? "") ? await readJson(request) : {};
    if (request.method === "GET" && url.pathname === "/api/users") return json(response, 200, { users: await store.listUsers() });
    if (request.method === "POST" && url.pathname === "/api/users") return json(response, 201, { user: await store.createUser(string(body.username), role(body.role)) });
    const keyMatch = url.pathname.match(/^\/api\/users\/([\w-]+)\/keys$/);
    if (request.method === "POST" && keyMatch) return json(response, 201, { apiKey: await store.issueApiKey(keyMatch[1]) });
    const revokeMatch = url.pathname.match(/^\/api\/keys\/([\w-]+)$/);
    if (request.method === "DELETE" && revokeMatch) return json(response, (await store.revokeApiKey(revokeMatch[1])) ? 204 : 404);
    if (request.method === "GET" && url.pathname === "/api/upstreams") return json(response, 200, { upstreams: (await store.list()).map((value) => ({ id: value.id, name: value.name, url: value.url, enabled: value.enabled, timeoutMs: value.timeoutMs })) });
    if (request.method === "GET" && url.pathname === "/api/upstreams/health") return json(response, 200, { upstreams: await health.report() });
    if (request.method === "POST" && url.pathname === "/api/upstreams") return json(response, 201, { upstream: publicUpstream(await store.create(upstreamBody(body))) });
    const upstreamMatch = url.pathname.match(/^\/api\/upstreams\/([\w-]+)$/);
    if (upstreamMatch && request.method === "PATCH") { const value = await store.update(upstreamMatch[1], upstreamPatch(body)); return value ? json(response, 200, { upstream: publicUpstream(value) }) : json(response, 404, { error: "not_found" }); }
    if (upstreamMatch && request.method === "DELETE") return json(response, (await store.remove(upstreamMatch[1])) ? 204 : 404);
    if (request.method === "GET" && url.pathname === "/api/audit") return json(response, 200, { events: await store.listAudit(Number(url.searchParams.get("limit") ?? "100")) });
    return json(response, 404, { error: "not_found" });
  } catch (error) { return json(response, 400, { error: error instanceof UpstreamUrlPolicyError ? "upstream_url_not_permitted" : "invalid_request" }); }
}

function json(response: import("node:http").ServerResponse, status: number, value?: unknown): void { response.writeHead(status, value === undefined ? {} : { "Content-Type": "application/json" }); response.end(value === undefined ? undefined : JSON.stringify(value)); }
async function readJson(request: import("node:http").IncomingMessage): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; for await (const chunk of request) { chunks.push(Buffer.from(chunk)); if (Buffer.concat(chunks).length > 1_048_576) throw new Error("too large"); } const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid"); return parsed as Record<string, unknown>; }
function string(value: unknown): string { if (typeof value !== "string") throw new Error("invalid"); return value; }
function role(value: unknown): "admin" | "member" { if (value !== "admin" && value !== "member") throw new Error("invalid"); return value; }
function chatHistory(value: unknown): ChatMessage[] { if (value === undefined) return []; if (!Array.isArray(value) || value.length > 12) throw new Error("invalid"); return value.map((item) => { if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid"); const message = item as Record<string, unknown>; if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string" || message.content.length > 4_000) throw new Error("invalid"); return { role: message.role, content: message.content }; }); }
function upstreamBody(body: Record<string, unknown>) { const enabled = "enabled" in body ? body.enabled : true; const credential = "credential" in body ? body.credential : undefined; if (typeof enabled !== "boolean" || (credential !== undefined && typeof credential !== "string")) throw new Error("invalid"); return { name: string(body.name), url: string(body.url), enabled, credential, timeoutMs: number(body.timeoutMs ?? 10_000) }; }
function upstreamPatch(body: Record<string, unknown>) { const output: Record<string, unknown> = {}; if ("name" in body) output.name = string(body.name); if ("url" in body) output.url = string(body.url); if ("enabled" in body) { if (typeof body.enabled !== "boolean") throw new Error("invalid"); output.enabled = body.enabled; } if ("credential" in body) output.credential = string(body.credential); if ("timeoutMs" in body) output.timeoutMs = number(body.timeoutMs); return output; }
function number(value: unknown): number { if (typeof value !== "number" || !Number.isInteger(value)) throw new Error("invalid"); return value; }
function publicUpstream(value: Parameters<typeof publicConfiguration>[0]) { return publicConfiguration(value); }
export function isManagementAllowed(user: AuthenticatedUser): boolean { return user.role === "admin"; }

async function start(): Promise<void> {
  const config = loadGatewayConfig();
  const store = PostgresGatewayStore.fromConfig(config);
  await store.migrate();
  const client = new StreamableHttpUpstreamClient(fetch, store.urlPolicy);
  const chatAgent = config.chat ? new ChatAgent(new GatewayCore(store, client, store), new OpenAiCompatibleProvider(config.chat), config.chat.maxIterations) : undefined;
  createPersistentApplication(store, { client, chatAgent }).listen(config.port, "0.0.0.0", () => console.error(`Urumi gateway listening on port ${config.port}`));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void start().catch((error: unknown) => {
  console.error(
    "Gateway failed to start:",
    error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
      : "Unknown startup error"
  );
  process.exitCode = 1;
});
}
