import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, Bot, KeyRound, LayoutGrid, LogOut, Menu, ScrollText, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useLiveness, useReadiness } from "@/hooks/use-gateway";
import { GATEWAY_BASE_URL } from "@/lib/config";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const nav = [
  { to: "/", label: "Overview", icon: LayoutGrid },
  { to: "/servers", label: "MCP Servers", icon: Server },
  { to: "/team", label: "Team & API Keys", icon: KeyRound },
  { to: "/audit", label: "Audit Logs", icon: ScrollText },
  { to: "/chat", label: "AI Chat", icon: Bot },
] as const;

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
          <path d="M6 5v8a6 6 0 0 0 12 0V5" strokeLinecap="round" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight text-sidebar-foreground">Urumi</div>
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">MCP Gateway</div>
      </div>
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {nav.map((item) => {
        const active = item.to === "/" ? path === "/" : path.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-foreground font-medium"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )}
          >
            <item.icon className={cn("h-4 w-4", active && "text-primary")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function UserCard() {
  const { user, signOut } = useAuth();
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-sidebar-border bg-sidebar-accent/40 p-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 font-mono text-xs font-semibold uppercase text-primary">
        {(user?.username ?? "?").slice(0, 2)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-sidebar-foreground">{user?.username ?? "Unknown user"}</div>
        <div className="text-[11px] capitalize text-muted-foreground">{user?.role ?? "role unknown"}</div>
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={signOut} aria-label="Sign out">
        <LogOut className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  return (
    <div className="flex h-full flex-col gap-6 p-3">
      <div className="px-1.5 pt-1">
        <Logo />
      </div>
      <NavList onNavigate={onNavigate} />
      <div className="mt-auto">
        <UserCard />
      </div>
    </div>
  );
}

export function ConnectionIndicator() {
  const live = useLiveness();
  const ready = useReadiness();
  const state =
    live.isLoading || ready.isLoading
      ? { tone: "bg-muted-foreground", label: "Checking" }
      : live.data?.ok && ready.data?.ok
        ? { tone: "bg-success", label: "Gateway ready" }
        : live.data?.ok
          ? { tone: "bg-warning", label: "Live, not ready" }
          : { tone: "bg-danger", label: "Gateway unavailable" };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} className="flex items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
          <span className={cn("h-1.5 w-1.5 rounded-full", state.tone)} />
          {state.label}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <span className="font-mono text-xs">{GATEWAY_BASE_URL}</span>
      </TooltipContent>
    </Tooltip>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
        <SidebarBody />
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 border-sidebar-border bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur lg:px-8">
          <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            <span className="font-mono">{GATEWAY_BASE_URL.replace(/^https?:\/\//, "")}</span>
          </div>
          <div className="ml-auto">
            <ConnectionIndicator />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
