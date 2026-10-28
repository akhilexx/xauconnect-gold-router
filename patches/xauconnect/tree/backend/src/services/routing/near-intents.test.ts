/**
 * Unit tests for the NEAR Intents venue. No network: fetch is stubbed.
 * Target path: backend/src/services/routing/near-intents.test.ts
 * Written with node:test. Run: npx tsx --test backend/src/services/routing/near-intents.test.ts
 * (if the backend uses vitest, replace the two imports below with `import { test, expect } from "vitest"`
 *  and assert.* with expect(); the assertions are 1:1).
 * The full suite for this file (15 tests) lives in xauconnect-gold-router/test/near-intents.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAIN_TO_ONECLICK, NearIntentsVenue, USER_ERRORS, createNearIntentsHandlers, erc20TransferData, fromOneClickChain,
  nearIntentsConfigFromEnv, toOneClickChain, type XauChainKey,
} from "./near-intents";

const TOKENS = [
  { assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", blockchain: "arb", symbol: "USDC", decimals: 6, contractAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
  { assetId: "nep141:sol.omft.near", blockchain: "sol", symbol: "SOL", decimals: 9 },
];
const input = {
  fromChain: "arbitrum", toChain: "solana", tokenIn: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", tokenOut: "native",
  amount: "40000000", slippageBps: 100, sender: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", recipient: "ENobDuF4iGAmF1Y211aLj6gXCNpdHBfnNkUyLDdbUabb",
};
function stub() {
  const calls: { path: string; body?: { dry?: boolean } }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: u.pathname, body });
    if (u.pathname === "/v0/tokens") return new Response(JSON.stringify(TOKENS));
    return new Response(JSON.stringify({ signature: "s", quote: {
      amountIn: "40000000", amountInFormatted: "40", amountInUsd: "40", amountOut: "250000000", amountOutFormatted: "0.25",
      amountOutUsd: "39.6", minAmountOut: "247500000", timeEstimate: 22, ...(body?.dry ? {} : { depositAddress: "0x00000000000000000000000000000000000000d1" }) } }));
  };
  return { calls, fetch };
}
const venue = (fetch: ReturnType<typeof stub>["fetch"], exec = false) =>
  new NearIntentsVenue({ ...nearIntentsConfigFromEnv({ NEAR_INTENTS_ENABLED: "true", NEAR_INTENTS_EXECUTION_ENABLED: exec ? "1" : "" }), fetch });

test("defaults: venue and execution off", () => {
  const c = nearIntentsConfigFromEnv({});
  assert.equal(c.enabled, false);
  assert.equal(c.executionEnabled, false);
});

test("chain keys round-trip", () => {
  for (const k of Object.keys(CHAIN_TO_ONECLICK) as XauChainKey[]) assert.equal(fromOneClickChain(toOneClickChain(k)), k);
});

test("quote is dry; build is refused unless execution is enabled and confirmed", async () => {
  const s = stub();
  const h = createNearIntentsHandlers(venue(s.fetch), { newId: () => "r1" });
  assert.equal((await h.quote(input)).status, 200);
  assert.equal((await h.build({ quoteRef: "r1", confirm: true })).status, 403);
  assert.ok(s.calls.filter((c) => c.path === "/v0/quote").every((c) => c.body?.dry === true));
});

test("enabled + confirmed build returns an unsigned ERC-20 transfer", async () => {
  const s = stub();
  const h = createNearIntentsHandlers(venue(s.fetch, true), { newId: () => "r1" });
  await h.quote(input);
  const r = await h.build({ quoteRef: "r1", confirm: true });
  assert.equal(r.status, 200);
  const dep = (r.json as { deposit: { evm: { to: string; data: string } } }).deposit;
  assert.equal(dep.evm.to, input.tokenIn);
  assert.equal(dep.evm.data, erc20TransferData("0x00000000000000000000000000000000000000d1", "40000000"));
});

test("user copy never names a venue", () => {
  for (const m of Object.values(USER_ERRORS)) assert.doesNotMatch(m, /near|1click|intents|bridge/i);
});
