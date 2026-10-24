import { WooCommerceClientError } from "./errors.js";
import type { WooCommerceConfig } from "./config.js";

export type FetchImplementation = (input: URL | string, init?: RequestInit) => Promise<Response>;

export class WooCommerceClient {
  public constructor(
    private readonly config: WooCommerceConfig,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  public async listProducts(query: Record<string, string | number | undefined>): Promise<unknown[]> {
    return this.asArray(await this.request("products", { query }));
  }

  public async createProduct(payload: Record<string, unknown>): Promise<unknown> {
    return this.request("products", { method: "POST", body: payload });
  }

  public async listOrders(query: Record<string, string | number | undefined>): Promise<unknown[]> {
    return this.asArray(await this.request("orders", { query }));
  }

  public async getOrder(orderId: number): Promise<unknown> {
    return this.request(`orders/${orderId}`);
  }

  public async updateOrderStatus(orderId: number, status: string): Promise<unknown> {
    return this.request(`orders/${orderId}`, { method: "PUT", body: { status } });
  }

  public async checkReady(): Promise<void> {
    await this.request("system_status");
  }

  private async request(
    path: string,
    options: {
      method?: "GET" | "POST" | "PUT";
      query?: Record<string, string | number | undefined>;
      body?: Record<string, unknown>;
    } = {},
  ): Promise<unknown> {
    const url = new URL(`wp-json/wc/v3/${path}`, `${this.config.baseUrl}/`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    const credentials = Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString("base64");

    try {
      const response = await this.fetchImplementation(url, {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${credentials}`,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) throw this.httpError(response.status);

      try {
        return (await response.json()) as unknown;
      } catch {
        throw new WooCommerceClientError("response", "WooCommerce returned an invalid response.");
      }
    } catch (error) {
      if (error instanceof WooCommerceClientError) throw error;
      if (controller.signal.aborted) {
        throw new WooCommerceClientError("timeout", "The WooCommerce request timed out.");
      }
      throw new WooCommerceClientError("network", "The WooCommerce service is unavailable.");
    } finally {
      clearTimeout(timeout);
    }
  }

  private asArray(value: unknown): unknown[] {
    if (!Array.isArray(value)) {
      throw new WooCommerceClientError("response", "WooCommerce returned an invalid response.");
    }
    return value;
  }

  private httpError(status: number): WooCommerceClientError {
    if (status === 401 || status === 403) {
      return new WooCommerceClientError("http", "WooCommerce rejected the service credentials.", status);
    }
    if (status === 404) {
      return new WooCommerceClientError("http", "The requested WooCommerce resource was not found.", status);
    }
    if (status === 429) {
      return new WooCommerceClientError("http", "WooCommerce is temporarily rate limiting requests.", status);
    }
    return new WooCommerceClientError("http", "WooCommerce could not complete this request.", status);
  }
}
