/**
 * Tests for near-intents-xau.ts (XAUConnect-shaped NEAR Intents handlers). No network: fetch is stubbed.
 * Run: pnpm --filter @xauconnect/backend test   (tsx --test)
 * The full suite (7 tests) lives in xauconnect-gold-router/test/near-intents-xau.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NearIntentsVenue, nearIntentsConfigFromEnv, type NearIntentsConfig } from "./near-intents.js";
import { createXauNearIntentsHandlers, normalizeNearIntentsStatus } from "./near-intents-xau.js";

const USDC_ARB = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const TOKENS = [
  { assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", blockchain: "arb", symbol: "USDC", decimals: 6, contractAddress: USDC_ARB },
  { assetId: "nep141:sol.omft.near", blockchain: "sol", symbol: "SOL", decimals: 9 },
];
const QUOTE = {
  amountIn: "40000000", amountInFormatted: "40", amountInUsd: "40.00", amountOut: "250000000", amountOutFormatted: "0.25",
  amountOutUsd: "39.60", minAmountOut: "247500000", timeEstimate: 22,
};
const REQ = {
  fromChainKey: "arbitrum", toChainKey: "solana", tokenIn: USDC_ARB, tokenOut: "native", amountIn: "40000000",
  slippageBps: 100, taker: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", takerDestination: "ENobDuF4iGAmF1Y211aLj6gXCNpdHBfnNkUyLDdbUabb",
};

function stub() {
  const bodies: Record<string, unknown>[] = [];
  const f: NearIntentsConfig["fetch"] = async (url, init) => {
    const u = new URL(url);
    if (u.pathname === "/v0/tokens") return new Response(JSON.stringify(TOKENS));
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    bodies.push(body);
    const quote = body.dry ? QUOTE : { ...QUOTE, depositAddress: "0x00000000000000000000000000000000000000d1" };
    return new Response(JSON.stringify({ quote, signature: "stub" }));
  };
  return { f, bodies };
}
const venue = (f: NearIntentsConfig["fetch"], executionEnabled = false) =>
  new NearIntentsVenue({ ...nearIntentsConfigFromEnv({ NEAR_INTENTS_ENABLED: "true" }), fetch: f, executionEnabled });

test("quote is dry and returns a CrossChainQuote labelled XAU Route", async () => {
  const s = stub();
  const r = await createXauNearIntentsHandlers(venue(s.f), { newId: () => "ref1" }).quote(REQ);
  assert.equal(r.status, 200);
  const q = (r.json as { crossChainQuote: { provider: string; bridgeName: string; amountOut: string } }).crossChainQuote;
  assert.deepEqual([q.provider, q.bridgeName, q.amountOut], ["near-intents", "XAU Route", "250000000"]);
  assert.equal(s.bodies[0]?.dry, true);
});

test("build is 403 without the execution flag and without confirm; no deposit address requested", async () => {
  const s = stub();
  const off = createXauNearIntentsHandlers(venue(s.f), { newId: () => "a" });
  await off.quote(REQ);
  assert.equal((await off.build({ quoteRef: "a", confirm: true })).status, 403);
  const on = createXauNearIntentsHandlers(venue(s.f, true), { newId: () => "b" });
  await on.quote(REQ);
  assert.equal((await on.build({ quoteRef: "b" })).status, 403);
  assert.equal(s.bodies.filter((b) => b.dry === false).length, 0);
  const ok = await on.build({ quoteRef: "b", confirm: true });
  assert.equal((ok.json as { evm: { chainId: number } }).evm.chainId, 42161);
});

test("status normalizes to pending/completed/failed", () => {
  assert.equal(normalizeNearIntentsStatus({ status: "PROCESSING", destinationTxs: [] }).status, "pending");
  assert.equal(normalizeNearIntentsStatus({ status: "SUCCESS", destinationTxs: [] }).status, "completed");
  assert.equal(normalizeNearIntentsStatus({ status: "REFUNDED", destinationTxs: [] }).refunded, true);
});
