export function postgresTestSkip(databaseUrl = process.env.GATEWAY_TEST_DATABASE_URL) {
  if (!databaseUrl) return "Set GATEWAY_TEST_DATABASE_URL to a dedicated database whose name contains _test.";
  try {
    const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    return /(?:^|[_-])test(?:[_-]|$)/.test(name)
      ? false
      : "Refusing to run: GATEWAY_TEST_DATABASE_URL must name a dedicated database containing _test.";
  } catch {
    return "Refusing to run: GATEWAY_TEST_DATABASE_URL is not a valid PostgreSQL URL.";
  }
}
