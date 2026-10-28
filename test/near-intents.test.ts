// Tests for src/xauconnect/near-intents.ts, the exact file shipped as
// backend/src/services/routing/near-intents.ts in the XAUConnect patch.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAIN_TO_ONECLICK, NearIntentsError, NearIntentsVenue, ROUTE_LABEL, USER_ERRORS, erc20TransferData,
  fromOneClickChain, nearIntentsConfigFromEnv, toOneClickChain, toUserError,
  type CrossChainQuoteInput, type NearIntentsConfig, type XauChainKey,
} from "../src/xauconnect/near-intents.ts";
import { EVM_ADDR, SOL_WALLET, USDC_ARB, USDC_SOL, stubFetch } from "./helpers.ts";

const T0 = 1_800_000_000_000;
function venue(f: NearIntentsConfig["fetch"], over: Partial<NearIntentsConfig> = {}, now = () => T0) {
  return new NearIntentsVenue({ ...nearIntentsConfigFromEnv({ NEAR_INTENTS_ENABLED: "true" }), fetch: f, now, ...over });
}
const q = (o: Record<string, unknown> = {}) => ({
  amountIn: "40000000", amountInFormatted: "40", amountInUsd: "40.00", amountOut: "250000000", amountOutFormatted: "0.25",
  amountOutUsd: "39.60", minAmountOut: "247500000", timeEstimate: 22, ...o,
});
const input: CrossChainQuoteInput = {
  fromChain: "arbitrum", toChain: "solana", tokenIn: USDC_ARB, tokenOut: "native", amount: "40000000",
  slippageBps: 100, sender: EVM_ADDR, recipient: SOL_WALLET,
};

test("chain key map round-trips XAUConnect <-> 1Click for all 7 chains", () => {
  const keys = Object.keys(CHAIN_TO_ONECLICK) as XauChainKey[];
  assert.deepEqual(keys.sort(), ["arbitrum", "avalanche", "base", "bsc", "ethereum", "polygon", "solana"]);
  for (const k of keys) assert.equal(fromOneClickChain(toOneClickChain(k)), k);
  assert.equal(toOneClickChain("polygon"), "pol");
  assert.equal(toOneClickChain("avalanche"), "avax");
  assert.throws(() => toOneClickChain("tron"), NearIntentsError);
});

test("flag defaults off and env parsing", () => {
  const c = nearIntentsConfigFromEnv({});
  assert.equal(c.enabled, false);
  assert.equal(c.executionEnabled, false);
  assert.equal(c.baseUrl, "https://1click.chaindefuser.com");
  assert.equal(nearIntentsConfigFromEnv({ NEAR_INTENTS_ENABLED: "true", NEAR_INTENTS_EXECUTION_ENABLED: "1" }).executionEnabled, true);
});

test("disabled venue makes no network calls", async () => {
  const s = stubFetch(() => q());
  const v = venue(s.f, { enabled: false });
  await assert.rejects(() => v.quote(input), (e: NearIntentsError) => e.code === "DISABLED");
  assert.equal(s.calls.length, 0);
});

test("resolves natives, ERC-20 (case-insensitive) and SPL mints", async () => {
  const v = venue(stubFetch(() => q()).f);
  assert.equal((await v.resolve("solana", "native")).assetId, "nep141:sol.omft.near");
  assert.equal((await v.resolve("solana", "So11111111111111111111111111111111111111112")).assetId, "nep141:sol.omft.near");
  assert.equal((await v.resolve("arbitrum", USDC_ARB.toUpperCase().replace("0X", "0x"))).symbol, "USDC");
  assert.equal((await v.resolve("solana", USDC_SOL)).assetId, "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near");
  assert.equal((await v.resolve("base", "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE")).assetId, "nep141:base.omft.near");
  await assert.rejects(() => v.resolve("arbitrum", "0x0000000000000000000000000000000000000bad"), (e: NearIntentsError) => e.code === "UNSUPPORTED_TOKEN");
});

test("quote is always dry and maps to an XAU Route", async () => {
  const s = stubFetch(() => q());
  const r = await venue(s.f).quote(input);
  const sent = s.quotes()[0].body!;
  assert.equal(sent.dry, true);
  assert.equal(sent.originAsset, "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near");
  assert.equal(sent.destinationAsset, "nep141:sol.omft.near");
  assert.equal(sent.refundTo, EVM_ADDR);
  assert.equal(sent.recipient, SOL_WALLET);
  assert.equal(r.routeLabel, ROUTE_LABEL);
  assert.equal(r.venue, "near-intents");
  assert.equal(r.costBps, 100);
  assert.equal(r.etaSeconds, 22);
  assert.equal(r.expiresAt - r.quotedAt, 60_000);
  assert.equal(r.request.dry, true);
});

test("build is gated: execution flag, confirm, freshness; no network call when refused", async () => {
  const s = stubFetch(() => q({ depositAddress: "0x00000000000000000000000000000000000000d1" }));
  const confirmed = await venue(s.f).quote(input);
  const before = s.calls.length;
  await assert.rejects(() => venue(s.f).build(input, confirmed, { confirm: true }), (e: NearIntentsError) => e.code === "EXECUTION_DISABLED");
  await assert.rejects(() => venue(s.f, { executionEnabled: true }).build(input, confirmed, {}), (e: NearIntentsError) => e.code === "CONFIRM_REQUIRED");
  await assert.rejects(() => venue(s.f, { executionEnabled: true }, () => T0 + 61_000).build(input, confirmed, { confirm: true }), (e: NearIntentsError) => e.code === "QUOTE_EXPIRED");
  assert.equal(s.calls.length, before);
});

test("build: one dry:false call, ERC-20 deposit as unsigned transfer calldata", async () => {
  const dep = "0x00000000000000000000000000000000000000d1";
  const s = stubFetch((b) => (b.dry ? q() : q({ depositAddress: dep, deadline: "2026-11-01T00:00:00Z" })));
  const v = venue(s.f, { executionEnabled: true });
  const confirmed = await v.quote(input);
  const ins = await v.build(input, confirmed, { confirm: true });
  assert.deepEqual(s.quotes().map((c) => c.body!.dry), [true, false]);
  assert.equal(ins.depositAddress, dep);
  assert.equal(ins.amount, "40000000");
  assert.deepEqual(ins.evm, { to: USDC_ARB, data: erc20TransferData(dep, "40000000"), value: "0" });
  assert.equal(ins.solana, undefined);
});

test("build: native EVM and Solana SPL / native deposits", async () => {
  const s = stubFetch((b) => (b.dry ? q() : q({ depositAddress: b.originAsset === "nep141:base.omft.near" ? "0x00000000000000000000000000000000000000d2" : "Dep1111111111111111111111111111111111111111" })));
  const v = venue(s.f, { executionEnabled: true });
  const native = { ...input, fromChain: "base" as const, tokenIn: "native" };
  const n = await v.build(native, await v.quote(native), { confirm: true });
  assert.deepEqual(n.evm, { to: "0x00000000000000000000000000000000000000d2", data: "0x", value: "40000000" });
  const spl = { ...input, fromChain: "solana" as const, tokenIn: USDC_SOL, toChain: "ethereum" as const, tokenOut: "0x68749665ff8d2d112fa859aa293f07a622782f38", sender: SOL_WALLET, recipient: EVM_ADDR };
  const sp = await v.build(spl, await v.quote(spl), { confirm: true });
  assert.deepEqual(sp.solana, { kind: "spl-transfer", to: "Dep1111111111111111111111111111111111111111", mint: USDC_SOL, amount: "40000000", decimals: 6 });
  const sol = { ...spl, tokenIn: "native" };
  const so = await v.build(sol, await v.quote(sol), { confirm: true });
  assert.equal(so.solana?.kind, "system-transfer");
  assert.equal(so.solana?.decimals, 9);
});

test("build aborts if the live quote is worse than the confirmed one beyond slippage", async () => {
  let live = q({ depositAddress: "0x00000000000000000000000000000000000000d1", minAmountOut: "240000000" });
  const s = stubFetch((b) => (b.dry ? q() : live));
  const v = venue(s.f, { executionEnabled: true });
  const confirmed = await v.quote(input);
  await assert.rejects(() => v.build(input, confirmed, { confirm: true }), (e: NearIntentsError) => e.code === "PRICE_MOVED");
  live = q({ depositAddress: "0x00000000000000000000000000000000000000d1", amountIn: "40000001" });
  await assert.rejects(() => v.build(input, confirmed, { confirm: true }), (e: NearIntentsError) => e.code === "AMOUNT_MISMATCH");
});

test("exact output: amountIn may rise only within slippage", async () => {
  const eo = { ...input, swapType: "EXACT_OUTPUT" as const, amount: "500000000" };
  let liveIn = "51000000";
  const s = stubFetch((b) => (b.dry ? q({ amountIn: "50000000", amountOut: "500000000", minAmountOut: "500000000" }) : q({ amountIn: liveIn, depositAddress: "0x00000000000000000000000000000000000000d1" })));
  const v = venue(s.f, { executionEnabled: true });
  const c = await v.quote(eo);
  assert.equal(s.quotes()[0].body!.swapType, "EXACT_OUTPUT");
  await assert.rejects(() => v.build(eo, c, { confirm: true }), (e: NearIntentsError) => e.code === "PRICE_MOVED");
  liveIn = "50400000";
  assert.equal((await v.build(eo, c, { confirm: true })).amount, "50400000");
});

test("upstream errors map to user copy that never names a venue", async () => {
  const cases: [string, string][] = [
    ["Amount is too low for bridge, try at least 101201", "AMOUNT_TOO_LOW"],
    ["recipient is not valid", "INVALID_ADDRESS"],
    ["tokenIn or tokenOut is not supported", "NO_ROUTE"],
    ["something else", "UPSTREAM"],
  ];
  for (const [msg, code] of cases) {
    const s = stubFetch(() => new Response(JSON.stringify({ message: msg }), { status: 400 }));
    await assert.rejects(() => venue(s.f).quote(input), (e: NearIntentsError) => e.code === code && toUserError(e) === USER_ERRORS[code as "UPSTREAM"]);
  }
  const timeout = venue(async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; });
  await assert.rejects(() => timeout.quote(input), (e: NearIntentsError) => e.code === "TIMEOUT");
  for (const m of Object.values(USER_ERRORS)) assert.doesNotMatch(m, /near|1click|intents|defuse|bridge|jupiter|1inch|meteora|raydium|uniswap/i);
});

test("status splits memo ids; submitDeposit is gated", async () => {
  const s = stubFetch(() => q(), { "/v0/status": { status: "SUCCESS", swapDetails: { destinationChainTxHashes: [{ hash: "0xabc" }] } }, "/v0/deposit/submit": { status: "KNOWN_DEPOSIT_TX" } });
  const v = venue(s.f);
  const st = await v.status("addr|m1");
  assert.equal(s.calls.at(-1)!.path, "/v0/status?depositAddress=addr&depositMemo=m1");
  assert.deepEqual([st.terminal, st.destinationTxs], [true, ["0xabc"]]);
  await assert.rejects(() => v.submitDeposit({ quoteId: "addr", txHash: "0x1", confirm: true }), (e: NearIntentsError) => e.code === "EXECUTION_DISABLED");
  const ok = await venue(s.f, { executionEnabled: true }).submitDeposit({ quoteId: "addr|m1", txHash: "0x1", confirm: true });
  assert.deepEqual(s.calls.at(-1)!.body, { txHash: "0x1", depositAddress: "addr", memo: "m1" });
  assert.equal(ok.status, "KNOWN_DEPOSIT_TX");
});

test("ERC-20 transfer calldata layout (a9059cbb, padded address, padded amount)", () => {
  const d = erc20TransferData("0x00000000000000000000000000000000000000AB", 1_000_000n);
  assert.equal(d, "0xa9059cbb" + "0".repeat(62) + "ab" + "0".repeat(59) + "f4240");
  assert.equal(d.length, 2 + 8 + 128);
  assert.throws(() => erc20TransferData("0x123", 1n), NearIntentsError);
  assert.throws(() => erc20TransferData("0x00000000000000000000000000000000000000AB", 0n), NearIntentsError);
});

test("handlers: validate input, cache quotes server-side, build once per quoteRef", async () => {
  const { createNearIntentsHandlers } = await import("../src/xauconnect/near-intents.ts");
  const s = stubFetch((b) => (b.dry ? q() : q({ depositAddress: "0x00000000000000000000000000000000000000d1" })));
  let id = 0;
  const h = createNearIntentsHandlers(venue(s.f, { executionEnabled: true }), { now: () => T0, newId: () => `ref${++id}` });
  const bad = await h.quote({ ...input, recipient: "0xnot-solana" });
  assert.deepEqual([bad.status, (bad.json as { code: string }).code], [400, "INVALID_ADDRESS"]);
  assert.equal((await h.quote({ ...input, fromChain: "tron" })).status, 400);
  const ok = await h.quote(input);
  assert.equal(ok.status, 200);
  assert.equal((ok.json as { quoteRef: string }).quoteRef, "ref1");
  assert.equal((await h.build({ quoteRef: "ref1" })).status, 403); // no confirm
  const built = await h.build({ quoteRef: "ref1", confirm: true });
  assert.equal(built.status, 200);
  assert.equal((built.json as { deposit: { amount: string } }).deposit.amount, "40000000");
  assert.equal((await h.build({ quoteRef: "ref1", confirm: true })).status, 410); // used
  assert.equal(s.quotes().filter((c) => c.body!.dry === false).length, 1);
});

test("handlers: execution disabled by default returns 403 and requests no deposit address", async () => {
  const { createNearIntentsHandlers } = await import("../src/xauconnect/near-intents.ts");
  const s = stubFetch(() => q({ depositAddress: "0x00000000000000000000000000000000000000d1" }));
  const h = createNearIntentsHandlers(venue(s.f), { now: () => T0, newId: () => "r" });
  await h.quote(input);
  const r = await h.build({ quoteRef: "r", confirm: true });
  assert.deepEqual([r.status, (r.json as { code: string }).code], [403, "EXECUTION_DISABLED"]);
  assert.equal(s.quotes().filter((c) => c.body!.dry === false).length, 0);
});
