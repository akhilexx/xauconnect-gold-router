// Hosted-demo mode (DEMO_PUBLIC=1): zero secrets, dry quotes only, execution hard-off, POSTs rate limited.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { EVM_ADDR, SOL_WALLET, USDC_ARB, XAUGC } from "./helpers.ts";

let server: Server;
let base = "";
before(async () => {
  process.env.MOCK = "1";
  process.env.DEMO_PUBLIC = "1";
  process.env.DEMO_RATE_PER_MIN = "8";
  delete process.env.EXECUTION_ENABLED;
  const { startServer } = await import("../src/server.ts");
  server = await startServer(0);
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
after(() => server.close());

const post = async (p: string, body: unknown, ip = "198.51.100.1") => {
  const r = await fetch(base + p, { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json(), headers: r.headers };
};

test("demo: health reports demo mode with execution off; page shows the dry-quote banner", async () => {
  const h = await (await fetch(base + "/health")).json();
  assert.deepEqual([h.demoPublic, h.executionEnabled], [true, false]);
  const page = await (await fetch(base + "/")).text();
  assert.match(page, /Hosted demo: dry quotes only/);
  assert.match(page, /Fund a Gold Curve from another chain/);
});

test("demo: execute, deposit submit and build are 403 DEMO_READ_ONLY even with confirm", async () => {
  const plan = (await post("/v1/routes", {
    sources: [{ symbol: "USDC", chain: "arb", amount: "40", refundTo: EVM_ADDR }],
    deliveries: [{ symbol: "XAUT", chain: "eth", mode: "DESTINATION_CHAIN", recipient: EVM_ADDR }],
  }, "198.51.100.2")).body;
  const ex = await post(`/v1/routes/${plan.intentId}/execute`, { leg: 0, confirm: true }, "198.51.100.2");
  assert.deepEqual([ex.status, ex.body.code], [403, "DEMO_READ_ONLY"]);
  const sub = await post("/v1/deposits/submit", { txHash: "0x1", depositAddress: "0x2", confirm: true }, "198.51.100.2");
  assert.deepEqual([sub.status, sub.body.code], [403, "DEMO_READ_ONLY"]);
  const b = await post("/v1/xau/swap/cross-chain/near-intents/build", { quoteRef: "x", confirm: true }, "198.51.100.2");
  assert.deepEqual([b.status, b.body.code], [403, "DEMO_READ_ONLY"]);
  assert.equal(ex.headers.get("x-content-type-options"), "nosniff");
});

test("demo: XAU-shaped quote and Gold Curve funding still work (dry)", async () => {
  const q = await post("/v1/xau/swap/cross-chain/near-intents/quote", {
    fromChainKey: "arbitrum", toChainKey: "solana", tokenIn: USDC_ARB, tokenOut: "native", amountIn: "40000000",
    slippageBps: 100, taker: EVM_ADDR, takerDestination: SOL_WALLET,
  }, "198.51.100.3");
  assert.equal(q.status, 200);
  assert.deepEqual([q.body.crossChainQuote.provider, q.body.crossChainQuote.bridgeName], ["near-intents", "XAU Route"]);
  const f = await post("/v1/goldcurve/fund", {
    mint: XAUGC, poolConfig: "ExTrSGZBjzMrueBNHEALCCJmppB9zpoTSWJea4iR2gQu", connectedWallet: SOL_WALLET,
    from: { chain: "arbitrum", token: USDC_ARB, sender: EVM_ADDR }, want: "0.25", raisedSoFar: 0,
  }, "198.51.100.3");
  assert.equal(f.status, 200);
  assert.equal(f.body.recipe, "fair-sol");
});

test("demo: POSTs are rate limited per IP", async () => {
  const codes: number[] = [];
  for (let i = 0; i < 10; i++) codes.push((await post("/v1/deposits/submit", {}, "203.0.113.9")).status);
  assert.deepEqual(codes.slice(0, 8), Array(8).fill(403));
  assert.deepEqual(codes.slice(8), [429, 429]);
  assert.equal((await post("/v1/deposits/submit", {}, "203.0.113.10")).status, 403, "other IPs unaffected");
});

test("demo: refuses to start with EXECUTION_ENABLED set", async () => {
  process.env.EXECUTION_ENABLED = "1";
  try {
    const { startServer } = await import("../src/server.ts");
    await assert.rejects(() => startServer(0), /DEMO_PUBLIC=1 must not be combined/);
  } finally { delete process.env.EXECUTION_ENABLED; }
});

test("rateLimiter: fixed window resets", async () => {
  const { rateLimiter } = await import("../src/server.ts");
  let t = 0;
  const allow = rateLimiter(2, 1000, () => t);
  assert.deepEqual([allow("a"), allow("a"), allow("a")], [true, true, false]);
  t = 1001;
  assert.equal(allow("a"), true);
});
