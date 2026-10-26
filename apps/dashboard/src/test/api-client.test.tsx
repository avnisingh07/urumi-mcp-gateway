import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, setApiKey } from "@/lib/api-client";

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => { vi.unstubAllGlobals(); setApiKey(null); });

describe("Gateway API client", () => {
  it("sends the bearer key and never writes it to storage", async () => {
    setApiKey("k_test"); const fn = mockFetch(200, { upstreams: [] });
    await api.upstreams();
    expect((fn.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: "Bearer k_test" });
    expect(window.localStorage.length).toBe(0);
  });
  it("fails closed without a key", async () => { await expect(api.upstreams()).rejects.toBeInstanceOf(ApiError); });
  it("uses the Gateway credential field and omits blank credentials", async () => {
    setApiKey("k"); const fn = mockFetch(200, {});
    await api.updateUpstream("1", { enabled: false, credential: "" });
    expect(JSON.parse(((fn.mock.calls[0] as unknown as [string, RequestInit])[1].body) as string)).toEqual({ enabled: false });
  });
  it("maps occurredAt audit timestamps", async () => {
    setApiKey("k"); mockFetch(200, { events: [{ id: "1", occurredAt: "2026-01-02T03:04:05.000Z", outcome: "failure" }] });
    await expect(api.audit()).resolves.toMatchObject([{ timestamp: "2026-01-02T03:04:05.000Z", outcome: "error" }]);
  });
  it("uses the Gateway chat payload", async () => {
    setApiKey("k"); const fn = mockFetch(200, { message: "ok", traces: [] });
    await api.chat([{ role: "user", content: "first" }, { role: "assistant", content: "prior" }, { role: "user", content: "last" }]);
    expect(JSON.parse(((fn.mock.calls[0] as unknown as [string, RequestInit])[1].body) as string)).toEqual({ message: "last", history: [{ role: "user", content: "first" }, { role: "assistant", content: "prior" }] });
  });
});
