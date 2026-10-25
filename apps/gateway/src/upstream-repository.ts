import type { PublicUpstreamConfiguration, UpstreamConfiguration } from "@urumi/shared";

export type UpstreamInput = Omit<UpstreamConfiguration, "id"> & { id?: string };

export interface UpstreamRepository {
  list(): Promise<UpstreamConfiguration[]>;
  get(id: string): Promise<UpstreamConfiguration | undefined>;
  create(input: UpstreamInput): Promise<UpstreamConfiguration>;
  update(id: string, input: Partial<Omit<UpstreamConfiguration, "id">>): Promise<UpstreamConfiguration | undefined>;
  remove(id: string): Promise<boolean>;
}

/**
 * M3's repository adapter. A database-backed implementation can satisfy this
 * interface later without changing discovery or routing.
 */
export class InMemoryUpstreamRepository implements UpstreamRepository {
  private readonly upstreams = new Map<string, UpstreamConfiguration>();
  private nextId = 1;

  async list(): Promise<UpstreamConfiguration[]> {
    return [...this.upstreams.values()].map((value) => ({ ...value }));
  }

  async get(id: string): Promise<UpstreamConfiguration | undefined> {
    const value = this.upstreams.get(id);
    return value && { ...value };
  }

  async create(input: UpstreamInput): Promise<UpstreamConfiguration> {
    const id = input.id ?? `upstream-${this.nextId++}`;
    if (this.upstreams.has(id)) throw new Error("An upstream with this id already exists.");
    const value = validateConfiguration({ ...input, id });
    this.assertNamespaceAvailable(value.name, id);
    this.upstreams.set(id, value);
    return { ...value };
  }

  async update(id: string, input: Partial<Omit<UpstreamConfiguration, "id">>): Promise<UpstreamConfiguration | undefined> {
    const current = this.upstreams.get(id);
    if (!current) return undefined;
    const value = validateConfiguration({ ...current, ...input, id });
    this.assertNamespaceAvailable(value.name, id);
    this.upstreams.set(id, value);
    return { ...value };
  }

  async remove(id: string): Promise<boolean> {
    return this.upstreams.delete(id);
  }

  private assertNamespaceAvailable(name: string, ignoredId: string): void {
    const namespace = upstreamNamespace(name);
    for (const upstream of this.upstreams.values()) {
      if (upstream.id !== ignoredId && upstreamNamespace(upstream.name) === namespace) {
        throw new Error("Upstream names must produce unique tool namespaces.");
      }
    }
  }
}

export function upstreamNamespace(name: string): string {
  const namespace = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!namespace || namespace.length > 48) throw new Error("Upstream name cannot be converted into a safe namespace.");
  return namespace;
}

export function publicConfiguration(value: UpstreamConfiguration): PublicUpstreamConfiguration {
  const { credential: _credential, ...publicValue } = value;
  return publicValue;
}

function validateConfiguration(value: UpstreamConfiguration): UpstreamConfiguration {
  if (!value.id.trim()) throw new Error("Upstream id is required.");
  upstreamNamespace(value.name);
  let url: URL;
  try { url = new URL(value.url); } catch { throw new Error("Upstream URL must be valid."); }
  if (url.protocol !== "http:" && url.protocol !== "https:" || url.username || url.password) throw new Error("Upstream URL must use HTTP or HTTPS without embedded credentials.");
  if (!Number.isInteger(value.timeoutMs) || value.timeoutMs < 100 || value.timeoutMs > 30_000) {
    throw new Error("Upstream timeout must be between 100 and 30000 ms.");
  }
  return { ...value, url: url.toString() };
}
