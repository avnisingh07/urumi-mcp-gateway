import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { EmptyState, ErrorState, OutcomeBadge, PageHeader, Panel, RefreshButton, TableSkeleton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAudit } from "@/hooks/use-gateway";
import { formatDuration, formatTime } from "@/lib/format";
import type { AuditRecord } from "@/lib/types";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit Logs — Urumi MCP Gateway" },
      { name: "description", content: "Inspect every tool call routed through the Gateway: who, what, when and outcome." },
      { property: "og:title", content: "Audit Logs — Urumi MCP Gateway" },
      { property: "og:description", content: "Inspect every tool call routed through the Gateway." },
    ],
  }),
  component: AuditPage,
});

const RANGES = { all: 0, "15m": 15 * 60e3, "1h": 60 * 60e3, "24h": 24 * 60 * 60e3 } as const;
type RangeKey = keyof typeof RANGES;

function AuditPage() {
  const audit = useAudit();
  const [q, setQ] = useState("");
  const [upstream, setUpstream] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [range, setRange] = useState<RangeKey>("all");
  const [sel, setSel] = useState<AuditRecord | null>(null);

  const records = audit.data ?? [];
  const upstreams = useMemo(() => [...new Set(records.map((r) => r.upstream).filter(Boolean))] as string[], [records]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const cutoff = RANGES[range] ? Date.now() - RANGES[range] : 0;
    return records.filter((r) => {
      if (upstream !== "all" && r.upstream !== upstream) return false;
      if (outcome !== "all" && r.outcome !== outcome) return false;
      if (cutoff && (!r.timestamp || new Date(r.timestamp).getTime() < cutoff)) return false;
      if (needle && ![r.userId, r.upstream, r.tool].some((v) => v?.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [records, q, upstream, outcome, range]);
  const active = [q && `“${q}”`, upstream !== "all" && upstream, outcome !== "all" && outcome, range !== "all" && `last ${range}`].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Logs"
        description="The most recent 100 tool calls recorded by the Gateway. Filters apply locally to these records."
        actions={<RefreshButton loading={audit.isFetching} onClick={() => audit.refetch()} />}
      />
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search user, server or tool" className="pl-8" aria-label="Search audit records" />
        </div>
        <div className="grid grid-cols-3 gap-2 md:flex">
          <Select value={upstream} onValueChange={setUpstream}>
            <SelectTrigger className="md:w-40" aria-label="Filter by server"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All servers</SelectItem>
              {upstreams.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={outcome} onValueChange={setOutcome}>
            <SelectTrigger className="md:w-36" aria-label="Filter by outcome"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All outcomes</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
            <SelectTrigger className="md:w-32" aria-label="Filter by time range"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any time</SelectItem>
              <SelectItem value="15m">Last 15 min</SelectItem>
              <SelectItem value="1h">Last hour</SelectItem>
              <SelectItem value="24h">Last 24 h</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        Showing <span className="font-mono text-foreground">{filtered.length}</span> of <span className="font-mono">{records.length}</span> records
        {active.length > 0 && (
          <>
            <span>· filtered by {active.join(", ")}</span>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => { setQ(""); setUpstream("all"); setOutcome("all"); setRange("all"); }}>
              <X className="h-3 w-3" /> Clear
            </Button>
          </>
        )}
      </div>
      <Panel>
        {audit.isLoading ? (
          <TableSkeleton rows={8} cols={7} />
        ) : audit.isError ? (
          <ErrorState error={audit.error} onRetry={() => audit.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState title={records.length ? "No records match these filters" : "No audit records yet"} description={records.length ? "Adjust or clear the filters." : "Tool calls through the Gateway will be recorded here."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 font-medium">Timestamp</th>
                  <th className="px-4 py-2.5 font-medium">User</th>
                  <th className="px-4 py-2.5 font-medium">Server</th>
                  <th className="px-4 py-2.5 font-medium">Tool</th>
                  <th className="px-4 py-2.5 text-right font-medium">Duration</th>
                  <th className="px-4 py-2.5 font-medium">Outcome</th>
                  <th className="px-4 py-2.5 font-medium">Error code</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => setSel(r)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSel(r))}
                    className={`cursor-pointer border-b border-border last:border-0 hover:bg-accent/40 focus-visible:bg-accent/40 ${r.outcome === "error" ? "bg-danger/5" : ""}`}
                  >
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-muted-foreground">{formatTime(r.timestamp)}</td>
                    <td className="px-4 py-2 font-mono text-xs">{r.userId ?? "—"}</td>
                    <td className="px-4 py-2 text-xs">{r.upstream ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{r.tool ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">{formatDuration(r.durationMs)}</td>
                    <td className="px-4 py-2"><OutcomeBadge outcome={r.outcome} label={r.outcomeLabel} /></td>
                    <td className="px-4 py-2 font-mono text-xs text-danger">{r.errorCode ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Sheet open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <SheetContent className="w-full sm:max-w-md">
          {sel && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-base">{sel.tool ?? "Tool call"}</SheetTitle>
                <SheetDescription>Audit record as returned by the Gateway. Arguments and credentials are not shown.</SheetDescription>
              </SheetHeader>
              <dl className="mt-4 grid grid-cols-3 gap-y-3 px-4 text-sm">
                {([
                  ["Record ID", sel.id.startsWith("row-") ? undefined : sel.id],
                  ["Timestamp", sel.timestamp && formatTime(sel.timestamp)],
                  ["User ID", sel.userId],
                  ["Server", sel.upstream],
                  ["Tool", sel.tool],
                  ["Duration", sel.durationMs !== undefined ? formatDuration(sel.durationMs) : undefined],
                  ["Error code", sel.errorCode],
                ] as const).filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="col-span-2 break-all font-mono text-xs">{v}</dd>
                  </div>
                ))}
                <dt className="text-muted-foreground">Outcome</dt>
                <dd className="col-span-2"><OutcomeBadge outcome={sel.outcome} label={sel.outcomeLabel} /></dd>
              </dl>
              {sel.errorMessage && (
                <div className="mx-4 mt-4 rounded-md border border-danger/30 bg-danger/10 p-3 font-mono text-xs text-danger">{sel.errorMessage}</div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
