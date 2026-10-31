import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Server } from "lucide-react";
import {
  EmptyState,
  ErrorState,
  MetricCard,
  OutcomeBadge,
  PageHeader,
  Panel,
  RefreshButton,
  StatusBadge,
  TableSkeleton,
  UpstreamStateBadge,
  findHealth,
} from "@/components/common";
import { useAudit, useLiveness, useReadiness, useUpstreamHealth, useUpstreams } from "@/hooks/use-gateway";
import { formatDuration, formatRelative } from "@/lib/format";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ProbeResult } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gateway Overview — Urumi MCP Gateway" },
      { name: "description", content: "Live health, upstream connectivity and recent tool activity for the Urumi MCP Gateway." },
      { property: "og:title", content: "Gateway Overview — Urumi MCP Gateway" },
      { property: "og:description", content: "Live health, upstream connectivity and recent tool activity." },
    ],
  }),
  component: Overview,
});

function ProbeCard({ label, path, q }: { label: string; path: string; q: UseQueryResult<ProbeResult> }) {
  let badge;
  if (q.isLoading) badge = <StatusBadge tone="neutral" pulse>Loading</StatusBadge>;
  else if (q.isError) badge = <StatusBadge tone="danger">Error</StatusBadge>;
  else if (q.data?.ok) badge = <StatusBadge tone="success">Healthy</StatusBadge>;
  else badge = <StatusBadge tone="danger">Unavailable</StatusBadge>;
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="font-mono text-[11px] text-muted-foreground">
          GET {path}
          {q.data && !q.data.ok && ` · HTTP ${q.data.status}`}
          {q.isError && " · unreachable"}
        </div>
      </div>
      {badge}
    </div>
  );
}

function Overview() {
  const { isAdmin, user } = useAuth();
  const qc = useQueryClient();
  const live = useLiveness();
  const ready = useReadiness();
  const ups = useUpstreams();
  const health = useUpstreamHealth();
  const audit = useAudit();

  const upstreams = ups.data ?? [];
  const enabled = upstreams.filter((u) => u.enabled);
  const reachable = enabled.filter((u) => findHealth(u, health.data)?.reachable).length;
  const unreachable = enabled.filter((u) => {
    const h = findHealth(u, health.data);
    return h && !h.reachable;
  }).length;
  const toolCounts = enabled.map((u) => findHealth(u, health.data)?.toolCount);
  const tools = toolCounts.every((c) => c === undefined) ? undefined : toolCounts.reduce<number>((a, c) => a + (c ?? 0), 0);
  const records = audit.data ?? [];
  const failures = records.filter((r) => r.outcome === "error").length;

  const refreshing = [live, ready, ups, health, audit].some((q) => q.isFetching);

  if (!isAdmin) return (
    <div className="space-y-6">
      <PageHeader title={`Welcome, ${user?.username ?? "member"}`} description="Use AI Chat or create a personal API key to connect an MCP client to every enabled upstream tool." />
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="AI Chat"><p className="text-sm text-muted-foreground">Ask the assistant to use Gateway tools on your behalf. Calls are attributed to your account.</p><Link to="/chat" className="mt-4 inline-flex text-sm text-primary">Open AI Chat <ArrowRight className="ml-1 h-4 w-4" /></Link></Panel>
        <Panel title="Your API keys"><p className="text-sm text-muted-foreground">Generate and revoke your personal client keys. Active keys can discover and execute all enabled tools.</p><Link to="/team" className="mt-4 inline-flex text-sm text-primary">Manage API keys <ArrowRight className="ml-1 h-4 w-4" /></Link></Panel>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gateway Overview"
        description="A concise view of the MCP infrastructure, connectivity, and recent activity."
        actions={
          <RefreshButton
            loading={refreshing}
            onClick={() => {
              ["healthz", "readyz", "upstreams", "audit"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
            }}
          />
        }
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <ProbeCard label="Liveness" path="/healthz" q={live} />
        <ProbeCard label="Readiness" path="/readyz" q={ready} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Registered upstreams" value={upstreams.length} loading={ups.isLoading} />
        <MetricCard label="Enabled" value={enabled.length} loading={ups.isLoading} tone="info" />
        <MetricCard label="Reachable" value={health.isError ? "—" : reachable} loading={ups.isLoading || health.isLoading} tone="success" />
        <MetricCard label="Unreachable" value={health.isError ? "—" : unreachable} loading={ups.isLoading || health.isLoading} tone={unreachable ? "danger" : "neutral"} />
        <MetricCard label="Aggregated tools" value={tools ?? "—"} loading={health.isLoading} hint={tools === undefined && !health.isLoading ? "Not reported" : "Across enabled upstreams"} />
        <MetricCard
          label="Recent tool calls"
          value={audit.isError ? "—" : records.length}
          loading={audit.isLoading}
          hint={audit.data ? `${failures} failed · last ${records.length} records` : undefined}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel
          className="xl:col-span-2"
          title="Upstream health"
          actions={
            <Link to="/servers" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              Manage <ArrowRight className="h-3 w-3" />
            </Link>
          }
        >
          {ups.isLoading ? (
            <TableSkeleton rows={3} cols={3} />
          ) : ups.isError ? (
            <ErrorState error={ups.error} onRetry={() => ups.refetch()} />
          ) : upstreams.length === 0 ? (
            <EmptyState icon={<Server className="h-5 w-5" />} title="No upstreams registered" description="Register an MCP server to start aggregating tools." />
          ) : (
            <ul className="divide-y divide-border">
              {upstreams.map((u) => {
                const h = findHealth(u, health.data);
                return (
                  <li key={u.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{u.name}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {u.enabled && h?.toolCount !== undefined ? `${h.toolCount} tools` : u.enabled ? "Tool count unavailable" : "Tools withheld from clients"}
                      </div>
                      {u.enabled && h && !h.reachable && h.error && (
                        <div className="mt-1 truncate font-mono text-[11px] text-danger" title={h.error}>{h.error}</div>
                      )}
                    </div>
                    <UpstreamStateBadge upstream={u} health={h} loading={health.isLoading} />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          className="xl:col-span-3"
          title="Recent activity"
          actions={
            <Link to="/audit" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              Audit logs <ArrowRight className="h-3 w-3" />
            </Link>
          }
        >
          {audit.isLoading ? (
            <TableSkeleton rows={5} cols={4} />
          ) : audit.isError ? (
            <ErrorState error={audit.error} onRetry={() => audit.refetch()} />
          ) : records.length === 0 ? (
            <EmptyState title="No tool calls recorded yet" description="Calls made through the Gateway or AI Chat will appear here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 font-medium">Tool</th>
                    <th className="px-4 py-2 font-medium">User</th>
                    <th className="px-4 py-2 font-medium">Outcome</th>
                    <th className="px-4 py-2 text-right font-medium">Duration</th>
                    <th className="px-4 py-2 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {records.slice(0, 8).map((r) => (
                    <tr key={r.id} className={r.outcome === "error" ? "border-b border-border bg-danger/5" : "border-b border-border last:border-0"}>
                      <td className="px-4 py-2">
                        <div className="font-mono text-xs">{r.tool ?? "—"}</div>
                        <div className="text-[11px] text-muted-foreground">{r.upstream ?? "—"}</div>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{r.userId ?? "—"}</td>
                      <td className="px-4 py-2"><OutcomeBadge outcome={r.outcome} label={r.errorCode ?? r.outcomeLabel} /></td>
                      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">{formatDuration(r.durationMs)}</td>
                      <td className="px-4 py-2 text-right text-xs text-muted-foreground" title={r.timestamp}>{formatRelative(r.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
