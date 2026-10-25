import type { UpstreamConfiguration } from "@urumi/shared";
import type { UpstreamRepository } from "./upstream-repository.js";
import { StreamableHttpUpstreamClient, UpstreamError } from "./upstream-client.js";

export type UpstreamHealth = { id: string; name: string; enabled: boolean; state: "disabled" | "reachable" | "unreachable"; toolCount: number | null; lastCheckedAt: string; error: "timeout" | "unavailable" | "protocol" | null };

/** Coalesces concurrent checks and caches a short result to bound dashboard polling. */
export class UpstreamHealthReporter {
  private cached?: { expiresAt: number; value: UpstreamHealth[] };
  private pending?: Promise<UpstreamHealth[]>;
  constructor(private readonly repository: UpstreamRepository, private readonly client = new StreamableHttpUpstreamClient(), private readonly ttlMs = 5_000, private readonly now = () => Date.now()) {}
  async report(): Promise<UpstreamHealth[]> {
    if (this.cached && this.cached.expiresAt > this.now()) return this.cached.value;
    if (this.pending) return this.pending;
    this.pending = this.check().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async check(): Promise<UpstreamHealth[]> {
    const checkedAt = new Date(this.now()).toISOString();
    const upstreams = await this.repository.list();
    const value = await Promise.all(upstreams.map((upstream) => this.checkOne(upstream, checkedAt)));
    this.cached = { expiresAt: this.now() + this.ttlMs, value };
    return value;
  }
  private async checkOne(upstream: UpstreamConfiguration, lastCheckedAt: string): Promise<UpstreamHealth> {
    if (!upstream.enabled) return { id: upstream.id, name: upstream.name, enabled: false, state: "disabled", toolCount: null, lastCheckedAt, error: null };
    try { const tools = await this.client.listTools(upstream); return { id: upstream.id, name: upstream.name, enabled: true, state: "reachable", toolCount: tools.length, lastCheckedAt, error: null }; }
    catch (error) { return { id: upstream.id, name: upstream.name, enabled: true, state: "unreachable", toolCount: null, lastCheckedAt, error: error instanceof UpstreamError ? error.kind : "unavailable" }; }
  }
}
