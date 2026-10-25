import { z } from "zod";

const schema = z.object({ PORT: z.coerce.number().int().min(1).max(65535).default(3100), DATABASE_URL: z.string().url(), UPSTREAM_CREDENTIAL_ENCRYPTION_KEY: z.string().min(1) });
export type GatewayConfig = { port: number; databaseUrl: string; credentialEncryptionKey: string };
export function loadGatewayConfig(environment: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const parsed = schema.safeParse(environment);
  if (!parsed.success) throw new Error("Gateway configuration is invalid.");
  return { port: parsed.data.PORT, databaseUrl: parsed.data.DATABASE_URL, credentialEncryptionKey: parsed.data.UPSTREAM_CREDENTIAL_ENCRYPTION_KEY };
}
