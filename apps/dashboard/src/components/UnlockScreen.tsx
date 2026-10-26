import { useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api-client";
import { GATEWAY_BASE_URL } from "@/lib/config";
import { Logo } from "./layout/AppShell";

export function UnlockForm({ expired }: { expired?: boolean | undefined }) {
  const { signIn } = useAuth();
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!key.trim()) return setError("Enter a Gateway API key.");
    setBusy(true);
    setError(null);
    try {
      await signIn(key.trim());
      setKey("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {expired && (
        <div role="alert" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Your key was rejected by the Gateway (HTTP 401). Re-enter a valid key to continue.
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="api-key">Gateway API key</Label>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="api-key"
            type={show ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="pl-8 pr-9 font-mono text-sm"
            placeholder="urumi_…"
            aria-invalid={!!error}
            aria-describedby="api-key-help"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label={show ? "Hide key" : "Show key"}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {error ? (
          <p className="text-xs text-danger" role="alert">{error}</p>
        ) : (
          <p id="api-key-help" className="text-xs text-muted-foreground">
            Kept in memory for this tab only. Never stored or logged.
          </p>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
        {busy ? "Verifying…" : "Unlock console"}
      </Button>
    </form>
  );
}

export function UnlockScreen() {
  const { sessionExpired } = useAuth();
  return (
    <div className="grid-bg flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-elevated">
          <h1 className="text-lg font-semibold tracking-tight">Unlock the control plane</h1>
          <p className="mb-5 mt-1 text-sm text-muted-foreground">
            Authenticate with an existing Gateway API key issued by your team admin.
          </p>
          <UnlockForm expired={sessionExpired} />
        </div>
        <p className="mt-4 text-center font-mono text-[11px] text-muted-foreground">{GATEWAY_BASE_URL}</p>
      </div>
    </div>
  );
}
