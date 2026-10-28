// HTTP surface for backlog items 2 and 3, in MOCK mode (no network, simulated quotes).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { EVM_ADDR, SOL_WALLET, USDC_ARB, XAUGC } from "./helpers.ts";

let server: Server;
let base = "";
before(async () => {
  process.env.MOCK = "1";
  delete process.env.EXECUTION_ENABLED;
  const { startServer } = await import("../src/server.ts");
  server = await startServer(0);
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
after(() => server.close());

const post = async (p: string, body: unknown) => {
  const r = await fetch(base + p, { method: "POST", body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

test("POST /v1/routes/:id/execute: 403 without confirm or without EXECUTION_ENABLED, then one deposit per leg", async () => {
  const plan = (await post("/v1/routes", {
    sources: [{ symbol: "USDC", chain: "arb", amount: "40", refundTo: EVM_ADDR }],
    deliveries: [{ symbol: "XAUT", chain: "eth", mode: "DESTINATION_CHAIN", recipient: EVM_ADDR }],
  })).body;
  assert.equal(plan.legs.length, 1);
  const url = `/v1/routes/${plan.intentId}/execute`;
  let r = await post(url, { leg: 0 });
  assert.deepEqual([r.status, r.body.code], [403, "CONFIRM_REQUIRED"]);
  r = await post(url, { leg: 0, confirm: true });
  assert.deepEqual([r.status, r.body.code], [403, "EXECUTION_DISABLED"]);
  process.env.EXECUTION_ENABLED = "1"; // mock mode only: the mock hands out a fake 0x...dEaD address
  try {
    r = await post(url, { leg: 0, confirm: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.depositAddress, "0x000000000000000000000000000000000000dEaD");
    assert.match(r.body.evm.data, /^0xa9059cbb/);
    r = await post(url, { leg: 0, confirm: true });
    assert.deepEqual([r.status, r.body.code], [409, "ALREADY_PREPARED"]);
  } finally {
    delete process.env.EXECUTION_ENABLED;
  }
});

test("POST /v1/deposits/submit is refused without the gates", async () => {
  const r = await post("/v1/deposits/submit", { txHash: "0x1", depositAddress: "0x2" });
  assert.equal(r.status, 403);
});

test("POST /v1/goldcurve/fund returns recipe, dry quote and hand-off", async () => {
  const r = await post("/v1/goldcurve/fund", {
    mint: XAUGC, poolConfig: "ExTrSGZBjzMrueBNHEALCCJmppB9zpoTSWJea4iR2gQu", connectedWallet: SOL_WALLET,
    from: { chain: "arbitrum", token: USDC_ARB, sender: EVM_ADDR }, want: "0.5", raisedSoFar: 9.8,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.recipe, "fair-sol");
  assert.equal(r.body.quote.routeLabel, "XAU Route");
  assert.equal(r.body.quote.amountOut, "500000000");
  assert.match(r.body.graduation.warning, /0.2 SOL/);
  assert.equal(r.body.handoffUrl, `https://xauconnect.com/token/solana/${XAUGC}`);
  const bad = await post("/v1/goldcurve/fund", { mint: XAUGC, recipe: "fair-sol", connectedWallet: SOL_WALLET, from: { chain: "arbitrum", token: USDC_ARB, sender: EVM_ADDR } });
  assert.equal(bad.status, 400);
});

test("POST /v1/xau/cross-chain/quote maps errors to XAU Route copy", async () => {
  const r = await post("/v1/xau/cross-chain/quote", { fromChain: "arbitrum", toChain: "solana", tokenIn: "0x0000000000000000000000000000000000000bad", tokenOut: "native", amount: "1", slippageBps: 50, sender: EVM_ADDR, recipient: SOL_WALLET });
  assert.equal(r.status, 422);
  assert.equal(r.body.code, "UNSUPPORTED_TOKEN");
  assert.doesNotMatch(r.body.error, /near|1click|intents/i);
});
