// Backlog item 4 (R side): XAUConnect same-chain quote as a comparison provider.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MockOneClick, mockXauFetch } from "../src/mock.ts";
import { TokenRegistry } from "../src/registry.ts";
import { defaultPolicy } from "../src/policy.ts";
import { planRoute } from "../src/router.ts";
import { PlanStore, prepareLegDeposit, ExecutionError } from "../src/execute.ts";
import { mapXauQuote, XauConnectQuoteProvider, xauProviderFromEnv, type LegContext, type QuoteProvider } from "../src/xauconnect-quote.ts";
import type { QuoteRequest, RouteOption } from "../src/types.ts";
import { TOKENS, EVM_ADDR } from "./helpers.ts";

const registry = new TokenRegistry(TOKENS);
const USDT = registry.resolve("USDT", "eth");
const XAUT = registry.resolve("XAUT", "eth");
const fixture = JSON.parse(readFileSync(new URL("../fixtures/xauconnect-quote-usdt-xaut-eth.json", import.meta.url), "utf8"));
const src = { symbol: "USDT", chain: "eth", amount: "100", refundTo: EVM_ADDR };
const wallet = { symbol: "XAUT", chain: "eth", mode: "DESTINATION_CHAIN" as const, recipient: EVM_ADDR };
const ctx: LegContext = { source: src, delivery: wallet, inToken: USDT, outToken: XAUT, slippageBps: 50 };

test("XAUConnect /api/swap/quote fixture maps to RouteOption provider=xauconnect", () => {
  const o = mapXauQuote(fixture, ctx);
  assert.equal(o.provider, "xauconnect");
  assert.equal(o.amountOut, "24673"); // best.amountOutAfterFee: net of the XAUConnect protocol fee
  assert.equal(o.amountOutFormatted, "0.024673");
  assert.equal(o.minAmountOut, "24549");
  assert.equal(o.originAsset, USDT.assetId);
  assert.equal(o.destinationAsset, XAUT.assetId);
  assert.equal(o.handoffUrl, "https://xauconnect.com/swap");
  const usdIn = 100 * USDT.price, usdOut = 0.024673 * XAUT.price;
  assert.equal(o.costBps, Math.round(((usdIn - usdOut) / usdIn) * 10_000));
  assert.doesNotMatch(JSON.stringify(o), /Venue A|venue-a/, "venue names are dropped");
  assert.throws(() => mapXauQuote({ ...fixture, best: null }, ctx), /no same-chain route/);
  assert.throws(() => mapXauQuote({ ...fixture, best: { ...fixture.best, simulated: true } }, ctx), /simulated/);
});

test("provider sends XAUConnect's QuoteRequest shape with X-Client-Source: agent, same-chain wallet legs only", async () => {
  const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const p = new XauConnectQuoteProvider({
    fetch: async (url, init) => {
      seen.push({ url, headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(fixture));
    },
  });
  const o = await p.quote(ctx);
  assert.equal(o.amountOut, "24673");
  assert.equal(seen[0]!.url, "https://xauconnect.com/api/swap/quote");
  assert.equal(seen[0]!.headers["X-Client-Source"], "agent");
  assert.deepEqual(seen[0]!.body, { chainKey: "ethereum", tokenIn: USDT.contractAddress, tokenOut: XAUT.contractAddress, amountIn: "100000000", slippageBps: 50 });
  assert.equal(p.supports({ ...ctx, delivery: { ...wallet, mode: "INTENTS", recipient: "a.near" } }), false);
  assert.equal(p.supports({ ...ctx, source: { ...src, chain: "arb", symbol: "USDC" }, inToken: registry.resolve("USDC", "arb") }), false);
  assert.equal(xauProviderFromEnv({}), null, "off by default");
  assert.ok(xauProviderFromEnv({ XAUCONNECT_COMPARE: "1" }));
});

test("router ranks mixed providers by cost, then ETA", async () => {
  const near = new MockOneClick(TOKENS); // wallet delivery: 60 bps in the mock
  const xau = new XauConnectQuoteProvider({ fetch: mockXauFetch(TOKENS, 40) });
  const plan = await planRoute(
    { sources: [src, { symbol: "USDC", chain: "arb", amount: "50", refundTo: EVM_ADDR }], deliveries: [wallet] },
    { client: near, registry, policy: defaultPolicy, providers: [xau] },
  );
  assert.equal(plan.legs.length, 2);
  assert.equal(plan.legs[0]!.provider, "xauconnect", "40 bps beats 60 bps on the same-chain leg");
  assert.equal(plan.legs[1]!.provider, "near-intents-1click", "cross-chain leg is NEAR Intents only");
  assert.deepEqual(plan.alternatives.map((a) => a.provider), ["near-intents-1click"]);

  // Equal cost: the faster option wins.
  const fixed = (eta: number, sig: string): QuoteProvider => ({
    id: "xauconnect", supports: () => true,
    quote: async (c) => ({ ...mapXauQuote(fixture, c), costBps: 10, timeEstimateSec: eta, signature: sig }) as RouteOption,
  });
  const tie = await planRoute({ sources: [src], deliveries: [wallet] }, {
    client: near, registry, policy: defaultPolicy, providers: [fixed(300, "slow"), fixed(5, "fast")],
  });
  assert.equal(tie.legs[0]!.signature, "fast");
  assert.equal(tie.alternatives[0]!.signature, "slow");
});

test("XAUConnect timeout becomes a failure entry and does not block NEAR Intents legs", async () => {
  const hang = new XauConnectQuoteProvider({
    timeoutMs: 50,
    fetch: (_u, init) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted")))),
  });
  const t0 = Date.now();
  const plan = await planRoute({ sources: [src], deliveries: [wallet] }, { client: new MockOneClick(TOKENS), registry, policy: defaultPolicy, providers: [hang] });
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(plan.legs.length, 1);
  assert.equal(plan.legs[0]!.provider, "near-intents-1click");
  assert.equal(plan.failures.length, 1);
  assert.equal(plan.failures[0]!.provider, "xauconnect");
  assert.match(plan.failures[0]!.error, /timed out after 50 ms/);
  const http500 = new XauConnectQuoteProvider({ fetch: async () => new Response("{}", { status: 500 }) });
  const p2 = await planRoute({ sources: [src], deliveries: [wallet] }, { client: new MockOneClick(TOKENS), registry, policy: defaultPolicy, providers: [http500] });
  assert.equal(p2.legs[0]!.provider, "near-intents-1click");
  assert.match(p2.failures[0]!.error, /HTTP 500/);
});

test("execute refuses an xauconnect leg (hand-off only) before any 1Click call", async () => {
  let calls = 0;
  const near = new MockOneClick(TOKENS);
  const client = { quote: async (r: QuoteRequest) => { calls++; return near.quote(r); } };
  const xau = new XauConnectQuoteProvider({ fetch: mockXauFetch(TOKENS, 40) });
  const plan = await planRoute({ sources: [src], deliveries: [wallet] }, { client, registry, policy: defaultPolicy, providers: [xau] });
  assert.equal(plan.legs[0]!.provider, "xauconnect");
  const store = new PlanStore(); store.put(plan);
  const before = calls;
  await assert.rejects(
    prepareLegDeposit(store, plan.intentId, 0, { confirm: true }, { client, registry, policy: defaultPolicy, env: { EXECUTION_ENABLED: "1" } }),
    (e: unknown) => e instanceof ExecutionError && e.code === "HANDOFF_ONLY" && /xauconnect\.com\/swap/.test(e.message),
  );
  assert.equal(calls, before, "no 1Click call for a hand-off leg");
});
