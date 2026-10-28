// Backlog item 5: agent tool manifest, per-agent keys, daily budget, output allow-list, audit log.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockOneClick } from "../src/mock.ts";
import { TokenRegistry } from "../src/registry.ts";
import { defaultPolicy } from "../src/policy.ts";
import { planRoute } from "../src/router.ts";
import { validate } from "../src/jsonschema.ts";
import { AuditLog, MANIFEST_SCHEMA, TOOL_SCHEMAS, agentKeysFromEnv, agentToolsManifest, createAgentTools, hashKey, type AgentKey } from "../src/agent.ts";
import type { QuoteRequest } from "../src/types.ts";
import { TOKENS, EVM_ADDR, SOL_WALLET, USDC_ARB, XAUGC } from "./helpers.ts";

const registry = new TokenRegistry(TOKENS);
const A = "agent-a-test-bearer", B = "agent-b-test-bearer", R = "revoked-test-bearer";
const KEYS: AgentKey[] = [
  { id: "a", sha256: hashKey(A), dailyUsd: 100 },
  { id: "b", sha256: hashKey(B), dailyUsd: 1000, allowedOutputs: ["XAUT"] },
  { id: "r", sha256: hashKey(R), dailyUsd: 1000, revoked: true },
];
const bearer = (k: string) => `Bearer ${k}`;

function rig(day = "2026-10-29T10:00:00Z") {
  let quotes = 0, statusCalls = 0, fundCalls = 0;
  const mock = new MockOneClick(TOKENS);
  const client = { quote: (r: QuoteRequest) => { quotes++; return mock.quote(r); } };
  const audit = new AuditLog();
  const clock = { t: new Date(day) };
  const tools = createAgentTools({
    registry, policy: defaultPolicy, keys: KEYS, audit, now: () => clock.t,
    planRoute: (i, policy) => planRoute(i, { client, registry, policy }),
    fundQuote: async (b) => { fundCalls++; return { dry: true, body: b }; },
    status: async () => { statusCalls++; return { status: "PENDING_DEPOSIT" }; },
  });
  return { tools, audit, clock, counts: () => ({ quotes, statusCalls, fundCalls }) };
}

const route = (amount: string, out = "XAUT") => ({
  sources: [{ symbol: "USDC", chain: "arb", amount, refundTo: EVM_ADDR }],
  deliveries: [{ symbol: out, chain: "eth", mode: "DESTINATION_CHAIN", recipient: EVM_ADDR }],
});

const EXAMPLES: Record<string, unknown> = {
  plan_gold_route: route("40"),
  plan_gold_curve_funding: { mint: XAUGC, recipe: "fair-sol", connectedWallet: SOL_WALLET, from: { chain: "arbitrum", token: USDC_ARB, sender: EVM_ADDR }, want: "0.25" },
  get_route_status: { depositAddress: "0x000000000000000000000000000000000000dEaD" },
  list_supported_assets: { symbol: "XAUT" },
};

test("agent tool manifest validates against its JSON Schemas", () => {
  const m = agentToolsManifest();
  assert.deepEqual(validate(MANIFEST_SCHEMA, m), []);
  assert.deepEqual(m.tools.map((t) => t.name), ["plan_gold_route", "plan_gold_curve_funding", "get_route_status", "list_supported_assets"]);
  for (const t of m.tools) {
    assert.equal(t.readOnly, true);
    assert.deepEqual(validate(t.inputSchema, EXAMPLES[t.name]), [], `${t.name} example`);
  }
  assert.ok(validate(TOOL_SCHEMAS.plan_gold_route!, { sources: [], deliveries: [] }).length > 0);
  assert.ok(validate(TOOL_SCHEMAS.plan_gold_route!, { ...route("40"), execute: true }).some((e) => /execute: not allowed/.test(e)));
  assert.ok(validate(TOOL_SCHEMAS.plan_gold_route!, route("1e9")).some((e) => /amount/.test(e)));
  assert.ok(m.tools.every((t) => !/execute|deposit|build|submit/i.test(t.name + t.path)), "manifest offers no write tools");
});

test("unknown or revoked agent key returns 401 without quoting", async () => {
  const { tools, counts, audit } = rig();
  for (const h of [undefined, "Bearer nope", bearer(R), A]) {
    const r = await tools.call("plan_gold_route", h, route("10"));
    assert.equal(r.status, 401, String(h));
  }
  assert.equal((await tools.call("get_route_status", "Bearer nope", EXAMPLES.get_route_status)).status, 401);
  assert.deepEqual(counts(), { quotes: 0, statusCalls: 0, fundCalls: 0 });
  assert.equal(tools.audit("Bearer nope").status, 401);
  assert.ok(audit.entries.every((e) => e.decision === "deny" && e.agent === null));
  assert.doesNotMatch(JSON.stringify(audit.entries), /test-bearer/, "keys never reach the audit log");
});

test("per-agent daily budget blocks once exhausted", async () => {
  const { tools, counts, clock } = rig();
  let r = await tools.call("plan_gold_route", bearer(A), route("60"));
  assert.equal(r.status, 200);
  const q1 = counts().quotes;
  r = await tools.call("plan_gold_route", bearer(A), route("39"));
  assert.equal(r.status, 200, "~$99 of $100 used");
  const q2 = counts().quotes;
  r = await tools.call("plan_gold_route", bearer(A), route("5"));
  assert.equal(r.status, 429);
  assert.equal((r.json as { code: string }).code, "BUDGET_EXHAUSTED");
  assert.equal(counts().quotes, q2, "no quote once the budget is exhausted");
  assert.ok(q1 > 0);
  // funding counts against the same budget (0.25 SOL ~ $45 in the fixture)
  r = await tools.call("plan_gold_curve_funding", bearer(A), EXAMPLES.plan_gold_curve_funding);
  assert.equal(r.status, 429);
  assert.equal(counts().fundCalls, 0);
  // other agents are unaffected, and the budget resets on the next UTC day
  assert.equal((await tools.call("plan_gold_route", bearer(B), route("5"))).status, 200);
  clock.t = new Date("2026-10-30T00:00:01Z");
  assert.equal((await tools.call("plan_gold_route", bearer(A), route("5"))).status, 200);
  const a = tools.audit(bearer(A)).json as { spentTodayUsd: number; dailyUsd: number };
  assert.ok(a.spentTodayUsd > 4 && a.spentTodayUsd < 6);
});

test("per-agent allowed outputs: blocked before quoting", async () => {
  const { tools, counts } = rig();
  const r = await tools.call("plan_gold_route", bearer(B), route("10", "USDC"));
  assert.equal(r.status, 403);
  assert.equal((r.json as { code: string }).code, "OUTPUT_NOT_ALLOWED");
  const f = await tools.call("plan_gold_curve_funding", bearer(B), EXAMPLES.plan_gold_curve_funding);
  assert.equal(f.status, 403, "SOL is not on agent b's list");
  assert.deepEqual(counts(), { quotes: 0, statusCalls: 0, fundCalls: 0 });
});

test("audit log records request, decision, reason", async () => {
  const { tools, audit } = rig();
  await tools.call("plan_gold_route", bearer(A), route("40"));
  await tools.call("plan_gold_route", bearer(A), route("90"));
  await tools.call("plan_gold_route", bearer(A), { sources: "x" });
  await tools.call("list_supported_assets", bearer(A), { symbol: "XAUT" });
  await tools.call("nope", bearer(A), {});
  await tools.call("plan_gold_route", "Bearer x", route("1"));
  const [ok, budget, bad, list, unknown, unauth] = audit.entries;
  assert.equal(audit.entries.length, 6);
  assert.deepEqual([ok!.agent, ok!.tool, ok!.decision], ["a", "plan_gold_route", "allow"]);
  assert.deepEqual(ok!.request, { sources: ["40 USDC@arb"], deliveries: ["XAUT@eth:DESTINATION_CHAIN"] });
  assert.match(ok!.reason, /1 leg/);
  assert.ok(ok!.usd! > 39 && ok!.usd! < 41);
  assert.deepEqual([budget!.decision, budget!.request], ["deny", { sources: ["90 USDC@arb"], deliveries: ["XAUT@eth:DESTINATION_CHAIN"] }]);
  assert.match(budget!.reason, /daily budget/);
  assert.match(bad!.reason, /expected array/);
  assert.deepEqual([list!.decision, list!.reason], ["allow", `${registry.tokens.filter((t) => t.symbol === "XAUT").length} asset(s)`]);
  assert.match(unknown!.reason, /unknown tool/);
  assert.deepEqual([unauth!.agent, unauth!.decision], [null, "deny"]);
  const own = tools.audit(bearer(A)).json as { entries: unknown[] };
  assert.equal(own.entries.length, 5, "an agent sees only its own entries");
  assert.equal((tools.audit(bearer(B)).json as { entries: unknown[] }).entries.length, 0);
});

test("AGENT_KEYS parsing: hashes only, bad entries refused", () => {
  assert.deepEqual(agentKeysFromEnv({}), []);
  const k = agentKeysFromEnv({ AGENT_KEYS: JSON.stringify([{ id: "x", sha256: hashKey("k"), dailyUsd: 50 }]) });
  assert.equal(k[0]!.id, "x");
  assert.throws(() => agentKeysFromEnv({ AGENT_KEYS: JSON.stringify([{ id: "x", sha256: "plain-key", dailyUsd: 50 }]) }), /sha256/);
});
