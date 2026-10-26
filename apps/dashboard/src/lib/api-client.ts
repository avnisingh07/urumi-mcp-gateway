/**
 * Centralized, typed Gateway API client.
 *
 * All HTTP traffic goes through `request()`. The API key lives only in this
 * module's memory (set via setApiKey) and is never persisted or logged.
 *
 * Response normalizers below accept the common shapes the Gateway may return
 * (e.g. `{ upstreams: [...] }` or a bare array). Field names used for requests
 * are defined once in this file — see README "Backend contract gaps".
 */
import { GATEWAY_BASE_URL } from "./config";
import type {
  AuditRecord,
  ChatMessage,
  ChatResponse,
  CurrentUser,
  GatewayStatus,
  IssuedKey,
  Role,
  TeamUser,
  ToolInfo,
  ToolTrace,
  Upstream,
  UpstreamHealth,
  UpstreamInput,
} from "./types";

export type ApiErrorKind = "network" | "timeout" | "http" | "parse";

export class ApiError extends Error {
  status: number;
  kind: ApiErrorKind;
  code: string | undefined;
  constructor(message: string, kind: ApiErrorKind, status = 0, code?: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
  get isUnauthorized() {
    return this.status === 401;
  }
  get isForbidden() {
    return this.status === 403;
  }
}

let apiKey: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setApiKey(key: string | null) {
  apiKey = key;
}
export function onUnauthorized(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function scrub(text: string): string {
  return text
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(apiKey ? new RegExp(escapeRe(apiKey), "g") : /$^/, "[redacted]")
    .slice(0, 240);
}
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function messageFromBody(body: unknown, status: number): { message: string; code?: string | undefined } {
  const fallback =
    status === 401
      ? "Your API key was rejected. Please re-enter a valid Gateway key."
      : status === 403
        ? "You don't have permission to perform this action."
        : status === 404
          ? "The requested resource was not found."
          : status >= 500
            ? "The Gateway encountered an internal error."
            : `Request failed (HTTP ${status}).`;
  if (!body || typeof body !== "object") return { message: fallback };
  const b = body as Json;
  const err = b.error;
  let message: unknown = b.message;
  let code: unknown = b.code;
  if (typeof err === "string") message = message ?? err;
  if (err && typeof err === "object") {
    message = (err as Json).message ?? message;
    code = (err as Json).code ?? code;
  }
  // Never surface raw server messages for 5xx (may contain internals).
  if (status >= 500 || typeof message !== "string" || !message) return { message: fallback, code: str(code) };
  return { message: scrub(message), code: str(code) };
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
}

export async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, timeoutMs = 20_000 } = opts;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    if (!apiKey) throw new ApiError("Not authenticated.", "http", 401);
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${GATEWAY_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : null,
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new ApiError("The Gateway did not respond in time.", "timeout");
    }
    throw new ApiError(
      "Could not reach the Gateway. Check that it is running and that CORS allows this origin.",
      "network",
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      if (res.ok) throw new ApiError("The Gateway returned a malformed response.", "parse", res.status);
    }
  }
  if (!res.ok) {
    if (res.status === 401 && auth) unauthorizedHandler?.();
    const { message, code } = messageFromBody(parsed, res.status);
    throw new ApiError(message, "http", res.status, code);
  }
  return parsed as T;
}

/* ---------------- normalization helpers ---------------- */

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.length) return v;
  if (typeof v === "number") return String(v);
  return undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function obj(v: unknown): Json {
  return v && typeof v === "object" ? (v as Json) : {};
}
function list(v: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(v)) return v;
  const o = obj(v);
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[];
  return [];
}
function role(v: unknown): Role | null {
  return v === "admin" || v === "member" ? v : null;
}
function ensureObject(v: unknown, what: string): Json {
  if (!v || typeof v !== "object") throw new ApiError(`Unexpected ${what} response from Gateway.`, "parse");
  return v as Json;
}

function toUser(v: unknown): CurrentUser | null {
  const o = obj(v);
  const id = str(o.id) ?? str(o.userId);
  const username = str(o.username) ?? str(o.name) ?? id;
  if (!id && !username) return null;
  return { id: id ?? username!, username: username!, role: role(o.role) };
}

function toUpstream(v: unknown): Upstream {
  const o = obj(v);
  return {
    id: str(o.id) ?? str(o.name) ?? "",
    name: str(o.name) ?? str(o.id) ?? "unnamed",
    url: str(o.url) ?? str(o.endpoint) ?? "",
    enabled: o.enabled !== false,
    timeoutMs: num(o.timeoutMs) ?? num(o.timeout_ms) ?? num(o.timeout),
    hasCredential: typeof o.hasCredential === "boolean" ? o.hasCredential : undefined,
  };
}

function toTool(v: unknown): ToolInfo {
  if (typeof v === "string") return { name: v };
  const o = obj(v);
  return { name: str(o.name) ?? "tool", description: str(o.description) };
}

function toHealth(v: unknown, keyName?: string): UpstreamHealth {
  const o = obj(v);
  const tools = Array.isArray(o.tools) ? o.tools.map(toTool) : undefined;
  const status = str(o.status)?.toLowerCase();
  const reachable =
    typeof o.reachable === "boolean"
      ? o.reachable
      : typeof o.ok === "boolean"
        ? o.ok
        : typeof o.healthy === "boolean"
          ? o.healthy
          : status
            ? ["ok", "up", "healthy", "connected", "reachable"].includes(status)
            : false;
  const errRaw = o.error;
  return {
    id: str(o.id) ?? str(o.upstreamId),
    name: str(o.name) ?? str(o.upstream) ?? keyName ?? "unknown",
    reachable,
    enabled: typeof o.enabled === "boolean" ? o.enabled : undefined,
    toolCount: num(o.toolCount) ?? num(o.tools_count) ?? tools?.length,
    tools,
    error: typeof errRaw === "string" ? errRaw.slice(0, 300) : str(obj(errRaw).message),
    latencyMs: num(o.latencyMs) ?? num(o.durationMs),
    checkedAt: str(o.checkedAt) ?? str(o.lastCheckedAt),
  };
}

function toTeamUser(v: unknown): TeamUser {
  const o = obj(v);
  const keysRaw = Array.isArray(o.keys) ? o.keys : Array.isArray(o.apiKeys) ? o.apiKeys : undefined;
  return {
    id: str(o.id) ?? "",
    username: str(o.username) ?? str(o.name) ?? str(o.id) ?? "",
    role: role(o.role),
    createdAt: str(o.createdAt) ?? str(o.created_at),
    keys: keysRaw?.map((k: unknown) => {
      const ko = obj(k);
      return {
        id: str(ko.id) ?? "",
        label: str(ko.label) ?? str(ko.prefix) ?? str(ko.name),
        createdAt: str(ko.createdAt) ?? str(ko.created_at),
        lastUsedAt: str(ko.lastUsedAt),
        revoked: ko.revoked === true || !!ko.revokedAt,
      };
    }),
  };
}

function toOutcome(v: unknown, o: Json): { outcome: AuditRecord["outcome"]; label?: string | undefined } {
  const s = str(v)?.toLowerCase();
  if (typeof o.success === "boolean") return { outcome: o.success ? "success" : "error", label: s };
  if (!s) return { outcome: o.errorCode || o.error ? "error" : "unknown" };
  if (["ok", "success", "succeeded", "allowed"].includes(s)) return { outcome: "success", label: s };
  if (["error", "failed", "failure", "denied", "timeout", "rejected"].includes(s))
    return { outcome: "error", label: s };
  return { outcome: "unknown", label: s };
}

function toAudit(v: unknown, i: number): AuditRecord {
  const o = obj(v);
  const { outcome, label } = toOutcome(o.outcome ?? o.status ?? o.result, o);
  const err = o.error;
  const ts = o.occurredAt ?? o.occurred_at ?? o.timestamp ?? o.createdAt ?? o.created_at ?? o.ts;
  return {
    id: str(o.id) ?? `row-${i}`,
    userId: str(o.userId) ?? str(o.user_id) ?? str(o.user),
    upstream: str(o.upstream) ?? str(o.upstreamName) ?? str(o.upstream_name) ?? str(o.server),
    tool: str(o.tool) ?? str(o.toolName) ?? str(o.tool_name),
    timestamp: typeof ts === "number" ? new Date(ts).toISOString() : str(ts),
    durationMs: num(o.durationMs) ?? num(o.duration_ms) ?? num(o.duration),
    outcome,
    outcomeLabel: label,
    errorCode: str(o.errorCode) ?? str(o.error_code),
    errorMessage: typeof err === "string" ? err.slice(0, 300) : str(obj(err).message),
  };
}

function toTrace(v: unknown): ToolTrace {
  const o = obj(v);
  const s = str(o.status ?? o.outcome)?.toLowerCase();
  const isErr = o.isError === true || !!o.error || (s ? ["error", "failed"].includes(s) : false);
  const isOk = !isErr && (o.ok === true || (s ? ["ok", "success"].includes(s) : o.result !== undefined));
  const result = o.result ?? o.output;
  const err = o.error;
  let summary: string | undefined;
  if (isErr) summary = typeof err === "string" ? err : str(obj(err).message) ?? "Tool call failed.";
  else if (result !== undefined)
    summary = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  return {
    tool: str(o.tool) ?? str(o.name) ?? str(o.toolName) ?? "tool",
    upstream: str(o.upstream) ?? str(o.server) ?? str(o.upstreamName),
    status: isErr ? "error" : isOk ? "success" : "unknown",
    durationMs: num(o.durationMs) ?? num(o.duration_ms),
    summary: summary?.slice(0, 4000),
  };
}

/* ---------------- endpoints ---------------- */

export interface ProbeResult {
  ok: boolean;
  status: number;
}
async function probe(path: string): Promise<ProbeResult> {
  try {
    const response = await fetch(path, { headers: { Accept: "application/json" } });
    return { ok: response.ok, status: response.status };
  } catch (e) {
    return { ok: false, status: 0 };
  }
}

export const api = {
  healthz: () => probe("/gateway-healthz"),
  readyz: () => probe("/gateway-readyz"),

  async status(): Promise<GatewayStatus> {
    const o = ensureObject(await request("/status"), "status");
    return {
      user: toUser(o.user ?? o.currentUser ?? o.me),
      toolCount: num(o.toolCount) ?? num(o.tools),
      upstreamCount: num(o.upstreamCount),
    };
  },

  async upstreams(): Promise<Upstream[]> {
    return list(await request("/upstreams"), "upstreams", "data").map(toUpstream);
  },
  async upstreamHealth(): Promise<UpstreamHealth[]> {
    const raw = await request("/upstreams/health", { timeoutMs: 30_000 });
    const arr = list(raw, "upstreams", "health", "data");
    if (arr.length || Array.isArray(raw)) return arr.map((h) => toHealth(h));
    // Map shape: { [name]: { ... } }
    return Object.entries(obj(raw)).map(([k, h]) => toHealth(h, k));
  },
  createUpstream: (input: UpstreamInput) =>
    request("/upstreams", { method: "POST", body: upstreamBody(input) }),
  updateUpstream: (id: string, input: Partial<UpstreamInput>) =>
    request(`/upstreams/${encodeURIComponent(id)}`, { method: "PATCH", body: upstreamBody(input) }),
  deleteUpstream: (id: string) =>
    request(`/upstreams/${encodeURIComponent(id)}`, { method: "DELETE" }),

  async users(): Promise<TeamUser[]> {
    return list(await request("/users"), "users", "data").map(toTeamUser);
  },
  createUser: (input: { username: string; role: Role }) =>
    request("/users", { method: "POST", body: input }),
  async issueKey(userId: string): Promise<IssuedKey> {
    const o = obj(await request(`/users/${encodeURIComponent(userId)}/keys`, { method: "POST", body: {} }));
    const inner = obj(o.key ?? o.apiKey);
    const raw = str(o.rawKey) ?? str(o.key) ?? str(o.apiKey) ?? str(o.token) ?? str(inner.rawKey) ?? str(inner.key);
    return { id: str(o.id) ?? str(inner.id), rawKey: raw ?? null };
  },
  revokeKey: (keyId: string) => request(`/keys/${encodeURIComponent(keyId)}`, { method: "DELETE" }),

  async audit(limit = 100): Promise<AuditRecord[]> {
    return list(await request(`/audit?limit=${limit}`), "events", "records", "entries", "audit", "data").map(toAudit);
  },

  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    const o = ensureObject(
      await request("/chat", { method: "POST", body: { message: messages.at(-1)?.content ?? "", history: messages.slice(0, -1) }, timeoutMs: 120_000 }),
      "chat",
    );
    const msg = obj(o.message);
    const reply = str(o.reply) ?? str(o.content) ?? str(o.answer) ?? str(msg.content) ?? (typeof o.message === "string" ? o.message : undefined);
    if (reply === undefined) throw new ApiError("The chat response did not include an assistant message.", "parse");
    const traces = list(o.toolCalls ?? o.traces ?? o.tool_calls ?? o.toolTraces).map(toTrace);
    return { reply, traces };
  },
};

function upstreamBody(input: Partial<UpstreamInput>) {
  const body: Json = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.url !== undefined) body.url = input.url;
  if (input.timeoutMs !== undefined) body.timeoutMs = input.timeoutMs;
  if (input.enabled !== undefined) body.enabled = input.enabled;
  // Only send a credential when the operator typed one — blank never overwrites.
  if (input.credential) body.credential = input.credential;
  return body;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "Something went wrong.";
}
