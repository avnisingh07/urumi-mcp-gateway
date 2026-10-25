import type { GatewayTool, McpToolDefinition, UpstreamConfiguration } from "@urumi/shared";
import { upstreamNamespace, type UpstreamRepository } from "./upstream-repository.js";
import { StreamableHttpUpstreamClient, UpstreamError } from "./upstream-client.js";

export type DiscoveryResult = { tools: GatewayTool[]; unavailableUpstreams: string[] };
export type ToolCaller = { id: string };
export type AuditLogger = { recordAudit(event: { userId: string | null; upstreamId: string | null; upstreamName: string | null; toolName: string | null; durationMs: number; outcome: "success" | "failure" | "denied"; errorCode: string | null }): Promise<void> };

/** Aggregates enabled servers without allowing one discovery failure to fail the whole list. */
export class GatewayCore {
  private readonly cache = new Map<string, GatewayTool>();

  constructor(private readonly repository: UpstreamRepository, private readonly client = new StreamableHttpUpstreamClient(), private readonly audit?: AuditLogger) {}

  async discover(): Promise<DiscoveryResult> {
    const upstreams = (await this.repository.list()).filter((upstream) => upstream.enabled);
    const results = await Promise.allSettled(upstreams.map(async (upstream) => ({ upstream, tools: await this.client.listTools(upstream) })));
    const tools: GatewayTool[] = [];
    const unavailableUpstreams: string[] = [];
    this.cache.clear();
    for (const result of results) {
      if (result.status === "rejected") {
        unavailableUpstreams.push("An enabled upstream is unavailable.");
        continue;
      }
      for (const tool of result.value.tools) {
        const gatewayTool = toGatewayTool(result.value.upstream, tool);
        tools.push(gatewayTool);
        this.cache.set(gatewayTool.name, gatewayTool);
      }
    }
    return { tools: tools.sort((a, b) => a.name.localeCompare(b.name)), unavailableUpstreams };
  }

  async callTool(name: string, arguments_: unknown, caller?: ToolCaller): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    const tool = this.cache.get(name);
    if (!tool) return this.fail("not_found", "Tool is not available.", caller, undefined, undefined, name, startedAt, "denied");
    const upstream = await this.repository.get(tool.upstreamId);
    if (!upstream || !upstream.enabled) {
      this.cache.delete(name);
      return this.fail("disabled", "Tool is not available.", caller, tool.upstreamId, tool.upstreamName, name, startedAt, "denied");
    }
    const issues = validateJsonSchema(tool.inputSchema, arguments_);
    if (issues.length) return this.fail("invalid_arguments", "Tool arguments are invalid.", caller, tool.upstreamId, tool.upstreamName, name, startedAt, "failure");
    try {
      const result = await this.client.callTool(upstream, tool.upstreamToolName, arguments_ as Record<string, unknown>);
      await this.record(caller, tool.upstreamId, tool.upstreamName, name, startedAt, "success", null);
      return result;
    } catch (error) {
      if (error instanceof UpstreamError) {
        return this.fail(error.kind, error.kind === "timeout" ? "Upstream request timed out." : "Upstream tool is unavailable.", caller, tool.upstreamId, tool.upstreamName, name, startedAt, "failure");
      }
      await this.record(caller, tool.upstreamId, tool.upstreamName, name, startedAt, "failure", "internal");
      throw error;
    }
  }

  private async fail(kind: string, message: string, caller: ToolCaller | undefined, upstreamId: string | undefined, upstreamName: string | undefined, toolName: string, startedAt: number, outcome: "failure" | "denied"): Promise<never> {
    await this.record(caller, upstreamId ?? null, upstreamName ?? null, toolName, startedAt, outcome, kind);
    throw new GatewayToolError(kind, message);
  }
  private async record(caller: ToolCaller | undefined, upstreamId: string | null, upstreamName: string | null, toolName: string, startedAt: number, outcome: "success" | "failure" | "denied", errorCode: string | null): Promise<void> {
    try { await this.audit?.recordAudit({ userId: caller?.id ?? null, upstreamId, upstreamName, toolName, durationMs: Date.now() - startedAt, outcome, errorCode }); } catch { /* Audit failures never expose or interrupt MCP traffic. */ }
  }
}

export class GatewayToolError extends Error {
  constructor(public readonly kind: string, message: string) { super(message); }
}

function toGatewayTool(upstream: UpstreamConfiguration, tool: McpToolDefinition): GatewayTool {
  return {
    ...tool,
    name: `${upstreamNamespace(upstream.name)}__${tool.name}`,
    upstreamId: upstream.id,
    upstreamName: upstream.name,
    upstreamToolName: tool.name,
  };
}

/** Deliberately small JSON Schema validator for untrusted upstream argument schemas. */
export function validateJsonSchema(schema: Record<string, unknown>, value: unknown): string[] {
  const issues: string[] = [];
  validate(schema, value, "$", issues);
  return issues;
}

function validate(schema: Record<string, unknown>, value: unknown, path: string, issues: string[]): void {
  const types = typeof schema.type === "string" ? [schema.type] : Array.isArray(schema.type) ? schema.type.filter((v): v is string => typeof v === "string") : [];
  if (types.length && !types.some((type) => hasType(value, type))) { issues.push(`${path} has an invalid type`); return; }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) issues.push(`${path} is not permitted`);
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) issues.push(`${path} is too short`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) issues.push(`${path} is too long`);
    if (typeof schema.pattern === "string") try { if (!new RegExp(schema.pattern).test(value)) issues.push(`${path} has an invalid format`); } catch { issues.push(`${path} schema is invalid`); }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) issues.push(`${path} is too small`);
    if (typeof schema.maximum === "number" && value > schema.maximum) issues.push(`${path} is too large`);
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((v): v is string => typeof v === "string") : [];
    for (const key of required) if (!(key in value)) issues.push(`${path}.${key} is required`);
    for (const [key, childSchema] of Object.entries(properties)) if (key in value && isRecord(childSchema)) validate(childSchema, value[key], `${path}.${key}`, issues);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in properties)) issues.push(`${path}.${key} is not allowed`);
  }
  if (Array.isArray(value) && isRecord(schema.items)) value.forEach((item, index) => validate(schema.items as Record<string, unknown>, item, `${path}[${index}]`, issues));
}

function hasType(value: unknown, type: string): boolean {
  return (type === "object" && isRecord(value)) || (type === "array" && Array.isArray(value)) || (type === "string" && typeof value === "string") || (type === "number" && typeof value === "number" && Number.isFinite(value)) || (type === "integer" && typeof value === "number" && Number.isInteger(value)) || (type === "boolean" && typeof value === "boolean") || (type === "null" && value === null);
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
