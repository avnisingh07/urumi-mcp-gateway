import { z } from "zod";
import { policyFromEnvironment, type UpstreamUrlPolicy } from "./upstream-url-policy.js";

const schema = z.object({ PORT: z.coerce.number().int().min(1).max(65535).default(3100), DATABASE_URL: z.string().url(), UPSTREAM_CREDENTIAL_ENCRYPTION_KEY: z.string().min(1), CHAT_PROVIDER_BASE_URL: z.string().url().optional(), CHAT_PROVIDER_API_KEY: z.string().min(1).optional(), CHAT_MODEL: z.string().min(1).optional(), CHAT_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(30000), CHAT_MAX_ITERATIONS: z.coerce.number().int().min(1).max(12).default(6) });
export type GatewayConfig = { port: number; databaseUrl: string; credentialEncryptionKey: string; urlPolicy: UpstreamUrlPolicy; chat?: { baseUrl: string; apiKey: string; model: string; timeoutMs: number; maxIterations: number } };
export function loadGatewayConfig(environment: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const parsed = schema.safeParse(environment);
  if (!parsed.success) throw new Error("Gateway configuration is invalid.");
  const chat = parsed.data.CHAT_PROVIDER_BASE_URL && parsed.data.CHAT_PROVIDER_API_KEY && parsed.data.CHAT_MODEL ? { baseUrl: parsed.data.CHAT_PROVIDER_BASE_URL, apiKey: parsed.data.CHAT_PROVIDER_API_KEY, model: parsed.data.CHAT_MODEL, timeoutMs: parsed.data.CHAT_TIMEOUT_MS, maxIterations: parsed.data.CHAT_MAX_ITERATIONS } : undefined;
  return { port: parsed.data.PORT, databaseUrl: parsed.data.DATABASE_URL, credentialEncryptionKey: parsed.data.UPSTREAM_CREDENTIAL_ENCRYPTION_KEY, urlPolicy: policyFromEnvironment(environment), ...(chat ? { chat } : {}) };
}
