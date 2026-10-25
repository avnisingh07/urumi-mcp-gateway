import { isIP } from "node:net";
import { resolve4, resolve6 } from "node:dns/promises";

export type DnsResolver = (hostname: string) => Promise<string[]>;
export type UpstreamUrlPolicyOptions = { allowedHostPatterns?: string[]; allowPrivateNetworks?: boolean; resolve?: DnsResolver };

/** Safe, externally reportable reason; never include a hostname or resolved address. */
export class UpstreamUrlPolicyError extends Error {
  constructor(public readonly code: "invalid_url" | "unsafe_destination") { super(code === "invalid_url" ? "Upstream URL is invalid." : "Upstream URL is not permitted."); }
}

export class UpstreamUrlPolicy {
  private readonly allowedHostPatterns: string[];
  private readonly resolve: DnsResolver;
  constructor(options: UpstreamUrlPolicyOptions = {}) {
    this.allowedHostPatterns = options.allowedHostPatterns ?? [];
    this.resolve = options.resolve ?? resolveHost;
    this.allowPrivateNetworks = options.allowPrivateNetworks === true;
  }
  private readonly allowPrivateNetworks: boolean;

  async validate(value: string): Promise<string> {
    let url: URL;
    try { url = new URL(value); } catch { throw new UpstreamUrlPolicyError("invalid_url"); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) throw new UpstreamUrlPolicyError("invalid_url");
    const hostname = normalizeHost(url.hostname);
    if (["metadata", "metadata.google.internal"].includes(hostname)) throw new UpstreamUrlPolicyError("unsafe_destination");
    const addresses = isIP(hostname) ? [hostname] : await this.resolveChecked(hostname);
    const allowPrivate = this.allowPrivateNetworks || this.matchesAllowedHost(hostname);
    if (addresses.some((address) => isAlwaysBlocked(address) || (isNonPublic(address) && !allowPrivate))) throw new UpstreamUrlPolicyError("unsafe_destination");
    return url.toString();
  }

  private async resolveChecked(hostname: string): Promise<string[]> {
    try {
      const addresses = await this.resolve(hostname);
      if (!addresses.length) throw new Error("empty");
      return addresses;
    } catch { throw new UpstreamUrlPolicyError("unsafe_destination"); }
  }
  private matchesAllowedHost(hostname: string): boolean {
    return this.allowedHostPatterns.some((pattern) => pattern.startsWith("*.") ? hostname.endsWith(pattern.slice(1)) && hostname.length > pattern.length - 1 : hostname === pattern);
  }
}

export function policyFromEnvironment(environment: NodeJS.ProcessEnv = process.env): UpstreamUrlPolicy {
  const allowedHostPatterns = (environment.UPSTREAM_ALLOWED_HOSTS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter((value) => /^(?:\*\.)?[a-z0-9.-]+$/.test(value));
  return new UpstreamUrlPolicy({ allowedHostPatterns, allowPrivateNetworks: environment.UPSTREAM_DEVELOPMENT_ALLOW_PRIVATE === "true" });
}

async function resolveHost(hostname: string): Promise<string[]> {
  const [ipv4, ipv6] = await Promise.allSettled([resolve4(hostname), resolve6(hostname)]);
  const addresses = [ ...(ipv4.status === "fulfilled" ? ipv4.value : []), ...(ipv6.status === "fulfilled" ? ipv6.value : []) ];
  if (!addresses.length) throw new Error("DNS lookup failed");
  return addresses;
}

function normalizeHost(hostname: string): string { return hostname.toLowerCase().replace(/^\[|\]$/g, ""); }
function isAlwaysBlocked(address: string): boolean {
  const value = address.toLowerCase();
  return value === "169.254.169.254" || value === "fd00:ec2::254" || value === "metadata.google.internal" || value === "::" || value === "::1" || value.startsWith("fe80:");
}
function isNonPublic(address: string): boolean {
  if (isIP(address) === 6) return address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:") || address === "::1" || address === "::";
  const parts = address.split(".").map(Number);
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224;
}
