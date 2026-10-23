# Urumi MCP Gateway — Agent Instructions

## 1. Project Goal

Implement the Urumi AI FDE assignment as a working, secure, reproducible Kubernetes application. Prioritize mandatory requirements, end-to-end correctness, and acceptance tests over optional features and visual polish.

The platform must host a WooCommerce store on Kubernetes and provide a team MCP gateway that aggregates multiple upstream MCP servers behind one authenticated endpoint. Administrators manage upstream servers and team access through a dashboard. Team members use the gateway through external MCP clients or an in-dashboard chat agent.

AI coding tools may be used to accelerate development, but every implementation decision must be understood and explainable. Do not describe code as working unless it has actually been implemented and verified.

## 2. Repository and Existing Environment

This directory is the Git repository root.

- Project: `urumi-mcp-gateway`
- Language: TypeScript/Node.js
- Frontend: React + TypeScript
- Container runtime: Docker Desktop
- Local Kubernetes: k3d
- Kubernetes ingress: Traefik
- Deployment: Helm
- Database for gateway application state: PostgreSQL
- Store: WordPress + WooCommerce with persistent storage
- MCP transport: Streamable HTTP

Existing files include:

- `AGENTS.md`
- `README.md`
- `.gitignore`
- `.env.example`
- `package.json`
- `docs/learning-log.md`
- `docs/system-design.md`
- `docs/threat-model.md`
- `scripts/k3d-up.sh`

The current `.gitignore` initially contains only `node_modules/` and `.DS_Store`. Expand it safely to cover secrets and generated files.

The current `scripts/k3d-up.sh` is empty. Inspect it before editing. Implement cluster setup only in the appropriate milestone; do not unexpectedly alter the cluster during workspace initialization.

The local k3d cluster named `urumi` has already been created and verified. Traefik is installed, and the default `local-path` StorageClass is available. Inspect the live environment before recreating or modifying it.

### Expected project structure

```text
urumi-mcp-gateway/
├── AGENTS.md
├── README.md
├── package.json
├── .gitignore
├── .env.example
├── apps/
│   ├── dashboard/
│   └── gateway/
├── services/
│   ├── woocommerce-mcp/
│   ├── inventory-mcp/
│   └── support-mcp/
├── packages/
│   └── shared/
├── deploy/
│   └── helm/
│       └── urumi/
│           ├── Chart.yaml
│           ├── values.yaml
│           ├── values-local.yaml
│           ├── values-prod.yaml
│           └── templates/
├── scripts/
├── tests/
└── docs/
    ├── learning-log.md
    ├── system-design.md
    └── threat-model.md
```

Adapt this structure if there is a justified reason, but do not create duplicate project roots or overwrite existing work.

## 3. Assignment Requirements

### 3.1 WooCommerce store

Run WordPress and WooCommerce in Kubernetes with a database and persistent storage.

Requirements:

- The storefront is accessible through a stable Ingress URL.
- The WooCommerce administration interface works.
- A reviewer can add a product to a cart and complete a test-friendly checkout using an appropriate dummy payment method or cash on delivery.
- The resulting order appears in WooCommerce admin.
- Database contents and WordPress uploads/content persist across relevant pod restarts.
- Store setup and verification are reproducible.

Use a maintained Helm chart or another justified, reproducible Helm-based deployment approach. Verify chart availability and compatibility before choosing dependencies.

### 3.2 Custom WooCommerce MCP server

Build our own MCP server. Do not substitute an existing WooCommerce MCP server or plugin for this implementation.

Use TypeScript/Node.js, the official MCP SDK, Streamable HTTP, and the WooCommerce REST API unless a documented technical reason requires an alternative.

Implement these five tools:

1. `list_products`
2. `create_product`
3. `list_orders`
4. `get_order`
5. `update_order_status`

Requirements:

- Validate tool inputs.
- Return useful, sanitized errors.
- Include health checks and tests.
- Connect to the real WooCommerce store.
- Verify that product creation and order-status updates persist.
- Keep the service internal-only in Kubernetes. Do not expose it through a public Ingress.
- Store WooCommerce API credentials in Kubernetes Secrets or an equivalent secure configuration mechanism.

### 3.3 Additional MCP servers

Implement two independent MCP servers:

- Inventory MCP server
- Support MCP server

Requirements:

- Each exposes a distinct set of meaningful tools.
- Each provides deterministic, testable data.
- Each has its own health check and error handling.
- Each can be deployed and stopped independently.
- A failure in one server must not require the other servers to stop.

Do not make these servers depend on the WooCommerce MCP server merely to provide their basic functionality.

### 3.4 MCP gateway

The gateway acts as both:

- An MCP client to the upstream MCP servers.
- An MCP server exposing a single endpoint to downstream clients.

Requirements:

- Register, edit, enable, disable, and remove upstream servers.
- Support an upstream URL and optional static credentials.
- Discover tools from every enabled and reachable upstream.
- Route each tool call to its correct upstream.
- Apply request timeouts.
- Return clear, sanitized errors.
- Isolate failures so an unreachable upstream does not disable healthy upstreams.
- Remove disabled servers' tools from effective tool discovery.
- Prevent calls to tools belonging to disabled servers.
- Document and test a deterministic tool-name collision strategy.

Use a namespace convention such as:

`woocommerce__list_orders`

Use equivalent prefixes for the inventory and support servers. Do not silently resolve collisions by overwriting one tool with another.

The gateway must expose one MCP endpoint. External clients must not need individual upstream URLs or upstream credentials.

### 3.5 Users, API keys, and roles

Use PostgreSQL for application state, including:

- Users
- Roles
- Hashed API keys
- Upstream configuration
- Audit events

Support at least two roles:

- `admin`
- `member`

Requirements:

- Generate an individual, sufficiently random API key for each user.
- Display a newly generated key only once.
- Store only a secure hash of the gateway API key at rest.
- Support key revocation.
- Reject requests using revoked keys.
- Enforce authentication and authorization in the backend.
- Prevent members from performing admin-only operations.
- Never expose another user's secret API key.
- Never forward a downstream client's gateway API key to an upstream MCP server.
- Never expose upstream credentials to the browser or downstream MCP clients.
- Never log API keys, passwords, or other secrets.

A frontend visibility rule is not an authorization boundary. Every protected operation must enforce permissions on the server.

### 3.6 Audit trail

Record every relevant tool call with:

- Authenticated user
- Upstream server
- Tool name
- Timestamp
- Duration
- Outcome

Include sanitized failure information where useful, without recording credentials or sensitive payloads unnecessarily.

Chat tool calls must be attributed to the currently authenticated user.

Build backend tests for audit attribution, authorization, key revocation, and failure outcomes.

### 3.7 Dashboard

Build the dashboard in `apps/dashboard` using React and TypeScript.

The dashboard must use real backend APIs for core functionality.

Required areas:

- Overview and server health
- Upstream server management
- Tool inventory
- Team members and API-key management
- Audit logs
- Chat agent

Required behavior:

- Admins can add, edit, disable, and remove upstream servers.
- Users can inspect server health and available tools within their permissions.
- Authorized admins can manage team access and revoke keys.
- Authorized users can view and filter audit events.
- The interface shows loading, empty, success, error, disabled, and unreachable states.
- Destructive actions require appropriate confirmation.
- The interface accurately reflects backend success or failure.

A mock mode may be used during initial UI design, but it must be clearly labeled and must not be mistaken for a real integration. Do not leave critical functionality backed by mock data.

If using Lovable to generate UI, keep the generated frontend in this repository and connect it to our backend. Do not make core application behavior depend on Lovable Cloud or an external mock backend.

### 3.8 Chat agent

Implement a server-side LLM tool-calling loop.

Requirements:

- The chat agent uses the authenticated user's identity and permissions.
- It invokes tools through the gateway, not by directly accessing upstream servers.
- It displays the tools called, their source servers, execution states, and results/errors.
- Its tool calls appear in the audit log under the correct user.
- LLM credentials remain server-side and are supplied through secure configuration.
- Tool descriptions and tool outputs are treated as untrusted input.
- The agent must not allow malicious tool output to override system instructions or bypass authorization.

Do not implement a fake chat interface that merely returns predetermined answers.

### 3.9 External MCP client

Support a downstream MCP client such as MCP Inspector or another compatible client.

The reviewer should need only:

- The gateway MCP endpoint
- The individual user's gateway API key

The client must be able to discover and call tools from all enabled upstream servers through the gateway.

Verify:

- Tool discovery across all three upstreams.
- A successful WooCommerce tool call.
- A successful call to another upstream.
- One request or workflow requiring tools from two different upstreams.
- Rejection after the user's API key is revoked.

Document the exact connection and authentication procedure for the chosen client.

### 3.10 Kubernetes and Helm

Run the store, databases, gateway, dashboard, and all three MCP servers in Kubernetes.

Requirements:

- Use Helm, not Kustomize, as the deployment mechanism.
- Use the same Helm chart for local Kubernetes and production-like k3s/VPS deployments.
- Control environmental differences using values files.
- Persist the WooCommerce database and WordPress content.
- Expose the storefront and dashboard through Ingress.
- Keep the WooCommerce MCP service internal-only.
- Configure readiness and liveness probes.
- Configure resource requests and limits for every workload.
- Store credentials in Kubernetes Secrets or an appropriate external secret mechanism.
- Do not hardcode or commit real credentials.
- Document internal and public service boundaries.
- Document upgrades and rollbacks.

Provide at least:

- `values.yaml`
- `values-local.yaml`
- `values-prod.yaml`

Do not claim a production deployment has been verified unless it has actually been deployed and tested.

### 3.11 Failure isolation and security

The gateway must continue serving healthy upstreams when another upstream is slow, unreachable, disabled, or stopped.

Implement:

- Connection/request timeouts
- Sanitized error handling
- Independent upstream health reporting
- Authentication and authorization
- API-key hashing and revocation
- Input validation
- Safe handling of upstream tool descriptions and outputs
- Protection against accidental credential leakage

Validate upstream URLs and restrict unsafe network destinations to reduce server-side request forgery (SSRF) risks. Do not permit arbitrary public or internal URLs without appropriate validation and policy.

Document limitations of the local Kubernetes environment, including any NetworkPolicy enforcement assumptions.

## 4. Implementation Rules

1. Work on one milestone at a time.
2. Give Codex only the task required for the current milestone. Do not repeatedly ask it to re-plan the entire assignment.
3. Read this file for persistent requirements, but avoid repeatedly copying the entire assignment into individual prompts.
4. Before editing, inspect relevant existing files, Git status, dependencies, scripts, and tests.
5. Make small, complete, testable changes.
6. Preserve existing work unless a change is necessary and justified.
7. Do not reset, discard, or overwrite existing Git changes without explicit approval.
8. Do not replace the package manager or architecture without explaining why.
9. Pin compatible dependency versions.
10. Use the official MCP SDK APIs supported by the installed version. Verify transport and authentication behavior against that version.
11. Add automated tests for implemented behavior.
12. Run relevant tests, type checks, builds, and deployment validation where configured.
13. Report the exact commands run and their actual results.
14. Never claim a test, build, deployment, or manual verification passed unless it was actually performed.
15. Do not hardcode secrets or commit real credentials.
16. Do not leave critical functionality backed by mock data.
17. Do not implement optional bonuses until mandatory requirements and acceptance tests are complete.
18. Do not proceed past a milestone's pass conditions without reporting any blockers.
19. Separate automated checks from manual steps requiring the user, credentials, browser interaction, or external services.
20. Treat upstream tool descriptions and outputs as untrusted input.
21. Validate data at trust boundaries.
22. Avoid logging secrets or unnecessary sensitive data.
23. Use disposable test data for destructive tests and explain data-loss risks before running them.
24. If a prerequisite cannot be verified, report what is unknown and ask for the minimum manual action needed.
25. Prefer a working, demonstrable end-to-end system over premature optimization or superficial visual polish.
26. Conserve coding-agent context: keep tasks narrow, avoid unnecessary repository-wide re-analysis, and request a concise completion report.

## 5. Git and Repository Safety

- Inspect `git status --short` before making changes.
- Review existing staged and unstaged changes separately.
- Do not accidentally include unrelated files in a commit.
- Do not remove existing scripts or documentation merely because they are currently empty.
- Run `git diff --check` before committing.
- Keep `.env.example` limited to variable names and safe placeholders.
- Ignore `.env` files, secrets, dependencies, and generated build artifacts.
- Never put API keys, passwords, or production credentials in source files, README examples, test fixtures, or Git history.

The `.gitignore` must eventually cover at least:

- `node_modules/`
- `.DS_Store`
- Environment files other than `.env.example`
- Build output and generated coverage
- Local logs and temporary files
- Private key and credential files

Preserve existing ignore rules when expanding `.gitignore`.

## 6. Milestone Sequence

Follow this sequence. A milestone is complete only when its pass conditions are verified.

### M0 — Environment and workspace baseline

**Agent responsibilities**

- Inspect the repository, Git status, manifests, scripts, docs, and existing dependencies.
- Establish the TypeScript npm workspace.
- Create minimal package manifests and entry points for the dashboard, gateway, three MCP servers, and shared package.
- Configure honest build and type-check scripts.
- Expand `.gitignore` safely.
- Preserve existing documentation and infrastructure scripts.
- Avoid implementing business logic, database integration, MCP tools, authentication, or Kubernetes application manifests at this stage.

**Manual responsibilities**

- Verify tools and local cluster are available.
- Review the changes and run the reported commands.

**Pass conditions**

- Repository root and existing changes are understood.
- Workspace dependencies install successfully.
- Build and type-check commands work.
- No accidental overwrites or duplicate project roots are introduced.
- The existing k3d cluster remains intact.

Do not start M1 until M0 passes.

### M1 — WooCommerce running in Kubernetes

**Agent responsibilities**

- Choose and validate a reproducible Helm-based WooCommerce deployment approach.
- Configure WordPress, WooCommerce, database, persistence, and Ingress.
- Document local URLs and access steps.

**Manual responsibilities**

- Deploy to the existing local cluster.
- Access the storefront and WooCommerce admin.
- Complete a test-friendly checkout.
- Verify that the order appears in admin.
- Test persistence after relevant pod restarts.

**Pass conditions**

- Storefront and admin work.
- Checkout produces a real WooCommerce order.
- Database and WordPress content persist.
- Setup is reproducible.

Do not start M2 until M1 passes.

### M2 — Custom WooCommerce MCP server

**Agent responsibilities**

- Implement Streamable HTTP MCP transport.
- Implement the five required WooCommerce tools.
- Add input validation, errors, health checks, and tests.
- Integrate with the real WooCommerce REST API.

**Manual responsibilities**

- Create appropriate WooCommerce REST API credentials.
- Store them securely.
- Deploy and test the service against the running store.

**Pass conditions**

- All five tools work against real store data.
- Product creation and order-status updates persist.
- Order queries return actual data.
- The server is internal-only.
- Credentials are not committed or exposed.

Do not start M3 until M2 passes.

### M3 — Inventory and support MCP servers

**Agent responsibilities**

- Implement the independent inventory and support servers.
- Add distinct tool sets, deterministic data, health checks, validation, and tests.
- Prepare deployment configuration.

**Manual responsibilities**

- Build and deploy both services.

**Pass conditions**

- All three upstreams run independently.
- Each exposes distinct, testable tools.
- Each can be health-checked independently.

Do not start M4 until M3 passes.

### M4 — MCP gateway

**Agent responsibilities**

- Implement upstream registration, discovery, namespacing, routing, enable/disable behavior, timeouts, and failure isolation.
- Expose one downstream MCP endpoint.
- Add automated routing and failure tests.

**Manual responsibilities**

- Configure upstreams.
- Disable an upstream and stop an upstream pod to test behavior.

**Pass conditions**

- Enabled upstream tools are discoverable through one endpoint.
- Tool calls reach the correct upstream.
- Namespacing is deterministic and documented.
- Disabled upstream tools disappear and cannot be called.
- Dead or slow upstreams do not break healthy upstreams.

Do not start M5 until M4 passes.

### M5 — Users, API keys, and audit trail

**Agent responsibilities**

- Implement PostgreSQL schema and migrations.
- Implement user roles, key generation, hashing, revocation, authorization, and audit logging.
- Add automated security and integration tests.

**Manual responsibilities**

- Configure the initial admin securely.
- Test with User A and User B.

**Pass conditions**

- Keys are shown once, hashed at rest, and revocable.
- Revoked keys are rejected.
- Backend authorization is enforced.
- Every tool call is attributed to the correct user.
- Gateway keys are never forwarded to upstreams.

Do not start M6 until M5 passes.

### M6 — Real dashboard

**Agent responsibilities**

- Implement the dashboard in `apps/dashboard`.
- Integrate with real backend APIs.
- Implement server management, team management, audit logs, health states, and required interactions.
- Add frontend tests where practical.

**Manual responsibilities**

- Review usability and responsive behavior.
- Test interactions against the deployed backend.

**Pass conditions**

- Required management functions work.
- Health and audit information reflect actual backend state.
- Core features are not backed by mock data.
- UI actions accurately reflect backend success or failure.

Do not start M7 until M6 passes.

### M7 — Chat agent and external MCP client

**Agent responsibilities**

- Implement the server-side LLM tool-calling loop.
- Route chat tool execution through the gateway.
- Preserve the authenticated user's identity and permissions.
- Display tool calls and results.
- Document external client authentication and connection.

**Manual responsibilities**

- Supply the LLM API key securely.
- Connect MCP Inspector or another supported client.
- Test with User B's gateway API key.

**Pass conditions**

- Chat executes real tools and records audit events under the right user.
- External clients discover and execute tools through the gateway.
- Cross-server tool usage works.
- No upstream credentials or URLs are required by the external client.
- Authorization and revocation work.

Do not start M8 until M7 passes.

### M8 — Reproducible Helm deployment

**Agent responsibilities**

- Complete the Helm chart and local/production values.
- Complete container builds, probes, resource requests/limits, persistence, and Ingress.
- Document secrets, deployment, upgrades, and rollbacks.
- Ensure the WooCommerce MCP service has no public Ingress.

**Manual responsibilities**

- Install or upgrade the chart.
- Inspect Kubernetes resources and Secrets.
- Restart workloads and verify health and persistence.
- Test production-like k3s/VPS deployment if resources are available.

**Pass conditions**

- The same chart supports local and production-like environments through values.
- Persistence works.
- Probes and resource settings exist.
- Secrets are not hardcoded.
- Internal/public service boundaries are correct.
- Deployment instructions are verified to the extent the environment permits.

Do not start M9 until M8 passes.

### M9 — End-to-end acceptance tests

**Agent responsibilities**

- Create repeatable scripts for testable flows.
- Cover discovery, routing, failure isolation, authorization, revocation, and audit attribution.
- Clearly identify tests that require manual interaction.
- Keep destructive tests restricted to disposable environments.

**Manual responsibilities**

Run the required flows:

**Store**

1. Open the storefront.
2. Add a product to the cart.
3. Complete a test-friendly checkout.
4. Confirm the order in WooCommerce admin.

**Chat as User A**

1. Ask the agent to create a product with a name and price.
2. Verify the product appears in the storefront.
3. Place an order for the product through the storefront.
4. Ask which orders came in today.
5. Verify the new order is included.

**External MCP client as User B**

1. Connect using only the gateway URL and User B's key.
2. Discover tools from every enabled upstream.
3. Query the same orders through the client.
4. Run a prompt that requires tools from two different upstreams.

**Team and control**

1. Revoke User B's key.
2. Verify the next request is rejected.
3. Disable an upstream.
4. Verify its tools disappear from chat and external-client discovery.
5. Stop one upstream pod.
6. Verify healthy upstreams remain usable and the dashboard reports the failed upstream as unreachable.
7. Verify tool calls appear in the audit log with the correct user, server, tool, timestamp, duration, and outcome.

**Pass conditions**

- All mandatory scenarios pass or have explicitly documented limitations.
- Do not report failed or untested scenarios as successful.

Do not start M10 until mandatory acceptance testing is complete.

### M10 — Submission package

**Agent responsibilities**

- Complete README, system design, threat model, scripts, and test instructions.
- Document local and production-like setup.
- Explain the architecture, tool discovery/routing, collision strategy, timeouts, error isolation, and security boundaries.
- Document local URLs, checkout, external MCP connection, and chat usage.
- Document Kubernetes resources, Secrets, storage, Ingress, probes, resource requests/limits, and internal-only services.
- Document Helm values, upgrade, rollback, test results, and known gaps.

**Manual responsibilities**

- Verify setup instructions as far as the environment permits.
- Record the demo video.
- Review repository contents and submission form before submitting.

**Pass conditions**

- A reviewer can reproduce the demo from the repository and documentation.
- Required source code, chart, values, scripts, tests, and docs are present.
- The demo shows the real system, including store checkout, MCP execution, two-user behavior, audit/security controls, Kubernetes deployment, and the production-like deployment approach.
- Submission artifacts are complete and accurate.

## 7. Required Submission Documentation

### README.md

The README is written for a reviewer, not as instructions for the coding agent.

It must eventually include:

- Project overview and architecture summary
- Prerequisites and versions
- Environment configuration
- Local cluster and Helm setup
- Required Secrets and how to configure them safely
- Storefront, admin, dashboard, and gateway URLs
- Test checkout instructions
- How to create or configure users and API keys
- How to connect an external MCP client
- How to use the chat agent
- Test and verification commands
- Production-like deployment instructions
- Upgrade and rollback commands
- Known limitations and unverified scenarios

Document commands only after verifying them. During early milestones, the README may remain minimal.

### docs/system-design.md

Document:

- Components and responsibilities
- Data flows and service communication
- MCP discovery and routing
- Tool naming and collision handling
- Timeouts and failure isolation
- Database and persistence design
- Authentication and authorization
- Deployment topology and design trade-offs

### docs/threat-model.md

Document:

- Trust boundaries and assets
- User and admin privilege differences
- API-key generation, storage, and revocation
- Upstream credential storage
- Why gateway keys are never forwarded
- Malicious upstream tool descriptions and outputs
- SSRF and unsafe upstream URLs
- Cross-user access and authorization
- Audit integrity and sensitive data in logs
- Kubernetes network isolation
- Known residual risks and mitigations

## 8. Optional Features

Do not implement optional features until the mandatory requirements and acceptance tests are complete.

Possible differentiators:

- Multi-store provisioning with namespace isolation and per-store resources
- Per-role or per-user tool permissions
- OAuth
- Tool search for large inventories
- Hosted MCP provisioning
- Stronger SSRF protection
- Least-privilege Kubernetes RBAC
- NetworkPolicies, where supported by the CNI
- Non-root containers
- Encryption for stored upstream credentials
- Gateway replicas and rate limiting
- Improved observability
- Production-like VPS deployment and TLS

Prefer completing one valuable optional feature well over implementing many shallow features. Do not jeopardize mandatory functionality.

## 9. Required Completion Report

After each task, provide a concise report with these headings:

1. **Milestone and status**
   - Current milestone
   - Pass conditions met or not met
   - Any blocker

2. **Files created or modified**
   - Paths and a short description

3. **Design decisions**
   - Important choices and trade-offs
   - Assumptions that remain unverified

4. **Commands and actual results**
   - Exact commands executed
   - Actual test, build, type-check, Helm, and Kubernetes results
   - Failures and how they were handled

5. **Manual steps**
   - Actions requiring the user, credentials, browser interaction, or external services

6. **Known gaps and risks**
   - Incomplete requirements
   - Security concerns
   - Untested behavior

7. **Next step**
   - Exact next task
   - Whether it is safe to proceed

Keep this report concise. Do not repeat the entire assignment after every milestone.

## 10. Definition of Done

A task is complete only when its relevant behavior is implemented, tested to the extent possible, and accurately reported.

A milestone is complete only when its pass conditions have been verified.

The overall assignment is complete only when the mandatory acceptance scenarios pass and the submission package is reproducible.

Correctness, security, explainability, and reproducibility take precedence over breadth, premature optimization, and visual polish.