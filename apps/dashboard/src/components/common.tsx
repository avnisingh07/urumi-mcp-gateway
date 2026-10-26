import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, Inbox, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ApiError, errorMessage } from "@/lib/api-client";
import type { Upstream, UpstreamHealth } from "@/lib/types";

export type Tone = "success" | "warning" | "danger" | "neutral" | "info";

const toneClass: Record<Tone, string> = {
  success: "bg-success/12 text-success border-success/25",
  warning: "bg-warning/12 text-warning border-warning/25",
  danger: "bg-danger/12 text-danger border-danger/25",
  neutral: "bg-muted text-muted-foreground border-border",
  info: "bg-primary/12 text-primary border-primary/25",
};
const dotClass: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-muted-foreground",
  info: "bg-primary",
};

export function StatusBadge({ tone, children, pulse }: { tone: Tone; children: ReactNode; pulse?: boolean | undefined }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        toneClass[tone],
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotClass[tone], pulse && "animate-pulse")} />
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode | undefined;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function RefreshButton({ onClick, loading, label = "Refresh" }: { onClick: () => void; loading?: boolean | undefined; label?: string | undefined }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={loading}>
      <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
      {label}
    </Button>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  tone,
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: string | undefined;
  tone?: Tone | undefined;
  loading?: boolean | undefined;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {tone && <span className={cn("h-1.5 w-1.5 rounded-full", dotClass[tone])} />}
        {label}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-12" />
      ) : (
        <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      )}
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className }: { title?: ReactNode | undefined; actions?: ReactNode | undefined; children: ReactNode; className?: string | undefined }) {
  return (
    <section className={cn("rounded-lg border border-border bg-card", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode | undefined; title: string; description?: string | undefined; action?: ReactNode | undefined }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
        {icon ?? <Inbox className="h-5 w-5" />}
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: (() => void) | undefined }) {
  const forbidden = error instanceof ApiError && error.isForbidden;
  const network = error instanceof ApiError && (error.kind === "network" || error.kind === "timeout");
  const Icon = forbidden ? ShieldAlert : network ? WifiOff : AlertTriangle;
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-danger/30 bg-danger/10 text-danger">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-foreground">
        {forbidden ? "Permission denied" : network ? "Gateway unreachable" : "Couldn't load data"}
      </p>
      <p className="mt-1 max-w-md text-xs text-muted-foreground">{errorMessage(error)}</p>
      {onRetry && !forbidden && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number | undefined; cols?: number | undefined }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string | undefined; className?: string | undefined }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-7 w-7", className)}
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error("Clipboard access was denied by the browser.");
        }
      }}
    >
      {done ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean | undefined;
  loading?: boolean | undefined;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm text-muted-foreground">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={loading}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            className={cn(destructive && "bg-danger text-danger-foreground hover:bg-danger/90")}
          >
            {loading ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function FieldError({ message }: { message?: string | undefined }) {
  if (!message) return null;
  return <p className="text-xs text-danger">{message}</p>;
}

/** Joins an upstream with its health record (by id, then by name). */
export function findHealth(u: Upstream, health?: UpstreamHealth[]) {
  return health?.find((h) => (h.id && h.id === u.id) || h.name === u.name);
}

export function UpstreamStateBadge({ upstream, health, loading }: { upstream: Upstream; health?: UpstreamHealth | undefined; loading?: boolean | undefined }) {
  if (!upstream.enabled) return <StatusBadge tone="neutral">Disabled</StatusBadge>;
  if (loading) return <StatusBadge tone="neutral" pulse>Checking</StatusBadge>;
  if (!health) return <StatusBadge tone="warning">No health data</StatusBadge>;
  return health.reachable ? (
    <StatusBadge tone="success">Connected</StatusBadge>
  ) : (
    <StatusBadge tone="danger">Unreachable</StatusBadge>
  );
}

export function OutcomeBadge({ outcome, label }: { outcome: "success" | "error" | "unknown"; label?: string | undefined }) {
  if (outcome === "success") return <StatusBadge tone="success">{label ?? "success"}</StatusBadge>;
  if (outcome === "error") return <StatusBadge tone="danger">{label ?? "error"}</StatusBadge>;
  return <StatusBadge tone="neutral">{label ?? "unknown"}</StatusBadge>;
}
