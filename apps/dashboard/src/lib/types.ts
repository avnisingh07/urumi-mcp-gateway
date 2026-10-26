export type Role = "admin" | "member";

export interface CurrentUser {
  id: string;
  username: string;
  role: Role | null;
}

export interface GatewayStatus {
  user: CurrentUser | null;
  toolCount?: number | undefined;
  upstreamCount?: number | undefined;
}

export interface Upstream {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  timeoutMs?: number | undefined;
  hasCredential?: boolean | undefined;
}

export interface ToolInfo {
  name: string;
  description?: string | undefined;
}

export interface UpstreamHealth {
  id?: string | undefined;
  name: string;
  reachable: boolean;
  enabled?: boolean | undefined;
  toolCount?: number | undefined;
  tools?: ToolInfo[] | undefined;
  error?: string | undefined;
  latencyMs?: number | undefined;
  checkedAt?: string | undefined;
}

export interface ApiKeyMeta {
  id: string;
  label?: string | undefined;
  createdAt?: string | undefined;
  lastUsedAt?: string | undefined;
  revoked?: boolean | undefined;
}

export interface TeamUser {
  id: string;
  username: string;
  role: Role | null;
  createdAt?: string | undefined;
  keys?: ApiKeyMeta[] | undefined;
}

export interface IssuedKey {
  id?: string | undefined;
  rawKey: string | null;
}

export interface AuditRecord {
  id: string;
  userId?: string | undefined;
  upstream?: string | undefined;
  tool?: string | undefined;
  timestamp?: string | undefined;
  durationMs?: number | undefined;
  outcome: "success" | "error" | "unknown";
  outcomeLabel?: string | undefined;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolTrace {
  tool: string;
  upstream?: string | undefined;
  status: "success" | "error" | "unknown";
  durationMs?: number | undefined;
  summary?: string | undefined;
}

export interface ChatResponse {
  reply: string;
  traces: ToolTrace[];
}

export interface UpstreamInput {
  name: string;
  url: string;
  timeoutMs: number;
  enabled: boolean;
  credential?: string | undefined;
}
