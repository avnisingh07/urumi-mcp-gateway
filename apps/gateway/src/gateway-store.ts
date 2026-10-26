import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolConfig } from "pg";
import type { UpstreamConfiguration } from "@urumi/shared";
import { publicConfiguration, upstreamNamespace, type UpstreamInput, type UpstreamRepository } from "./upstream-repository.js";
import { CredentialCipher, createApiKey, hashApiKey, type Role, verifyApiKey } from "./security.js";
import { UpstreamUrlPolicy } from "./upstream-url-policy.js";

export type GatewayUser = { id: string; username: string; role: Role; createdAt: string };
export type AuthenticatedUser = Pick<GatewayUser, "id" | "username" | "role">;
export type IssuedApiKey = { id: string; key: string; createdAt: string };
export type AuditEvent = { id: string; userId: string | null; upstreamId: string | null; upstreamName: string | null; toolName: string | null; occurredAt: string; durationMs: number; outcome: "success" | "failure" | "denied"; errorCode: string | null };

export class PostgresGatewayStore implements UpstreamRepository {
  constructor(private readonly pool: Pool, private readonly cipher: CredentialCipher, readonly urlPolicy = new UpstreamUrlPolicy()) {}

  static fromConfig(config: { databaseUrl: string; credentialEncryptionKey: string; urlPolicy?: UpstreamUrlPolicy }): PostgresGatewayStore {
    return new PostgresGatewayStore(new Pool({ connectionString: config.databaseUrl }), new CredentialCipher(config.credentialEncryptionKey), config.urlPolicy);
  }
  async close(): Promise<void> { await this.pool.end(); }
  async checkReady(): Promise<void> { await this.pool.query("SELECT 1"); }
  async migrate(migrationPath = new URL("../migrations/001_gateway_state.sql", import.meta.url)): Promise<void> {
    await this.pool.query(await readFile(migrationPath, "utf8"));
  }
  async list(): Promise<UpstreamConfiguration[]> { return (await this.pool.query("SELECT * FROM gateway_upstreams ORDER BY name")).rows.map((row) => this.toUpstream(row)); }
  async get(id: string): Promise<UpstreamConfiguration | undefined> { const result = await this.pool.query("SELECT * FROM gateway_upstreams WHERE id=$1", [id]); return result.rows[0] && this.toUpstream(result.rows[0]); }
  async create(input: UpstreamInput): Promise<UpstreamConfiguration> {
    const value = { ...input, id: input.id ?? randomUUID() } as UpstreamConfiguration;
    await validateUpstream(value, this.urlPolicy); await this.assertNamespaceAvailable(value.name, value.id);
    await this.pool.query("INSERT INTO gateway_upstreams (id,name,url,enabled,credential_ciphertext,timeout_ms) VALUES ($1,$2,$3,$4,$5,$6)", [value.id, value.name, value.url, value.enabled, value.credential ? this.cipher.encrypt(value.credential) : null, value.timeoutMs]);
    return value;
  }
  async update(id: string, patch: Partial<Omit<UpstreamConfiguration, "id">>): Promise<UpstreamConfiguration | undefined> {
    const current = await this.get(id); if (!current) return undefined;
    const value = { ...current, ...patch, id }; await validateUpstream(value, this.urlPolicy); await this.assertNamespaceAvailable(value.name, id);
    await this.pool.query("UPDATE gateway_upstreams SET name=$2,url=$3,enabled=$4,credential_ciphertext=$5,timeout_ms=$6,updated_at=now() WHERE id=$1", [id, value.name, value.url, value.enabled, value.credential ? this.cipher.encrypt(value.credential) : null, value.timeoutMs]);
    return value;
  }
  async remove(id: string): Promise<boolean> { return (await this.pool.query("DELETE FROM gateway_upstreams WHERE id=$1", [id])).rowCount === 1; }
  async createUser(username: string, role: Role): Promise<GatewayUser> {
    if (!/^[a-zA-Z0-9_.-]{3,80}$/.test(username) || !isRole(role)) throw new Error("User is invalid.");
    const id = randomUUID(); const result = await this.pool.query("INSERT INTO gateway_users (id,username,role) VALUES ($1,$2,$3) RETURNING *", [id, username, role]); return toUser(result.rows[0]);
  }
  async listUsers(): Promise<GatewayUser[]> { return (await this.pool.query("SELECT * FROM gateway_users ORDER BY username")).rows.map(toUser); }
  async issueApiKey(userId: string): Promise<IssuedApiKey> {
    const key = createApiKey(); const id = randomUUID(); const createdAt = new Date().toISOString();
    const result = await this.pool.query("INSERT INTO gateway_api_keys (id,user_id,key_hash) VALUES ($1,$2,$3) RETURNING created_at", [id, userId, await hashApiKey(key)]);
    if (result.rowCount !== 1) throw new Error("Could not issue API key."); return { id, key, createdAt: result.rows[0].created_at.toISOString() };
  }
  async revokeApiKey(id: string): Promise<boolean> { return (await this.pool.query("UPDATE gateway_api_keys SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL", [id])).rowCount === 1; }
  async authenticateApiKey(key: string): Promise<AuthenticatedUser | undefined> {
    const rows = (await this.pool.query("SELECT k.key_hash,u.id,u.username,u.role FROM gateway_api_keys k JOIN gateway_users u ON u.id=k.user_id WHERE k.revoked_at IS NULL")).rows;
    for (const row of rows) if (await verifyApiKey(key, row.key_hash)) return { id: row.id, username: row.username, role: row.role };
    return undefined;
  }
  async recordAudit(event: Omit<AuditEvent, "id" | "occurredAt">): Promise<void> {
    await this.pool.query("INSERT INTO gateway_audit_events (id,user_id,upstream_id,upstream_name,tool_name,duration_ms,outcome,error_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [randomUUID(), event.userId, event.upstreamId, event.upstreamName, event.toolName, event.durationMs, event.outcome, event.errorCode]);
  }
  async listAudit(limit = 100): Promise<AuditEvent[]> {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    return (await this.pool.query("SELECT * FROM gateway_audit_events ORDER BY occurred_at DESC LIMIT $1", [safeLimit])).rows.map((row) => ({ id: row.id, userId: row.user_id, upstreamId: row.upstream_id, upstreamName: row.upstream_name, toolName: row.tool_name, occurredAt: row.occurred_at.toISOString(), durationMs: row.duration_ms, outcome: row.outcome, errorCode: row.error_code }));
  }
  private toUpstream(row: Record<string, unknown>): UpstreamConfiguration { return { id: String(row.id), name: String(row.name), url: String(row.url), enabled: Boolean(row.enabled), credential: row.credential_ciphertext ? this.cipher.decrypt(String(row.credential_ciphertext)) : undefined, timeoutMs: Number(row.timeout_ms) }; }
  private async assertNamespaceAvailable(name: string, ignoredId: string): Promise<void> {
    const namespace = upstreamNamespace(name);
    const rows = (await this.pool.query("SELECT id,name FROM gateway_upstreams")).rows;
    if (rows.some((row) => row.id !== ignoredId && upstreamNamespace(row.name) === namespace)) throw new Error("Upstream names must produce unique tool namespaces.");
  }
}

async function validateUpstream(value: UpstreamConfiguration, urlPolicy: UpstreamUrlPolicy): Promise<void> { upstreamNamespace(value.name); await urlPolicy.validate(value.url); if (!Number.isInteger(value.timeoutMs) || value.timeoutMs < 100 || value.timeoutMs > 30_000) throw new Error("Upstream configuration is invalid."); }
function toUser(row: Record<string, unknown>): GatewayUser { return { id: String(row.id), username: String(row.username), role: row.role as Role, createdAt: new Date(String(row.created_at)).toISOString() }; }
function isRole(role: string): role is Role { return role === "admin" || role === "member"; }
export { publicConfiguration };
export type { PoolConfig };
