import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Info, MoreHorizontal, Pencil, Plus, Power, Server, Trash2 } from "lucide-react";
import {
  ConfirmDialog,
  CopyButton,
  EmptyState,
  ErrorState,
  FieldError,
  PageHeader,
  Panel,
  RefreshButton,
  StatusBadge,
  TableSkeleton,
  UpstreamStateBadge,
  findHealth,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { qk, useUpstreamHealth, useUpstreams } from "@/hooks/use-gateway";
import { api, errorMessage } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { formatDuration, formatTime } from "@/lib/format";
import type { Upstream, UpstreamHealth } from "@/lib/types";

export const Route = createFileRoute("/servers")({
  head: () => ({
    meta: [
      { title: "MCP Servers — Urumi MCP Gateway" },
      { name: "description", content: "Register, configure and monitor upstream MCP servers behind the Gateway." },
      { property: "og:title", content: "MCP Servers — Urumi MCP Gateway" },
      { property: "og:description", content: "Register, configure and monitor upstream MCP servers." },
    ],
  }),
  component: ServersPage,
});

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(64, "Max 64 characters"),
  url: z
    .string()
    .trim()
    .url("Enter a valid URL, e.g. http://inventory-mcp:8080/mcp")
    .refine((v) => /^https?:\/\//.test(v), "URL must use http or https"),
  timeoutMs: z.coerce.number().int("Whole milliseconds").min(500, "At least 500 ms").max(120_000, "At most 120000 ms"),
  enabled: z.boolean(),
  credential: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;
type FormInput = z.input<typeof schema>;

function useInvalidateUpstreams() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.upstreams });
    qc.invalidateQueries({ queryKey: qk.status });
  };
}

function ServerForm({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing: Upstream | null }) {
  const invalidate = useInvalidateUpstreams();
  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", url: "", timeoutMs: 10000, enabled: true, credential: "" },
  });
  useEffect(() => {
    if (open) {
      form.reset(
        editing
          ? { name: editing.name, url: editing.url, timeoutMs: editing.timeoutMs ?? 10000, enabled: editing.enabled, credential: "" }
          : { name: "", url: "", timeoutMs: 10000, enabled: true, credential: "" },
      );
    }
  }, [open, editing, form]);

  const m = useMutation({
    mutationFn: (v: FormValues) => (editing ? api.updateUpstream(editing.id, v) : api.createUpstream(v)),
    onSuccess: (_d, v) => {
      toast.success(editing ? `Saved ${v.name}` : `Registered ${v.name}`, {
        description: editing ? undefined : "Registration succeeded. Check the health column to confirm connectivity.",
      });
      invalidate();
      onOpenChange(false);
    },
    onError: (e) => toast.error(editing ? "Update failed" : "Registration failed", { description: errorMessage(e) }),
  });

  const { register, handleSubmit, formState, watch, setValue } = form;
  return (
    <Dialog open={open} onOpenChange={(o) => !m.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.name}` : "Register MCP server"}</DialogTitle>
          <DialogDescription>
            {editing ? "Update the upstream configuration." : "Add a Streamable HTTP MCP endpoint. Its tools are aggregated once the Gateway can reach it."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => m.mutate(v))} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="name">Server name</Label>
            <Input id="name" placeholder="inventory" {...register("name")} aria-invalid={!!formState.errors.name} />
            <FieldError message={formState.errors.name?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="url">Streamable HTTP endpoint</Label>
            <Input id="url" className="font-mono text-sm" placeholder="http://inventory-mcp:8080/mcp" {...register("url")} aria-invalid={!!formState.errors.url} />
            <FieldError message={formState.errors.url?.message} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="timeoutMs">Timeout (ms)</Label>
              <Input id="timeoutMs" type="number" inputMode="numeric" className="font-mono" {...register("timeoutMs")} aria-invalid={!!formState.errors.timeoutMs} />
              <FieldError message={formState.errors.timeoutMs?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="enabled">Enabled</Label>
              <div className="flex h-9 items-center gap-2">
                <Switch id="enabled" checked={watch("enabled")} onCheckedChange={(c) => setValue("enabled", c)} />
                <span className="text-xs text-muted-foreground">{watch("enabled") ? "Tools exposed" : "Tools hidden"}</span>
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="credential">Static credential <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="credential" type="password" autoComplete="new-password" className="font-mono" placeholder={editing ? "Leave blank to keep current credential" : "Bearer token for the upstream"} {...register("credential")} />
            <p className="text-xs text-muted-foreground">
              {editing
                ? "Stored credentials are never shown. Entering a value replaces it; leaving blank keeps it unchanged."
                : "Sent once to the Gateway and stored server-side. It is never returned to the browser."}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={m.isPending}>Cancel</Button>
            <Button type="submit" disabled={m.isPending}>{m.isPending ? "Saving…" : editing ? "Save changes" : "Register server"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DetailSheet({ upstream, health, healthLoading, onClose }: { upstream: Upstream | null; health?: UpstreamHealth | undefined; healthLoading: boolean; onClose: () => void }) {
  return (
    <Sheet open={!!upstream} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {upstream && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">{upstream.name} <UpstreamStateBadge upstream={upstream} health={health} loading={healthLoading} /></SheetTitle>
              <SheetDescription>Configuration and last health-check result reported by the Gateway.</SheetDescription>
            </SheetHeader>
            <dl className="mt-6 grid grid-cols-3 gap-y-3 px-4 text-sm">
              <dt className="text-muted-foreground">Endpoint</dt>
              <dd className="col-span-2 flex items-center gap-1 break-all font-mono text-xs">{upstream.url}<CopyButton value={upstream.url} label="Copy endpoint" /></dd>
              <dt className="text-muted-foreground">ID</dt>
              <dd className="col-span-2 font-mono text-xs">{upstream.id}</dd>
              <dt className="text-muted-foreground">Enabled</dt>
              <dd className="col-span-2">{upstream.enabled ? "Yes" : "No"}</dd>
              <dt className="text-muted-foreground">Timeout</dt>
              <dd className="col-span-2 font-mono text-xs">{formatDuration(upstream.timeoutMs)}</dd>
              {health?.latencyMs !== undefined && (<><dt className="text-muted-foreground">Check latency</dt><dd className="col-span-2 font-mono text-xs">{formatDuration(health.latencyMs)}</dd></>)}
              {health?.checkedAt && (<><dt className="text-muted-foreground">Last checked</dt><dd className="col-span-2 text-xs">{formatTime(health.checkedAt)}</dd></>)}
            </dl>
            {health?.error && (
              <div className="mx-4 mt-4 rounded-md border border-danger/30 bg-danger/10 p-3 font-mono text-xs text-danger">{health.error}</div>
            )}
            <div className="mt-6 px-4 pb-6">
              <h3 className="mb-2 text-sm font-medium">Discovered tools {health?.tools && <span className="text-muted-foreground">({health.tools.length})</span>}</h3>
              {!upstream.enabled ? (
                <p className="text-xs text-muted-foreground">Server is disabled; its tools are not exposed.</p>
              ) : !health?.tools ? (
                <p className="text-xs text-muted-foreground">
                  {health?.toolCount !== undefined ? `${health.toolCount} tools reported. ` : ""}The health endpoint did not return individual tool names.
                </p>
              ) : health.tools.length === 0 ? (
                <p className="text-xs text-muted-foreground">No tools discovered.</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {health.tools.map((t) => (
                    <li key={t.name} className="px-3 py-2">
                      <div className="font-mono text-xs">{t.name}</div>
                      {t.description && <div className="mt-0.5 text-xs text-muted-foreground">{t.description}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ServersPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const ups = useUpstreams();
  const health = useUpstreamHealth();
  const invalidate = useInvalidateUpstreams();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Upstream | null>(null);
  const [detail, setDetail] = useState<Upstream | null>(null);
  const [toDisable, setToDisable] = useState<Upstream | null>(null);
  const [toDelete, setToDelete] = useState<Upstream | null>(null);

  const toggle = useMutation({
    mutationFn: (u: Upstream) => api.updateUpstream(u.id, { enabled: !u.enabled }),
    onSuccess: (_d, u) => {
      toast.success(`${u.name} ${u.enabled ? "disabled" : "enabled"}`);
      invalidate();
      setToDisable(null);
    },
    onError: (e) => toast.error("Could not change state", { description: errorMessage(e) }),
  });
  const remove = useMutation({
    mutationFn: (u: Upstream) => api.deleteUpstream(u.id),
    onSuccess: (_d, u) => {
      toast.success(`Removed ${u.name}`);
      invalidate();
      setToDelete(null);
    },
    onError: (e) => toast.error("Could not remove server", { description: errorMessage(e) }),
  });

  const list = ups.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader
        title="MCP Servers"
        description="Upstream MCP servers whose tools the Gateway aggregates behind one authenticated endpoint."
        actions={
          <>
            <RefreshButton label="Refresh health" loading={health.isFetching} onClick={() => qc.invalidateQueries({ queryKey: qk.health })} />
            {isAdmin && (
              <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
                <Plus className="h-3.5 w-3.5" /> Add server
              </Button>
            )}
          </>
        }
      />
      {health.isError && !ups.isError && (
        <div role="alert" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Health check failed: {errorMessage(health.error)} Reachability shown below may be incomplete.
        </div>
      )}
      <Panel>
        {ups.isLoading ? (
          <TableSkeleton rows={4} cols={6} />
        ) : ups.isError ? (
          <ErrorState error={ups.error} onRetry={() => ups.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Server className="h-5 w-5" />}
            title="No MCP servers registered"
            description="Register a Streamable HTTP MCP endpoint — e.g. WooCommerce, Inventory or Support — to expose its tools through the Gateway."
            action={isAdmin && <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="h-3.5 w-3.5" /> Add server</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 font-medium">Server</th>
                  <th className="px-4 py-2.5 font-medium">Endpoint</th>
                  <th className="px-4 py-2.5 font-medium">Enabled</th>
                  <th className="px-4 py-2.5 font-medium">Health</th>
                  <th className="px-4 py-2.5 text-right font-medium">Tools</th>
                  <th className="px-4 py-2.5 text-right font-medium">Timeout</th>
                  <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {list.map((u) => {
                  const h = findHealth(u, health.data);
                  return (
                    <tr key={u.id} className="border-b border-border last:border-0 hover:bg-accent/30">
                      <td className="px-4 py-2.5">
                        <button className="text-left font-medium hover:text-primary" onClick={() => setDetail(u)}>{u.name}</button>
                      </td>
                      <td className="max-w-[260px] px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <span className="truncate font-mono text-xs text-muted-foreground" title={u.url}>{u.url}</span>
                          <CopyButton value={u.url} label={`Copy ${u.name} endpoint`} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Switch
                          checked={u.enabled}
                          disabled={!isAdmin || toggle.isPending}
                          aria-label={`${u.enabled ? "Disable" : "Enable"} ${u.name}`}
                          onCheckedChange={() => (u.enabled ? setToDisable(u) : toggle.mutate(u))}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <UpstreamStateBadge upstream={u} health={h} loading={health.isLoading} />
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{u.enabled && h?.toolCount !== undefined ? h.toolCount : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{formatDuration(u.timeoutMs)}</td>
                      <td className="px-2 py-2.5 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Actions for ${u.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setDetail(u)}><Info className="h-3.5 w-3.5" /> Details</DropdownMenuItem>
                            {isAdmin && (
                              <>
                                <DropdownMenuItem onSelect={() => { setEditing(u); setFormOpen(true); }}><Pencil className="h-3.5 w-3.5" /> Edit</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => (u.enabled ? setToDisable(u) : toggle.mutate(u))}><Power className="h-3.5 w-3.5" /> {u.enabled ? "Disable" : "Enable"}</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-danger focus:text-danger" onSelect={() => setToDelete(u)}><Trash2 className="h-3.5 w-3.5" /> Remove</DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {!isAdmin && <p className="text-xs text-muted-foreground"><StatusBadge tone="neutral">member</StatusBadge> Server management requires the admin role.</p>}

      <ServerForm open={formOpen} onOpenChange={setFormOpen} editing={editing} />
      <DetailSheet upstream={detail} health={detail ? findHealth(detail, health.data) : undefined} healthLoading={health.isLoading} onClose={() => setDetail(null)} />
      <ConfirmDialog
        open={!!toDisable}
        onOpenChange={(o) => !o && setToDisable(null)}
        title={`Disable ${toDisable?.name}?`}
        description="Its tools will be removed from MCP clients and the AI Chat until it is re-enabled. The registration is kept."
        confirmLabel="Disable server"
        loading={toggle.isPending}
        onConfirm={() => toDisable && toggle.mutate(toDisable)}
      />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Remove ${toDelete?.name}?`}
        description={<>This deletes the registration for <span className="font-mono text-foreground">{toDelete?.url}</span> and its stored credential. Clients lose access to its tools immediately. This cannot be undone.</>}
        confirmLabel="Remove server"
        destructive
        loading={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
      />
    </div>
  );
}
