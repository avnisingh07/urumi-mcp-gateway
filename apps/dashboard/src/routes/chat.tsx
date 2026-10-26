import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Bot, ChevronRight, Loader2, RotateCcw, User, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Panel, StatusBadge } from "@/components/common";
import { api, errorMessage } from "@/lib/api-client";
import { useAuth, type ChatTurn } from "@/lib/auth";
import { qk } from "@/hooks/use-gateway";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ToolTrace } from "@/lib/types";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "AI Chat — Urumi MCP Gateway" },
      { name: "description", content: "Chat with an assistant that uses tools exposed through the MCP Gateway." },
      { property: "og:title", content: "AI Chat — Urumi MCP Gateway" },
      { property: "og:description", content: "Chat with an assistant that uses Gateway tools." },
    ],
  }),
  component: ChatPage,
});

const EXAMPLES = [
  "List the available products.",
  "Show the latest orders.",
  "Check inventory for a product.",
  "Summarize the support status for an order.",
];

let seq = 0;
const nextId = () => `t${++seq}-${Date.now()}`;

function TraceCard({ t, defaultOpen }: { t: ToolTrace; defaultOpen?: boolean | undefined }) {
  return (
    <Collapsible defaultOpen={defaultOpen ?? false} className="rounded-md border border-border bg-background">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        <Wrench className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="truncate font-mono text-xs">{t.tool}</span>
        {t.upstream && <span className="truncate text-[11px] text-muted-foreground">· {t.upstream}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {t.durationMs !== undefined && <span className="font-mono text-[11px] text-muted-foreground">{formatDuration(t.durationMs)}</span>}
          <StatusBadge tone={t.status === "success" ? "success" : t.status === "error" ? "danger" : "neutral"}>{t.status}</StatusBadge>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="max-h-64 overflow-auto border-t border-border px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {t.summary ?? "No result payload returned."}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Message({ m }: { m: ChatTurn }) {
  const user = m.role === "user";
  return (
    <div className={cn("flex gap-3", user && "flex-row-reverse")}>
      <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", user ? "bg-secondary" : "bg-primary/15 text-primary")}>
        {user ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={cn("min-w-0 max-w-[85%] space-y-2", user && "items-end text-right")}>
        {m.traces && m.traces.length > 0 && (
          <div className="space-y-1.5 text-left">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{m.traces.length} tool call{m.traces.length > 1 ? "s" : ""}</div>
            {m.traces.map((t, i) => <TraceCard key={i} t={t} />)}
          </div>
        )}
        <div
          className={cn(
            "inline-block rounded-lg px-3.5 py-2.5 text-left text-sm leading-relaxed whitespace-pre-wrap",
            user ? "bg-primary text-primary-foreground" : m.error ? "border border-danger/30 bg-danger/10 text-danger" : "border border-border bg-card",
          )}
        >
          {m.content}
        </div>
      </div>
    </div>
  );
}

function ChatPage() {
  const qc = useQueryClient();
  const { chat, setChat } = useAuth();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const send = useMutation({
    mutationFn: (history: ChatTurn[]) =>
      api.chat(history.filter((t) => !t.error).map(({ role, content }) => ({ role, content }))),
    onSuccess: (res) => {
      setChat((c) => [...c, { id: nextId(), role: "assistant", content: res.reply || "(empty response)", traces: res.traces }]);
      qc.invalidateQueries({ queryKey: qk.audit });
    },
    onError: (e, history) => {
      // Restore draft so the user can retry without retyping.
      const last = history[history.length - 1];
      if (!last) return;
      setChat((c) => [...c.filter((t) => t.id !== last.id), { id: nextId(), role: "assistant", content: errorMessage(e), error: true }]);
      setDraft(last.content);
    },
  });

  useEffect(() => {
    // Effects must return only a cleanup function. Do not return the browser's
    // scrollIntoView result: implementations may return a non-void value.
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.length, send.isPending]);

  function submit(text = draft) {
    const content = text.trim();
    if (!content || send.isPending) return;
    const turn: ChatTurn = { id: nextId(), role: "user", content };
    const history = [...chat.filter((t) => !t.error), turn];
    setChat((c) => [...c.filter((t) => !t.error), turn]);
    setDraft("");
    send.mutate(history);
  }

  const allTraces = chat.flatMap((t) => t.traces ?? []);

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-7.5rem)]">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">AI Chat</h1>
          <p className="mt-1 text-sm text-muted-foreground">An assistant that calls tools through the Gateway on your behalf. Session-only history.</p>
        </div>
        <Button variant="outline" size="sm" disabled={!chat.length || send.isPending} onClick={() => { setChat([]); send.reset(); }}>
          <RotateCcw className="h-3.5 w-3.5" /> New conversation
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_340px]">
        <section className="flex min-h-[60vh] flex-col rounded-lg border border-border bg-card/40 lg:min-h-0">
          <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6" aria-live="polite">
            {chat.length === 0 ? (
              <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center py-10 text-center">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15 text-primary"><Bot className="h-5 w-5" /></div>
                <h2 className="text-base font-semibold">Ask about your store, inventory or support</h2>
                <p className="mt-1 text-sm text-muted-foreground">The assistant can only use tools from enabled, reachable MCP servers. Every call is authenticated and audited.</p>
                <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                  {EXAMPLES.map((e) => (
                    <button key={e} onClick={() => submit(e)} className="rounded-md border border-border bg-card px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              chat.map((m) => <Message key={m.id} m={m} />)
            )}
            {send.isPending && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary"><Loader2 className="h-3.5 w-3.5 animate-spin" /></div>
                Working — the assistant may be calling tools…
              </div>
            )}
            <div ref={endRef} />
          </div>
          <form
            className="border-t border-border p-3"
            onSubmit={(e) => { e.preventDefault(); submit(); }}
          >
            <div className="flex items-end gap-2 rounded-lg border border-input bg-background p-2 focus-within:ring-2 focus-within:ring-ring/50">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
                placeholder="Message the assistant… (Enter to send, Shift+Enter for a new line)"
                aria-label="Message"
                rows={1}
                className="max-h-40 min-h-9 resize-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              />
              <Button type="submit" size="icon" className="h-8 w-8 shrink-0" disabled={!draft.trim() || send.isPending} aria-label="Send">
                {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </Button>
            </div>
            <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">Don't paste secrets — messages are sent to the Gateway's LLM.</p>
          </form>
        </section>
        <Panel title={<span className="flex items-center gap-2"><Wrench className="h-3.5 w-3.5 text-primary" /> Tool activity</span>} actions={<span className="font-mono text-[11px] text-muted-foreground">{allTraces.length}</span>} className="flex min-h-0 flex-col">
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {allTraces.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-muted-foreground">Tool calls reported by the Gateway for this conversation will appear here.</p>
            ) : (
              allTraces.map((t, i) => <TraceCard key={i} t={t} />)
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
