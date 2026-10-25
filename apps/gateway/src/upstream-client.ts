import type { McpToolDefinition, UpstreamConfiguration } from "@urumi/shared";
import type { UpstreamUrlPolicy } from "./upstream-url-policy.js";

export type FetchImplementation = typeof fetch;

export class UpstreamError extends Error {
  constructor(public readonly kind: "timeout" | "unavailable" | "protocol", message: string) {
    super(message);
  }
}

/** Minimal Streamable HTTP MCP client for the two gateway operations. */
export class StreamableHttpUpstreamClient {
  constructor(private readonly fetchImplementation: FetchImplementation = fetch, private readonly urlPolicy?: UpstreamUrlPolicy) {}

  async listTools(upstream: UpstreamConfiguration): Promise<McpToolDefinition[]> {
    const result = await this.request(upstream, "tools/list", {});
    const tools = result.tools;
    if (!Array.isArray(tools)) throw new UpstreamError("protocol", "Upstream returned an invalid tools list.");
    return tools.map((tool) => parseTool(tool));
  }

  async callTool(upstream: UpstreamConfiguration, name: string, arguments_: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request(upstream, "tools/call", { name, arguments: arguments_ });
  }

  private async request(upstream: UpstreamConfiguration, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), upstream.timeoutMs);
    try {
      if (this.urlPolicy) await this.urlPolicy.validate(upstream.url);
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      };
      if (upstream.credential) headers.authorization = `Bearer ${upstream.credential}`;
      const response = await this.fetchImplementation(upstream.url, {
        method: "POST",
        headers,
        redirect: "error",
        signal: controller.signal,
        body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
      });
      if (!response.ok) throw new UpstreamError("unavailable", "Upstream server is unavailable.");
      const payload = await parseMcpResponse(response);
      if ("error" in payload) throw new UpstreamError("protocol", "Upstream rejected the request.");
      if (!isRecord(payload.result)) throw new UpstreamError("protocol", "Upstream returned an invalid response.");
      return payload.result;
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      if (isAbortError(error)) throw new UpstreamError("timeout", "Upstream request timed out.");
      throw new UpstreamError("unavailable", "Upstream server is unavailable.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function parseMcpResponse(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  const candidate = contentType.includes("text/event-stream")
    ? text.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim()
    : text;
  if (!candidate) throw new UpstreamError("protocol", "Upstream returned an empty response.");
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (!isRecord(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new UpstreamError("protocol", "Upstream returned an invalid response.");
  }
}

function parseTool(value: unknown): McpToolDefinition {
  if (!isRecord(value) || typeof value.name !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.name)) {
    throw new UpstreamError("protocol", "Upstream advertised an invalid tool.");
  }
  if (!isRecord(value.inputSchema)) throw new UpstreamError("protocol", "Upstream tool is missing an input schema.");
  return { name: value.name, inputSchema: value.inputSchema, ...(typeof value.description === "string" ? { description: value.description } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
