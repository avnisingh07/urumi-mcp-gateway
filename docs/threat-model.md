# Threat model

## Assets and trust boundaries

Gateway API keys, upstream credentials, the credential-encryption key, and
PostgreSQL state are sensitive. Browser/dashboard code and external MCP clients
are untrusted callers. Upstream MCP responses and LLM-provider tool requests
are also untrusted input. Kubernetes Secrets and internal Services are the
deployment trust boundary for service credentials.

## Controls

- API keys are generated once, scrypt-hashed at rest, authenticated on every
  HTTP/MCP request, and can be revoked immediately.
- Admin-only management APIs enforce roles; members can use MCP and chat but
  cannot administer users or upstreams.
- Upstream credentials are encrypted at rest and are excluded from management,
  health, tool, chat-trace, and audit responses.
- Registration permits HTTP(S) only, blocks embedded credentials and unsafe
  address classes, resolves hostnames, rejects redirects, and permits internal
  destinations only through explicit development or allow-list policy.
- Tool calls are schema-validated and routed only through `GatewayCore`.
  Disabled/unavailable tools cannot be invoked through stale discovery or chat.
- Failures are categorized and sanitized; audit data omits inputs, outputs,
  API keys, credentials, URLs, raw error bodies, and stack traces.
- Helm workloads use internal services, Secret references, probes, resource
  bounds, non-root settings where supported, and persistent PostgreSQL storage.

## Residual risks and operational requirements

The current Node fetch transport cannot guarantee DNS address pinning between
validation and connection. Use trusted DNS plus Kubernetes/network egress
policy in production. Restrict who can read Kubernetes Secrets, back up the
PostgreSQL PVC and Gateway credential Secret together, rotate keys through a
planned migration, and restrict dashboard/Ingress exposure with TLS. The
deterministic Inventory and Support fixtures are demonstrations, not an
authorization boundary or source of production business data.
