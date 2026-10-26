import { z } from "zod";
import { loadGatewayConfig } from "./config.js";
import { PostgresGatewayStore, type InitialGatewayProvisioning } from "./gateway-store.js";

const provisioningSchema = z.object({
  GATEWAY_INITIAL_ADMIN_USERNAME: z.string().regex(/^[a-zA-Z0-9_.-]{3,80}$/),
  GATEWAY_INITIAL_ADMIN_API_KEY: z.string().regex(/^urumi_[A-Za-z0-9_-]{32,}$/),
  GATEWAY_INITIAL_WOOCOMMERCE_URL: z.string().url(),
  GATEWAY_INITIAL_INVENTORY_URL: z.string().url(),
  GATEWAY_INITIAL_SUPPORT_URL: z.string().url(),
  GATEWAY_INITIAL_UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(10_000),
});

export function loadInitialGatewayProvisioning(environment: NodeJS.ProcessEnv = process.env): InitialGatewayProvisioning {
  const parsed = provisioningSchema.safeParse(environment);
  if (!parsed.success) throw new Error("Initial gateway provisioning configuration is invalid.");
  const timeoutMs = parsed.data.GATEWAY_INITIAL_UPSTREAM_TIMEOUT_MS;
  return {
    adminUsername: parsed.data.GATEWAY_INITIAL_ADMIN_USERNAME,
    adminApiKey: parsed.data.GATEWAY_INITIAL_ADMIN_API_KEY,
    upstreams: [
      { name: "WooCommerce", url: parsed.data.GATEWAY_INITIAL_WOOCOMMERCE_URL, timeoutMs },
      { name: "Inventory", url: parsed.data.GATEWAY_INITIAL_INVENTORY_URL, timeoutMs },
      { name: "Support", url: parsed.data.GATEWAY_INITIAL_SUPPORT_URL, timeoutMs },
    ],
  };
}

async function main(): Promise<void> {
  const store = PostgresGatewayStore.fromConfig(loadGatewayConfig());
  try {
    await store.migrate();
    const result = await store.provisionInitialState(loadInitialGatewayProvisioning());
    // Never print the supplied raw key. Operators retain it in their secret manager.
    process.stdout.write(`Gateway initial provisioning ${result.status}.\n`);
  } finally { await store.close(); }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void main().catch(() => { console.error("Gateway initial provisioning failed."); process.exitCode = 1; });
}
