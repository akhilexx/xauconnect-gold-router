// HTTP API so wallets, the XAUConnect frontend, or AI agents can request route plans.
//   GET  /health
//   GET  /v1/tokens?symbol=XAUT
//   POST /v1/routes      body: RouteIntent  -> RoutePlan (dry run)
//   GET  /v1/status?depositAddress=...
//   POST /v1/routes/:intentId/execute   body: { leg, confirm: true } -> unsigned deposit instructions
//                                       (403 unless EXECUTION_ENABLED=1 on the server AND confirm:true)
//   POST /v1/deposits/submit            body: { txHash, depositAddress, memo?, confirm: true } (same gates)
//   POST /v1/xau/cross-chain/quote      XAUConnect-shaped dry quote via the NEAR Intents venue adapter
//   POST /v1/goldcurve/fund             "Fund from another chain": recipe -> dry quote -> hand-off
//   POST /v1/xau/swap/cross-chain/near-intents/quote|build   the exact handlers patch 0005 ships to XAUConnect
//   GET  /.well-known/agent-tools.json  agent tool manifest (4 read-only tools + JSON Schemas)
//   POST /v1/agent/tools/:name          Authorization: Bearer <agent key>; per-key daily budget + output allow-list
//   GET  /v1/agent/audit                the calling agent's audit entries
//   GET  /               demo page
//
// DEMO_PUBLIC=1 (hosted demo, docs/HOSTED-DEMO.md): execute, deposit submit and build are hard-off (403
// DEMO_READ_ONLY) whatever EXECUTION_ENABLED says; POSTs are rate limited per IP; no secrets are needed.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { buildDeps, loadEnv } from "./config.ts";
import { OneClickClient } from "./oneclick.ts";
import { planRoute } from "./router.ts";
import type { RouteIntent, Token } from "./types.ts";
import { ExecutionError, PlanStore, prepareLegDeposit, submitDepositTx } from "./execute.ts";
import { mockFetch } from "./mock.ts";
import { NearIntentsError, NearIntentsVenue, createNearIntentsHandlers, nearIntentsConfigFromEnv, toUserError } from "./xauconnect/near-intents.ts";
import type { CrossChainQuoteInput } from "./xauconnect/near-intents.ts";
import { planFunding } from "./xauconnect/fund-curve.ts";
import { createXauNearIntentsHandlers } from "./xauconnect/near-intents-xau.ts";
import type { FundingInput } from "./xauconnect/fund-curve.ts";
import { AuditLog, agentKeysFromEnv, agentToolsManifest, createAgentTools } from "./agent.ts";

export function venueFromEnv(env: Record<string, string | undefined>, mockTokens?: Token[]): NearIntentsVenue {
  // In this repo the venue is on unless NEAR_INTENTS_ENABLED=false; in XAUConnect it defaults off.
  const cfg = nearIntentsConfigFromEnv({ NEAR_INTENTS_ENABLED: "true", ...env });
  // The router's venue never builds deposits; deposits go through /v1/routes/:id/execute.
  cfg.executionEnabled = false;
  if (mockTokens) cfg.fetch = mockFetch(mockTokens);
  return new NearIntentsVenue(cfg);
}

/** Fixed-window per-key limiter for the hosted demo. */
export function rateLimiter(limit: number, windowMs = 60_000, now = () => Date.now()) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string): boolean => {
    const t = now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
    const h = hits.get(key);
    if (!h || h.reset <= t) { hits.set(key, { n: 1, reset: t + windowMs }); return true; }
    h.n += 1;
    return h.n <= limit;
  };
}

export function isDemoPublic(env: Record<string, string | undefined>): boolean {
  return env.DEMO_PUBLIC === "1";
}

export async function startServer(port = Number(process.env.PORT ?? 8787)) {
  const deps = await buildDeps();
  const statusClient = new OneClickClient({ baseUrl: process.env.ONECLICK_BASE_URL, jwt: process.env.ONECLICK_JWT });
  const store = new PlanStore();
  const venue = venueFromEnv(process.env, deps.mock ? deps.registry.tokens : undefined);
  const xau = createNearIntentsHandlers(venue);
  const xauShaped = createXauNearIntentsHandlers(venue);
  const demo = isDemoPublic(process.env);
  if (demo && process.env.EXECUTION_ENABLED) throw new Error("DEMO_PUBLIC=1 must not be combined with EXECUTION_ENABLED");
  const allow = rateLimiter(Number(process.env.DEMO_RATE_PER_MIN || 30));
  const agentTools = createAgentTools({
    registry: deps.registry, policy: deps.policy,
    planRoute: (intent, policy) => planRoute(intent, { ...deps, policy, referral: process.env.REFERRAL }),
    fundQuote: (body) => venue.quote(body),
    status: (addr, memo) => statusClient.status(addr, memo),
    keys: agentKeysFromEnv(process.env),
    audit: new AuditLog(process.env.AGENT_AUDIT_LOG || undefined),
  });
  const manifest = agentToolsManifest();
  // Prefill the demo page with the configured public demo address, if any.
  const demoAddr = process.env.RECIPIENT_EVM && /^0x[0-9a-fA-F]{40}$/.test(process.env.RECIPIENT_EVM) ? process.env.RECIPIENT_EVM : null;
  let page = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  if (demoAddr) page = page.replace(/0xYour(Arbitrum|Ethereum)Address/g, demoAddr);
  const demoSol = process.env.RECIPIENT_SOL && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(process.env.RECIPIENT_SOL) ? process.env.RECIPIENT_SOL : null;
  if (demoSol) page = page.replace(/YourSolanaAddress/g, demoSol);
  page = page.replace("<!--MODE-->", demo
    ? "Hosted demo: dry quotes only. Execution, deposits and signing are switched off on this server."
    : deps.mock ? "MOCK mode: simulated quotes from fixtures, no network." : "Local mode: live dry quotes.");

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (code: number, body: unknown, type = "application/json") => {
      res.writeHead(code, { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" });
      res.end(type === "application/json" ? JSON.stringify(body, null, 2) : String(body));
    };
    const readJson = async <T>(): Promise<T> => {
      let raw = "";
      for await (const chunk of req) { raw += chunk; if (raw.length > 50_000) throw new Error("body too large"); }
      return JSON.parse(raw || "{}") as T;
    };
    try {
      if (demo && req.method === "POST") {
        const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]!.trim() || req.socket.remoteAddress || "?";
        if (!allow(ip)) return send(429, { error: "Too many requests. Try again in a minute.", code: "RATE_LIMITED" });
        const gated = /^\/v1\/routes\/[^/]+\/execute$/.test(url.pathname) || url.pathname === "/v1/deposits/submit" || url.pathname.endsWith("/near-intents/build");
        if (gated) return send(403, { error: "This hosted demo only shows dry quotes. Execution is switched off.", code: "DEMO_READ_ONLY" });
      }
      const exec = req.method === "POST" ? url.pathname.match(/^\/v1\/routes\/([0-9a-f-]{36})\/execute$/) : null;
      if (exec) {
        const b = await readJson<{ leg?: number; confirm?: unknown }>();
        return send(200, await prepareLegDeposit(store, exec[1], b.leg ?? 0, { confirm: b.confirm }, { ...deps, env: process.env, referral: process.env.REFERRAL }));
      }
      if (req.method === "POST" && url.pathname === "/v1/deposits/submit") {
        const b = await readJson<{ txHash: string; depositAddress: string; memo?: string; confirm?: unknown }>();
        return send(200, await submitDepositTx(b, { client: statusClient, env: process.env }));
      }
      if (req.method === "POST" && url.pathname === "/v1/xau/cross-chain/quote") {
        const r = await xau.quote(await readJson<CrossChainQuoteInput>());
        return send(r.status, r.json);
      }
      if (req.method === "POST" && url.pathname === "/v1/xau/swap/cross-chain/near-intents/quote") {
        const r = await xauShaped.quote(await readJson<unknown>());
        return send(r.status, r.json);
      }
      if (req.method === "POST" && url.pathname === "/v1/xau/swap/cross-chain/near-intents/build") {
        const r = await xauShaped.build(await readJson<unknown>());
        return send(r.status, r.json);
      }
      if (req.method === "POST" && url.pathname === "/v1/goldcurve/fund") {
        let plan;
        try { plan = planFunding(await readJson<FundingInput>()); } catch (e) { return send(400, { error: (e as Error).message }); }
        const quote = await venue.quote(plan.body);
        return send(200, { ...plan, quote, handoffUrl: `https://xauconnect.com${plan.handoffPath}` });
      }
      if (req.method === "GET" && url.pathname === "/.well-known/agent-tools.json") return send(200, manifest);
      const tool = req.method === "POST" ? url.pathname.match(/^\/v1\/agent\/tools\/([a-z_]{1,40})$/) : null;
      if (tool) {
        let args: unknown;
        try { args = await readJson<unknown>(); } catch { return send(400, { error: "body must be JSON", code: "INVALID_ARGUMENTS" }); }
        const r = await agentTools.call(tool[1]!, req.headers.authorization, args);
        return send(r.status, r.json);
      }
      if (req.method === "GET" && url.pathname === "/v1/agent/audit") {
        const r = agentTools.audit(req.headers.authorization);
        return send(r.status, r.json);
      }
      if (req.method === "GET" && url.pathname === "/") return send(200, page, "text/html");
      if (req.method === "GET" && url.pathname === "/health") return send(200, { ok: true, mock: deps.mock, demoPublic: demo, executionEnabled: !demo && process.env.EXECUTION_ENABLED === "1", policy: deps.policy });
      if (req.method === "GET" && url.pathname === "/v1/tokens") {
        const sym = url.searchParams.get("symbol");
        return send(200, sym ? deps.registry.tokens.filter((t) => t.symbol.toUpperCase() === sym.toUpperCase()) : deps.registry.tokens);
      }
      if (req.method === "POST" && url.pathname === "/v1/routes") {
        const intent = await readJson<RouteIntent>();
        if (!Array.isArray(intent.sources) || !Array.isArray(intent.deliveries)) return send(400, { error: "sources[] and deliveries[] required" });
        const plan = await planRoute(intent, { ...deps, referral: process.env.REFERRAL });
        store.put(plan);
        return send(200, plan);
      }
      if (req.method === "GET" && url.pathname === "/v1/status") {
        const d = url.searchParams.get("depositAddress");
        if (!d) return send(400, { error: "depositAddress required" });
        return send(200, await statusClient.status(d, url.searchParams.get("depositMemo") ?? undefined));
      }
      send(404, { error: "not found" });
    } catch (e) {
      if (e instanceof ExecutionError)
        return send(e.code === "CONFIRM_REQUIRED" || e.code === "EXECUTION_DISABLED" ? 403 : 409, { error: e.message, code: e.code });
      if (e instanceof NearIntentsError) return send(e.code === "DISABLED" ? 503 : 422, { error: toUserError(e), code: e.code });
      send(500, { error: demo ? "Something went wrong. Please try again." : (e as Error).message });
    }
  });
  await new Promise<void>((r) => server.listen(port, r));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnv();
  startServer().then((s) => {
    const a = s.address();
    console.log(`router listening on http://localhost:${typeof a === "object" && a ? a.port : ""} (MOCK=${process.env.MOCK === "1" ? "1" : "0"})`);
  });
}
