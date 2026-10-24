import { z } from "zod";

const configurationSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WOOCOMMERCE_BASE_URL: z.url().refine(
    (value) => {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    },
    "must use http or https",
  ),
  WOOCOMMERCE_CONSUMER_KEY: z.string().trim().min(1),
  WOOCOMMERCE_CONSUMER_SECRET: z.string().trim().min(1),
  WOOCOMMERCE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(10_000),
});

export type WooCommerceConfig = {
  port: number;
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  requestTimeoutMs: number;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): WooCommerceConfig {
  const result = configurationSchema.safeParse(environment);

  if (!result.success) {
    throw new Error("WooCommerce MCP configuration is invalid.");
  }

  return {
    port: result.data.PORT,
    baseUrl: result.data.WOOCOMMERCE_BASE_URL.replace(/\/+$/, ""),
    consumerKey: result.data.WOOCOMMERCE_CONSUMER_KEY,
    consumerSecret: result.data.WOOCOMMERCE_CONSUMER_SECRET,
    requestTimeoutMs: result.data.WOOCOMMERCE_REQUEST_TIMEOUT_MS,
  };
}
