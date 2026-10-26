# System design and tradeoffs

The Gateway is the authenticated boundary for one Streamable HTTP MCP endpoint.
It persists users, one-way API-key hashes, encrypted upstream credentials,
upstream configuration, and redacted audit events in PostgreSQL. It discovers
enabled upstream tools at request time, prefixes each tool with a deterministic
upstream namespace, validates advertised JSON Schema before forwarding calls,
and routes calls through a bounded-timeout client. This keeps WooCommerce,
Inventory, and Support independent while presenting one client endpoint.

The chat API is server-side only. A provider adapter may request tools, but the
agent always invokes `GatewayCore`; consequently normal discovery, disabled
checks, validation, timeout behavior, and audit attribution still apply.

The Helm chart keeps upstream MCP services, PostgreSQL, and Gateway internal.
The dashboard placeholder has its own Ingress and proxies future browser API
requests to Gateway; it does not receive upstream credentials. PostgreSQL uses
a PVC and a generated-once Gateway credential Secret so upgrades do not rotate
the credential-encryption key that protects persisted upstream credentials.

Tradeoff: upstream health is cached briefly and checked independently, so it
reduces polling load and isolates failures but is not a real-time pod monitor.
The URL policy resolves hosts before use and requests reject redirects. Node's
standard `fetch` cannot pin the resolved address for the connection, therefore
production also relies on trusted DNS and network egress controls to mitigate
DNS rebinding.
