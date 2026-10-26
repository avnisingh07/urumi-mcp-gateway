// Runtime configuration contains an endpoint only. API keys are never build-time configuration.
declare global { interface Window { __URUMI_CONFIG__?: { apiBaseUrl?: string } } }
const raw = window.__URUMI_CONFIG__?.apiBaseUrl ?? "/api";
export const GATEWAY_BASE_URL = raw.replace(/\/+$/, "");
