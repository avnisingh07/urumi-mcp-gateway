import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AlertTriangle, Eye, EyeOff, KeyRound, Trash2, UserPlus, Users } from "lucide-react";
import { ConfirmDialog, CopyButton, EmptyState, ErrorState, FieldError, PageHeader, Panel, RefreshButton, StatusBadge, TableSkeleton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { qk, useMyKeys, useUsers } from "@/hooks/use-gateway";
import { api, errorMessage } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { formatTime } from "@/lib/format";
import type { ApiKeyMeta, IssuedKey, Role, TeamUser } from "@/lib/types";

export const Route = createFileRoute("/team")({
  head: () => ({
    meta: [
      { title: "Team & API Keys — Urumi MCP Gateway" },
      { name: "description", content: "Manage Gateway members, roles and API key issuance." },
      { property: "og:title", content: "Team & API Keys — Urumi MCP Gateway" },
      { property: "og:description", content: "Manage Gateway members, roles and API key issuance." },
    ],
  }),
  component: TeamPage,
});

const userSchema = z.object({
  username: z.string().trim().min(1, "Username is required").max(64, "Max 64 characters").regex(/^[a-zA-Z0-9._-]+$/, "Letters, numbers, . _ - only"),
  role: z.enum(["admin", "member"]),
});
type UserValues = z.infer<typeof userSchema>;

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const form = useForm<UserValues>({ resolver: zodResolver(userSchema), defaultValues: { username: "", role: "member" } });
  const m = useMutation({
    mutationFn: (v: UserValues) => api.createUser(v),
    onSuccess: (_d, v) => {
      toast.success(`Created ${v.username}`, { description: "Issue an API key so they can authenticate." });
      qc.invalidateQueries({ queryKey: qk.users });
      form.reset();
      onOpenChange(false);
    },
    onError: (e) => toast.error("Could not create member", { description: errorMessage(e) }),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !m.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add team member</DialogTitle>
          <DialogDescription>Members can use tools and chat. Admins can also manage servers and the team.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="username">Username</Label>
            <Input id="username" autoComplete="off" placeholder="jane.doe" {...form.register("username")} aria-invalid={!!form.formState.errors.username} />
            <FieldError message={form.formState.errors.username?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role">Role</Label>
            <Select value={form.watch("role")} onValueChange={(v) => form.setValue("role", v as Role)}>
              <SelectTrigger id="role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={m.isPending}>Cancel</Button>
            <Button type="submit" disabled={m.isPending}>{m.isPending ? "Creating…" : "Create member"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IssuedKeyDialog({ issued, user, onClose }: { issued: IssuedKey | null; user: TeamUser | null; onClose: () => void }) {
  const [reveal, setReveal] = useState(false);
  return (
    <Dialog open={!!issued} onOpenChange={(o) => { if (!o) { setReveal(false); onClose(); } }}>
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>API key issued for {user?.username}</DialogTitle>
          <DialogDescription>Copy it now and share it through a secure channel.</DialogDescription>
        </DialogHeader>
        {issued?.rawKey ? (
          <>
            <div className="flex items-center gap-1 rounded-md border border-border bg-muted px-3 py-2">
              <code className="flex-1 break-all font-mono text-xs">{reveal ? issued.rawKey : "•".repeat(Math.min(issued.rawKey.length, 40))}</code>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setReveal((r) => !r)} aria-label={reveal ? "Hide key" : "Reveal key"}>
                {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
              <CopyButton value={issued.rawKey} label="Copy API key" />
            </div>
            <div className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              This key grants Gateway access as {user?.username}. It is shown once and won't be recoverable after you close this panel.
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">The Gateway confirmed issuance but did not return a raw key in the response.</p>
        )}
        <DialogFooter>
          <Button onClick={() => { setReveal(false); onClose(); }}>I've stored it securely</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamPage() {
  const qc = useQueryClient();
  const { isAdmin, user: me } = useAuth();
  const users = useUsers();
  const myKeys = useMyKeys();
  const [createOpen, setCreateOpen] = useState(false);
  const [issueFor, setIssueFor] = useState<TeamUser | null>(null);
  const [issued, setIssued] = useState<{ key: IssuedKey; user: TeamUser } | null>(null);
  const [revoke, setRevoke] = useState<{ key: ApiKeyMeta; user: TeamUser } | null>(null);
  const [revokeOwnKey, setRevokeOwnKey] = useState<ApiKeyMeta | null>(null);

  const issue = useMutation({
    mutationFn: (u: TeamUser) => api.issueKey(u.id),
    onSuccess: (key, u) => {
      setIssueFor(null);
      setIssued({ key, user: u });
      qc.invalidateQueries({ queryKey: qk.users });
    },
    onError: (e) => toast.error("Could not issue key", { description: errorMessage(e) }),
  });
  const revokeM = useMutation({
    mutationFn: (k: ApiKeyMeta) => api.revokeKey(k.id),
    onSuccess: () => {
      toast.success("Key revoked");
      setRevoke(null);
      qc.invalidateQueries({ queryKey: qk.users });
    },
    onError: (e) => toast.error("Could not revoke key", { description: errorMessage(e) }),
  });

  const issueOwn = useMutation({
    mutationFn: api.issueMyKey,
    onSuccess: (key) => {
      if (me) setIssued({ key, user: { id: me.id, username: me.username, role: me.role, keys: [] } });
      qc.invalidateQueries({ queryKey: qk.myKeys });
    },
    onError: (e) => toast.error("Could not issue key", { description: errorMessage(e) }),
  });
  const revokeOwn = useMutation({
    mutationFn: (key: ApiKeyMeta) => api.revokeMyKey(key.id),
    onSuccess: () => { toast.success("Key revoked"); setRevokeOwnKey(null); qc.invalidateQueries({ queryKey: qk.myKeys }); },
    onError: (e) => toast.error("Could not revoke key", { description: errorMessage(e) }),
  });

  if (!isAdmin) return (
    <div className="space-y-6">
      <PageHeader title="My API Keys" description="Create and manage only the API keys associated with your account. Each active key can discover and use every enabled Gateway tool." actions={<Button size="sm" onClick={() => issueOwn.mutate()} disabled={issueOwn.isPending}><KeyRound className="h-3.5 w-3.5" /> {issueOwn.isPending ? "Creating…" : "Generate key"}</Button>} />
      <Panel title="Your keys">
        {myKeys.isLoading ? <TableSkeleton rows={3} cols={3} /> : myKeys.isError ? <ErrorState error={myKeys.error} onRetry={() => myKeys.refetch()} /> : !myKeys.data?.length ? <EmptyState icon={<KeyRound className="h-5 w-5" />} title="No API keys yet" description="Generate a key to use the Gateway from MCP Inspector, Claude Code, or Cursor." /> : (
          <div className="divide-y divide-border">{myKeys.data.map((key) => <div key={key.id} className="flex items-center gap-3 px-4 py-3"><div className="min-w-0 flex-1"><div className="font-mono text-xs">{key.id}</div><div className="mt-1 text-[11px] text-muted-foreground">Created {formatTime(key.createdAt)}</div></div>{key.revoked ? <StatusBadge tone="neutral">revoked</StatusBadge> : <><StatusBadge tone="success">active</StatusBadge><Button variant="ghost" size="sm" className="text-danger" disabled={revokeOwn.isPending} onClick={() => setRevokeOwnKey(key)}><Trash2 className="h-3.5 w-3.5" /> Revoke</Button></>}</div>)}</div>
        )}
      </Panel>
      <IssuedKeyDialog issued={issued?.key ?? null} user={issued?.user ?? null} onClose={() => setIssued(null)} />
      <ConfirmDialog
        open={!!revokeOwnKey}
        onOpenChange={(o) => !o && setRevokeOwnKey(null)}
        title="Revoke your API key?"
        description={<>Future requests using <span className="font-mono text-foreground">{revokeOwnKey?.label ?? revokeOwnKey?.id}</span> will be rejected. Any client configured with this key will lose access.</>}
        confirmLabel="Revoke key"
        destructive
        loading={revokeOwn.isPending}
        onConfirm={() => revokeOwnKey && revokeOwn.mutate(revokeOwnKey)}
      />
    </div>
  );

  const list = users.data ?? [];
  const keysExposed = list.some((u) => u.keys !== undefined);
  const hasCreated = list.some((u) => u.createdAt);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team & API Keys"
        description="Members who can access the Gateway, their roles, and the API keys that authenticate them."
        actions={
          <>
            <RefreshButton loading={users.isFetching} onClick={() => users.refetch()} />
            {isAdmin && <Button size="sm" onClick={() => setCreateOpen(true)}><UserPlus className="h-3.5 w-3.5" /> Add member</Button>}
          </>
        }
      />
      <Panel>
        {users.isLoading ? (
          <TableSkeleton rows={4} cols={4} />
        ) : users.isError ? (
          <ErrorState error={users.error} onRetry={() => users.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState icon={<Users className="h-5 w-5" />} title="No members yet" action={isAdmin && <Button size="sm" onClick={() => setCreateOpen(true)}><UserPlus className="h-3.5 w-3.5" /> Add member</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 font-medium">Member</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 font-medium">User ID</th>
                  {hasCreated && <th className="px-4 py-2.5 font-medium">Created</th>}
                  {keysExposed && <th className="px-4 py-2.5 font-medium">Keys</th>}
                  <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id} className="border-b border-border align-top last:border-0">
                    <td className="px-4 py-2.5 font-medium">
                      {u.username}
                      {me?.id === u.id && <span className="ml-2 text-[11px] text-muted-foreground">(you)</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {u.role ? <StatusBadge tone={u.role === "admin" ? "info" : "neutral"}>{u.role}</StatusBadge> : "—"}
                    </td>
                    <td className="px-4 py-2.5"><span className="font-mono text-xs text-muted-foreground">{u.id}</span></td>
                    {hasCreated && <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatTime(u.createdAt)}</td>}
                    {keysExposed && (
                      <td className="px-4 py-2.5">
                        {u.keys?.length ? (
                          <ul className="space-y-1">
                            {u.keys.map((k) => (
                              <li key={k.id} className="flex items-center gap-2">
                                <span className="font-mono text-xs">{k.label ?? k.id}</span>
                                {k.revoked ? <StatusBadge tone="neutral">revoked</StatusBadge> : isAdmin && (
                                  <Button variant="ghost" size="icon" className="h-6 w-6 text-danger" aria-label={`Revoke key ${k.label ?? k.id}`} onClick={() => setRevoke({ key: k, user: u })}>
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : <span className="text-xs text-muted-foreground">None</span>}
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-right">
                      {isAdmin && (
                        <Button variant="outline" size="sm" onClick={() => setIssueFor(u)}>
                          <KeyRound className="h-3.5 w-3.5" /> Issue key
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {users.data && !keysExposed && (
        <p className="text-xs text-muted-foreground">
          The Gateway does not list existing API keys, so per-key revocation isn't available from this view. Keys can be revoked by ID via <span className="font-mono">DELETE /api/keys/:id</span> when the ID is known.
        </p>
      )}

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ConfirmDialog
        open={!!issueFor}
        onOpenChange={(o) => !o && setIssueFor(null)}
        title={`Issue an API key for ${issueFor?.username}?`}
        description="A new key will be created. The raw value is shown once, immediately after issuance."
        confirmLabel="Issue key"
        loading={issue.isPending}
        onConfirm={() => issueFor && issue.mutate(issueFor)}
      />
      <IssuedKeyDialog issued={issued?.key ?? null} user={issued?.user ?? null} onClose={() => setIssued(null)} />
      <ConfirmDialog
        open={!!revoke}
        onOpenChange={(o) => !o && setRevoke(null)}
        title="Revoke API key?"
        description={<>Future requests using <span className="font-mono text-foreground">{revoke?.key.label ?? revoke?.key.id}</span> ({revoke?.user.username}) will be rejected.</>}
        confirmLabel="Revoke key"
        destructive
        loading={revokeM.isPending}
        onConfirm={() => revoke && revokeM.mutate(revoke.key)}
      />
    </div>
  );
}
