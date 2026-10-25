import { loadGatewayConfig } from "./config.js";
import { PostgresGatewayStore } from "./gateway-store.js";

async function main(): Promise<void> {
  const username = process.argv[2];
  if (!username) throw new Error("Usage: npm run bootstrap-admin -- <username>");
  const store = PostgresGatewayStore.fromConfig(loadGatewayConfig());
  try {
    await store.migrate();
    const user = await store.createUser(username, "admin");
    const apiKey = await store.issueApiKey(user.id);
    // This is the single intentional display of the newly generated raw key.
    process.stdout.write(`${apiKey.key}\n`);
  } finally {
    await store.close();
  }
}

void main().catch(() => { console.error("Admin bootstrap failed."); process.exitCode = 1; });
