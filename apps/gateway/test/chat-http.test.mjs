import assert from "node:assert/strict";
import test from "node:test";
import { handleApi } from "../dist/index.js";

function request(body, key = "valid") { return { method: "POST", headers: { authorization: `Bearer ${key}` }, async *[Symbol.asyncIterator]() { yield Buffer.from(body); } }; }
async function invoke(body, user, agent) {
  const result = { status: 0, body: "" }; const response = { writeHead: (status) => { result.status = status; }, end: (value) => { result.body = value ?? ""; } };
  await handleApi(request(body), response, {}, new URL("http://gateway.test/api/chat"), async () => user, { report: async () => [] }, agent);
  return { status: result.status, body: result.body ? JSON.parse(result.body) : undefined };
}

test("chat HTTP API authenticates, accepts members, validates payloads, and uses authenticated identity", async () => {
  assert.equal((await invoke('{"message":"hi"}', undefined)).status, 401);
  assert.deepEqual((await invoke('{"message":"hi"}', { id: "member-id", username: "member", role: "member" })).body, { error: "chat_unavailable" });
  const calls = []; const agent = { respond: async (message, history, caller) => { calls.push({ message, history, caller }); return { message: "ok", traces: [], status: "completed" }; } };
  const good = await invoke('{"message":"hi","userId":"attacker"}', { id: "member-id", username: "member", role: "member" }, agent);
  assert.equal(good.status, 200); assert.equal(calls[0].caller.id, "member-id");
  assert.equal((await invoke('{"message":3}', { id: "m", username: "m", role: "member" }, agent)).status, 400);
  assert.equal((await invoke(JSON.stringify({ message: "x".repeat(8001) }), { id: "m", username: "m", role: "member" }, agent)).status, 400);
  assert.equal((await invoke(JSON.stringify({ message: "x", history: Array(13).fill({ role: "user", content: "x" }) }), { id: "m", username: "m", role: "member" }, agent)).status, 400);
});

test("chat HTTP API returns a safe provider failure result", async () => {
  const agent = { respond: async () => ({ message: "The chat provider is unavailable.", traces: [], status: "error" }) };
  const result = await invoke('{"message":"hi"}', { id: "m", username: "m", role: "member" }, agent);
  assert.equal(result.status, 200); assert.deepEqual(result.body, { message: "The chat provider is unavailable.", traces: [], status: "error" });
});
