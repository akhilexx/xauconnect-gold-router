// Backlog item 5 over HTTP, in MOCK + DEMO_PUBLIC mode (the hosted demo's settings, no network).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { hashKey } from "../src/agent.ts";
import { EVM_ADDR } from "./helpers.ts";

const KEY = "http-test-agent-bearer";
let server: Server;
let base = "";
before(async () => {
  process.env.MOCK = "1";
  process.env.DEMO_PUBLIC = "1";
  delete process.env.EXECUTION_ENABLED;
  process.env.AGENT_KEYS = JSON.stringify([{ id: "demo", sha256: hashKey(KEY), dailyUsd: 50, allowedOutputs: ["XAUT"] }]);
  const { startServer } = await import("../src/server.ts");
  server = await startServer(0);
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
after(() => server.close());

const call = async (tool: string, body: unknown, key?: string) => {
  const r = await fetch(`${base}/v1/agent/tools/${tool}`, { method: "POST", body: JSON.stringify(body), headers: key ? { Authorization: `Bearer ${key}` } : {} });
  return { status: r.status, body: await r.json() };
};
const route = (amount: string) => ({
  sources: [{ symbol: "USDC", chain: "arb", amount, refundTo: EVM_ADDR }],
  deliveries: [{ symbol: "XAUT", chain: "eth", mode: "INTENTS", recipient: "demo.near" }],
});

test("GET /.well-known/agent-tools.json serves the manifest publicly", async () => {
  const r = await fetch(`${base}/.well-known/agent-tools.json`);
  assert.equal(r.status, 200);
  const m = await r.json();
  assert.equal(m.tools.length, 4);
});

test("agent tools over HTTP: 401, plan, budget, audit", async () => {
  assert.equal((await call("plan_gold_route", route("10"))).status, 401);
  const ok = await call("plan_gold_route", route("30"), KEY);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.legs.length, 1);
  assert.equal(ok.body.legs[0].delivery.symbol, "XAUT");
  const over = await call("plan_gold_route", route("30"), KEY);
  assert.deepEqual([over.status, over.body.code], [429, "BUDGET_EXHAUSTED"]);
  const assets = await call("list_supported_assets", { symbol: "XAUT" }, KEY);
  assert.ok(assets.body.assets.length >= 1);
  const bad = await fetch(`${base}/v1/agent/tools/plan_gold_route`, { method: "POST", body: "{not json", headers: { Authorization: `Bearer ${KEY}` } });
  assert.equal(bad.status, 400);
  const audit = await (await fetch(`${base}/v1/agent/audit`, { headers: { Authorization: `Bearer ${KEY}` } })).json();
  assert.deepEqual(audit.entries.map((e: { decision: string }) => e.decision), ["allow", "deny", "allow"]);
  assert.equal((await fetch(`${base}/v1/agent/audit`)).status, 401);
  // the hosted demo's write gates still hold
  const exec = await fetch(`${base}/v1/deposits/submit`, { method: "POST", body: "{}" });
  assert.equal(exec.status, 403);
});
