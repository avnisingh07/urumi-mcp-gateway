import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, Outlet, createRootRouteWithContext, type ErrorComponentProps } from "@tanstack/react-router";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "../lib/auth";
import { AppShell } from "../components/layout/AppShell";
import { UnlockForm, UnlockScreen } from "../components/UnlockScreen";
import { Toaster } from "../components/ui/sonner";
import { TooltipProvider } from "../components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";

function Recovery({ error, reset }: ErrorComponentProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <div className="flex min-h-screen items-center justify-center bg-background px-4"><div className="max-w-md text-center"><h1 className="text-xl font-semibold">This page didn&apos;t load</h1><p className="mt-2 text-sm text-muted-foreground">Try again or return home.</p><div className="mt-6 flex justify-center gap-2"><button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={reset}>Try again</button><Link to="/" className="rounded-md border border-input px-4 py-2 text-sm">Go home</Link></div></div></div>;
}
function NotFound() { return <div className="flex min-h-screen items-center justify-center bg-background"><div className="text-center"><h1 className="text-5xl font-bold">404</h1><Link to="/" className="mt-4 inline-block text-primary">Go home</Link></div></div>; }

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Root, errorComponent: Recovery, notFoundComponent: NotFound });

function Root() {
  const { queryClient } = Route.useRouteContext();
  return <QueryClientProvider client={queryClient}><AuthProvider><TooltipProvider delayDuration={200}><Gate /><Toaster theme="dark" position="bottom-right" /></TooltipProvider></AuthProvider></QueryClientProvider>;
}
function Gate() {
  const { authenticated, sessionExpired } = useAuth();
  if (!authenticated) return <UnlockScreen />;
  return <><AppShell><Outlet /></AppShell><Dialog open={sessionExpired}><DialogContent className="sm:max-w-sm" onInteractOutside={(event) => event.preventDefault()}><DialogHeader><DialogTitle>Session rejected</DialogTitle><DialogDescription>Re-enter a Gateway API key to continue.</DialogDescription></DialogHeader><UnlockForm expired /></DialogContent></Dialog></>;
}
