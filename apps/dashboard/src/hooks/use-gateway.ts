import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";

const retry = (count: number, e: unknown) =>
  !(e instanceof ApiError && (e.status === 401 || e.status === 403)) && count < 1;

export const qk = {
  healthz: ["healthz"] as const,
  readyz: ["readyz"] as const,
  status: ["status"] as const,
  upstreams: ["upstreams"] as const,
  health: ["upstreams", "health"] as const,
  users: ["users"] as const,
  audit: ["audit"] as const,
};

export function useLiveness() {
  return useQuery({ queryKey: qk.healthz, queryFn: api.healthz, refetchInterval: 30_000, retry: 0 });
}
export function useReadiness() {
  return useQuery({ queryKey: qk.readyz, queryFn: api.readyz, refetchInterval: 30_000, retry: 0 });
}
export function useUpstreams() {
  const { authenticated } = useAuth();
  return useQuery({ queryKey: qk.upstreams, queryFn: api.upstreams, enabled: authenticated, retry });
}
export function useUpstreamHealth() {
  const { authenticated } = useAuth();
  return useQuery({ queryKey: qk.health, queryFn: api.upstreamHealth, enabled: authenticated, retry });
}
export function useUsers() {
  const { authenticated } = useAuth();
  return useQuery({ queryKey: qk.users, queryFn: api.users, enabled: authenticated, retry });
}
export function useAudit() {
  const { authenticated } = useAuth();
  return useQuery({ queryKey: qk.audit, queryFn: () => api.audit(100), enabled: authenticated, retry });
}
