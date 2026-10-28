// HTTP API so wallets, the XAUConnect frontend, or AI agents can request route plans.
//   GET  /health
//   GET  /v1/tokens?symbol=XAUT
//   POST /v1/routes      body: RouteIntent  -> RoutePlan (dry run)
//   GET  /v1/status?depositAddress=...
//   GET  /               demo page

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { buildDeps, loadEnv } from "./config.ts";
import { OneClickClient } from "./oneclick.ts";
import { planRoute } from "./router.ts";
import type { RouteIntent } from "./types.ts";

export async function startServer(port = Number(process.env.PORT ?? 8787)) {
  const deps = await buildDeps();
  const statusClient = new OneClickClient({ baseUrl: process.env.ONECLICK_BASE_URL, jwt: process.env.ONECLICK_JWT });
  const page = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (code: number, body: unknown, type = "application/json") => {
      res.writeHead(code, { "Content-Type": type });
      res.end(type === "application/json" ? JSON.stringify(body, null, 2) : String(body));
    };
    try {
      if (req.method === "GET" && url.pathname === "/") return send(200, page, "text/html");
      if (req.method === "GET" && url.pathname === "/health") return send(200, { ok: true, mock: deps.mock, policy: deps.policy });
      if (req.method === "GET" && url.pathname === "/v1/tokens") {
        const sym = url.searchParams.get("symbol");
        return send(200, sym ? deps.registry.tokens.filter((t) => t.symbol.toUpperCase() === sym.toUpperCase()) : deps.registry.tokens);
      }
      if (req.method === "POST" && url.pathname === "/v1/routes") {
        let raw = "";
        for await (const chunk of req) { raw += chunk; if (raw.length > 50_000) throw new Error("body too large"); }
        const intent = JSON.parse(raw) as RouteIntent;
        if (!Array.isArray(intent.sources) || !Array.isArray(intent.deliveries)) return send(400, { error: "sources[] and deliveries[] required" });
        return send(200, await planRoute(intent, { ...deps, referral: process.env.REFERRAL }));
      }
      if (req.method === "GET" && url.pathname === "/v1/status") {
        const d = url.searchParams.get("depositAddress");
        if (!d) return send(400, { error: "depositAddress required" });
        return send(200, await statusClient.status(d, url.searchParams.get("depositMemo") ?? undefined));
      }
      send(404, { error: "not found" });
    } catch (e) {
      send(500, { error: (e as Error).message });
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
