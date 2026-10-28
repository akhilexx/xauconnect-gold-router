// Tests for src/xauconnect/near-intents-xau.ts, shipped as backend/src/services/routing/near-intents-xau.ts.
// Request/quote/build shapes mirror @xauconnect/utils schemas.ts at public main 73c354c.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NearIntentsVenue, nearIntentsConfigFromEnv, type NearIntentsConfig } from "../src/xauconnect/near-intents.ts";
import {
  createXauNearIntentsHandlers, normalizeNearIntentsStatus, toVenueInput, toXauBuild, type XauCrossChainQuoteRequest,
  type XauNearIntentsBuild, type XauNearIntentsQuote,
} from "../src/xauconnect/near-intents-xau.ts";
import { EVM_ADDR, SOL_WALLET, USDC_ARB, stubFetch } from "./helpers.ts";

const T0 = 1_800_000_000_000;
const DEP = "0x00000000000000000000000000000000000000d1";
function venue(f: NearIntentsConfig["fetch"], over: Partial<NearIntentsConfig> = {}) {
  return new NearIntentsVenue({ ...nearIntentsConfigFromEnv({ NEAR_INTENTS_ENABLED: "true" }), fetch: f, now: () => T0, ...over });
}
const q = (o: Record<string, unknown> = {}) => ({
  amountIn: "40000000", amountInFormatted: "40", amountInUsd: "40.00", amountOut: "250000000", amountOutFormatted: "0.25",
  amountOutUsd: "39.60", minAmountOut: "247500000", timeEstimate: 22, ...o,
});
const xreq: XauCrossChainQuoteRequest = {
  fromChainKey: "arbitrum", toChainKey: "solana", tokenIn: USDC_ARB, tokenOut: "native", amountIn: "40000000",
  slippageBps: 100, taker: EVM_ADDR, takerDestination: SOL_WALLET,
};
type Err = { error: { code: string; message: string } };

test("xau: CrossChainQuoteRequest maps to venue input; cross-family needs takerDestination", () => {
  assert.deepEqual(toVenueInput(xreq), {
    fromChain: "arbitrum", toChain: "solana", tokenIn: USDC_ARB, tokenOut: "native", amount: "40000000",
    swapType: "EXACT_INPUT", slippageBps: 100, sender: EVM_ADDR, recipient: SOL_WALLET,
  });
  assert.equal(toVenueInput({ ...xreq, toChainKey: "base", takerDestination: undefined }).recipient, EVM_ADDR);
  assert.throws(() => toVenueInput({ ...xreq, takerDestination: undefined }), /recipient/);
});

test("xau: quote returns the XAUConnect CrossChainQuote shape, dry, labelled XAU Route", async () => {
  const s = stubFetch(() => q());
  const h = createXauNearIntentsHandlers(venue(s.f), { now: () => T0, newId: () => "ref1" });
  const r = await h.quote(xreq);
  assert.equal(r.status, 200);
  const { crossChainQuote: quote, quoteRef, quote: vq } = r.json as { crossChainQuote: XauNearIntentsQuote; quoteRef: string; quote: { routeLabel: string } };
  assert.equal(vq.routeLabel, "XAU Route");
  assert.equal(quoteRef, "ref1");
  assert.equal(quote.provider, "near-intents");
  assert.equal(quote.bridgeName, "XAU Route");
  assert.deepEqual([quote.amountIn, quote.amountOut, quote.minAmountOut, quote.protocolFee, quote.protocolFeeBps],
    ["40000000", "250000000", "247500000", "0", 0]);
  assert.equal(quote.routeId, "near-intents:ref1");
  assert.deepEqual(quote.steps.map((x) => x.id), ["deposit", "settle", "deliver"]);
  assert.ok(!JSON.stringify(quote.steps).match(/near|1click|defuse/i), "step labels never name the venue");
  assert.equal(s.quotes()[0]!.body!.dry, true);
});

test("xau: same chain, bad address and disabled use the backend error envelope", async () => {
  const s = stubFetch(() => q());
  const h = createXauNearIntentsHandlers(venue(s.f), { now: () => T0 });
  const same = await h.quote({ ...xreq, toChainKey: "arbitrum" });
  assert.deepEqual([same.status, (same.json as Err).error.code], [422, "NEAR_INTENTS_NO_ROUTE"]);
  const bad = await h.quote({ ...xreq, takerDestination: "0xnope" });
  assert.deepEqual([bad.status, (bad.json as Err).error.code], [400, "NEAR_INTENTS_INVALID_ADDRESS"]);
  const off = createXauNearIntentsHandlers(venue(s.f, { enabled: false }));
  const d = await off.quote(xreq);
  assert.deepEqual([d.status, (d.json as Err).error.code], [503, "NEAR_INTENTS_DISABLED"]);
  assert.ok(!/NEAR_INTENTS_ENABLED|1Click/.test((d.json as Err).error.message), "no env names or venue in user copy");
});

test("xau: build is gated (execution flag + confirm) and returns evm {to,data,value,chainId}", async () => {
  const s = stubFetch((b) => (b.dry ? q() : q({ depositAddress: DEP })));
  let n = 0;
  const gated = createXauNearIntentsHandlers(venue(s.f), { now: () => T0, newId: () => `g${++n}` });
  await gated.quote(xreq);
  const g = await gated.build({ quoteRef: "g1", confirm: true });
  assert.deepEqual([g.status, (g.json as Err).error.code], [403, "NEAR_INTENTS_EXECUTION_DISABLED"]);
  assert.equal(s.quotes().filter((c) => c.body!.dry === false).length, 0);

  const h = createXauNearIntentsHandlers(venue(s.f, { executionEnabled: true }), { now: () => T0, newId: () => "r1" });
  await h.quote(xreq);
  assert.equal((await h.build({ quoteRef: "r1" })).status, 403);
  const b = await h.build({ quoteRef: "r1", confirm: true });
  assert.equal(b.status, 200);
  const built = b.json as XauNearIntentsBuild;
  assert.equal(built.provider, "near-intents");
  assert.equal(built.evm!.to.toLowerCase(), USDC_ARB);
  assert.equal(built.evm!.value, "0");
  assert.equal(built.evm!.chainId, 42161);
  assert.ok(built.evm!.data.startsWith("0xa9059cbb"));
  assert.equal(built.quoteId, DEP);
  assert.equal((await h.build({ quoteRef: "r1", confirm: true })).status, 410);
});

test("xau: Solana-origin build carries deposit instructions, no server-built tx", () => {
  const built = toXauBuild({
    venue: "near-intents", routeLabel: "XAU Route", quoteId: "DepAddr", chain: "solana", depositAddress: "DepAddr",
    amount: "1000", amountFormatted: "0.000001", minAmountOut: "1", amountOutFormatted: "0", evm: undefined,
    solana: { kind: "system-transfer", to: "DepAddr", amount: "1000", decimals: 9 },
    quote: { toChain: "base" } as never,
  });
  assert.equal(built.evm, undefined);
  assert.equal(built.solanaTransaction, undefined);
  assert.equal(built.deposit.solana!.kind, "system-transfer");
  assert.equal(built.toChainKey, "base");
});

test("xau: status maps to pending/completed/failed/unknown; REFUNDED flagged", async () => {
  const m = (status: string) => normalizeNearIntentsStatus({ status, destinationTxs: ["0xabc"] });
  for (const p of ["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT", "PROCESSING"]) assert.equal(m(p).status, "pending");
  assert.equal(m("SUCCESS").status, "completed");
  assert.equal(m("SUCCESS").destinationTxHash, "0xabc");
  assert.deepEqual([m("REFUNDED").status, m("REFUNDED").refunded], ["failed", true]);
  assert.deepEqual([m("FAILED").status, m("FAILED").refunded], ["failed", false]);
  assert.equal(m("SOMETHING_NEW").status, "unknown");
  const s = stubFetch(() => q(), { "/v0/status": { status: "SUCCESS", swapDetails: { destinationChainTxHashes: [{ hash: "0xd" }] } } });
  const h = createXauNearIntentsHandlers(venue(s.f));
  const r = await h.status(DEP);
  assert.deepEqual([r.status, (r.json as { status: string }).status, (r.json as { xauStatus: string }).xauStatus], [200, "SUCCESS", "completed"]);
  assert.equal((await h.status("")).status, 502);
});

test("xau: submitDeposit is gated and never posts without both flags", async () => {
  const s = stubFetch(() => q(), { "/v0/deposit/submit": { status: "KNOWN_DEPOSIT_TX" } });
  const off = await createXauNearIntentsHandlers(venue(s.f)).submitDeposit({ quoteId: DEP, txHash: "0x1", confirm: true });
  assert.equal(off.status, 403);
  const on = createXauNearIntentsHandlers(venue(s.f, { executionEnabled: true }));
  assert.equal((await on.submitDeposit({ quoteId: DEP, txHash: "0x1" })).status, 403);
  assert.equal(s.calls.filter((c) => c.path === "/v0/deposit/submit").length, 0);
  const ok = await on.submitDeposit({ quoteId: DEP, txHash: "0x1", confirm: true });
  assert.deepEqual([ok.status, (ok.json as { status: string }).status, (ok.json as { xauStatus: string }).xauStatus], [200, "KNOWN_DEPOSIT_TX", "pending"]);
});

test("xau: every user message survives XAUConnect's INTERNAL_MARKERS sanitizer (backend + web, 73c354c)", async () => {
  const { USER_ERRORS } = await import("../src/xauconnect/near-intents.ts");
  const backend = /RPC_|API_KEY|ROUTER_ADDRESS|\.env|configure|deploy|aggregator|ONEINCH|ZEROX|JUPITER|HELIUS|nssm|FeeCollector|AggregatorRouter|eth_call|hardhat/i;
  const web = /RPC_|API_KEY|ROUTER_ADDRESS|\.env|configure|deploy|aggregator|ONEINCH|ZEROX|JUPITER|HELIUS|nssm|FeeCollector|AggregatorRouter|hardhat/i;
  for (const m of Object.values(USER_ERRORS)) {
    assert.ok(!backend.test(m) && !web.test(m), m);
    assert.ok(!/near|1click|defuse/i.test(m), `names the venue: ${m}`);
  }
});
