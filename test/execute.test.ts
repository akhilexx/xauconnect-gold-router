// Backlog item 2 (router side): wallet-signed deposit flow behind confirm:true + EXECUTION_ENABLED=1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ExecutionError, PlanStore, prepareLegDeposit, submitDepositTx } from "../src/execute.ts";
import { MockOneClick } from "../src/mock.ts";
import { defaultPolicy } from "../src/policy.ts";
import { TokenRegistry } from "../src/registry.ts";
import { planRoute } from "../src/router.ts";
import type { QuoteRequest, QuoteResponse, RouteIntent } from "../src/types.ts";
import { pollStatus } from "../src/xauconnect/status.ts";
import { EVM_ADDR, SOL_WALLET, TOKENS } from "./helpers.ts";

const ON = { EXECUTION_ENABLED: "1" };
const T0 = new Date("2026-10-28T17:00:00Z");
const registry = new TokenRegistry(TOKENS);

class Recording {
  calls: QuoteRequest[] = [];
  inner = new MockOneClick(TOKENS);
  override?: (r: QuoteRequest, base: QuoteResponse) => QuoteResponse;
  async quote(r: QuoteRequest): Promise<QuoteResponse> {
    this.calls.push(r);
    const base = await this.inner.quote(r);
    return this.override ? this.override(r, base) : base;
  }
}

async function setup(intent: RouteIntent = {
  sources: [{ symbol: "USDC", chain: "arb", amount: "40", refundTo: EVM_ADDR }, { symbol: "USDC", chain: "sol", amount: "25", refundTo: SOL_WALLET }],
  deliveries: [{ symbol: "XAUT", chain: "eth", mode: "DESTINATION_CHAIN", recipient: EVM_ADDR }],
  slippageBps: 100,
}) {
  const client = new Recording();
  const plan = await planRoute(intent, { client, registry, policy: defaultPolicy, now: () => T0 });
  const store = new PlanStore();
  store.put(plan);
  client.calls = [];
  return { client, plan, store, deps: (env: Record<string, string | undefined> = ON, at = T0) => ({ client, registry, policy: defaultPolicy, env, now: () => at }) };
}
const code = (c: string) => (e: unknown) => e instanceof ExecutionError && e.code === c;

test("execute refuses without confirm:true and without EXECUTION_ENABLED=1, before any quote", async () => {
  const { client, plan, store, deps } = await setup();
  await assert.rejects(() => prepareLegDeposit(store, plan.intentId, 0, {}, deps()), code("CONFIRM_REQUIRED"));
  await assert.rejects(() => prepareLegDeposit(store, plan.intentId, 0, { confirm: "true" }, deps()), code("CONFIRM_REQUIRED"));
  await assert.rejects(() => prepareLegDeposit(store, plan.intentId, 0, { confirm: true }, deps({})), code("EXECUTION_DISABLED"));
  await assert.rejects(() => prepareLegDeposit(store, plan.intentId, 0, { confirm: true }, deps({ EXECUTION_ENABLED: "true" })), code("EXECUTION_DISABLED"));
  assert.equal(client.calls.length, 0);
});

test("execute requests dry:false once per leg, for exactly the plan amount", async () => {
  const { client, plan, store, deps } = await setup();
  const d = await prepareLegDeposit(store, plan.intentId, 0, { confirm: true }, deps());
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].dry, false);
  assert.equal(client.calls[0].amount, "40000000");
  assert.equal(d.amount, "40000000");
  assert.equal(d.requoted, false);
  await assert.rejects(() => prepareLegDeposit(store, plan.intentId, 0, { confirm: true }, deps()), code("ALREADY_PREPARED"));
  assert.equal(client.calls.length, 1);
  // a 1Click answer asking for more than the plan aborts
  client.override = (_r, b) => ({ ...b, quote: { ...b.quote, amountIn: "25000001" } });
  await assert.rejects(() => prepareLegDeposit(store, plan.intentId, 1, { confirm: true }, deps()), code("AMOUNT_MISMATCH"));
});

test("ERC-20 leg returns unsigned transfer calldata to the token contract; Solana leg returns SPL TransferChecked data", async () => {
  const { plan, store, deps } = await setup();
  const evm = await prepareLegDeposit(store, plan.intentId, 0, { confirm: true }, deps());
  const dep = evm.depositAddress.slice(2).toLowerCase();
  assert.equal(evm.evm!.to, "0xaf88d065e77c8cc2239327c5edb3a432268e5831");
  assert.equal(evm.evm!.value, "0");
  assert.equal(evm.evm!.data, "0xa9059cbb" + dep.padStart(64, "0") + (40_000_000).toString(16).padStart(64, "0"));
  const sol = await prepareLegDeposit(store, plan.intentId, 1, { confirm: true }, deps());
  assert.equal(sol.solana!.kind, "spl-transfer");
  assert.equal(sol.solana!.mint, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  assert.equal(sol.solana!.dataHex, "0c" + "40787d0100000000" + "06"); // 25_000_000 LE, 6 decimals
});

test("stale plan (>60s) is re-quoted dry first; minAmountOut worse than slippage aborts", async () => {
  const { client, plan, store, deps } = await setup();
  const late = new Date(T0.getTime() + 61_000);
  const ok = await prepareLegDeposit(store, plan.intentId, 0, { confirm: true }, deps(ON, late));
  assert.deepEqual(client.calls.map((c) => c.dry), [true, false]);
  assert.equal(ok.requoted, true);
  client.calls = [];
  client.override = (r, b) => (r.dry ? { ...b, quote: { ...b.quote, minAmountOut: "1" } } : b);
  await assert.rejects(() => prepareLegDeposit(store, plan.intentId, 1, { confirm: true }, deps(ON, late)), code("PRICE_MOVED"));
  assert.deepEqual(client.calls.map((c) => c.dry), [true]); // never reached dry:false
});

test("fresh plan: live minAmountOut below plan amountOut minus slippage aborts", async () => {
  const { plan, store, deps, client } = await setup();
  client.override = (_r, b) => ({ ...b, quote: { ...b.quote, minAmountOut: String(BigInt(plan.legs[0].amountOut) * 98n / 100n) } });
  await assert.rejects(() => prepareLegDeposit(store, plan.intentId, 0, { confirm: true }, deps()), code("PRICE_MOVED"));
});

test("policy limits are re-checked at execute time", async () => {
  const { client, plan, store } = await setup();
  const tight = { ...defaultPolicy, maxUsdPerLeg: 10 };
  await assert.rejects(() => prepareLegDeposit(store, plan.intentId, 0, { confirm: true }, { client, registry, policy: tight, env: ON, now: () => T0 }), code("POLICY"));
  const noGold = { ...defaultPolicy, allowedOutputSymbols: ["USDC"] };
  await assert.rejects(() => prepareLegDeposit(store, plan.intentId, 0, { confirm: true }, { client, registry, policy: noGold, env: ON, now: () => T0 }), code("POLICY"));
  assert.equal(client.calls.length, 0);
});

test("unknown plan or leg", async () => {
  const { plan, store, deps } = await setup();
  await assert.rejects(() => prepareLegDeposit(store, "00000000-0000-0000-0000-000000000000", 0, { confirm: true }, deps()), code("UNKNOWN_PLAN"));
  await assert.rejects(() => prepareLegDeposit(store, plan.intentId, 9, { confirm: true }, deps()), code("UNKNOWN_LEG"));
});

test("deposit submit is gated the same way", async () => {
  let called = 0;
  const client = { depositSubmit: async () => { called++; return { status: "KNOWN_DEPOSIT_TX" }; } };
  await assert.rejects(() => submitDepositTx({ txHash: "0x1", depositAddress: "0x2" }, { client, env: ON }), code("CONFIRM_REQUIRED"));
  await assert.rejects(() => submitDepositTx({ txHash: "0x1", depositAddress: "0x2", confirm: true }, { client, env: {} }), code("EXECUTION_DISABLED"));
  assert.equal(called, 0);
  assert.equal((await submitDepositTx({ txHash: "0x1", depositAddress: "0x2", confirm: true }, { client, env: ON })).status, "KNOWN_DEPOSIT_TX");
});

test("status poller stops on SUCCESS / REFUNDED / FAILED and survives transient errors", async () => {
  for (const end of ["SUCCESS", "REFUNDED", "FAILED"]) {
    const seq = ["PENDING_DEPOSIT", "ERR", "KNOWN_DEPOSIT_TX", "PROCESSING", end, "SHOULD_NOT_REACH"];
    let i = 0;
    const seen: string[] = [];
    const r = await pollStatus(async () => { const s = seq[i++]; if (s === "ERR") throw new Error("503"); return { status: s }; },
      { sleep: async () => {}, onUpdate: (s) => seen.push(s) });
    assert.deepEqual(r, { status: end, polls: 5, terminal: true });
    assert.deepEqual(seen, ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", end]);
  }
  const r = await pollStatus(async () => ({ status: "PENDING_DEPOSIT" }), { sleep: async () => {}, maxPolls: 3 });
  assert.deepEqual(r, { status: "PENDING_DEPOSIT", polls: 3, terminal: false });
  const ac = new AbortController(); ac.abort();
  assert.equal((await pollStatus(async () => ({ status: "X" }), { signal: ac.signal })).polls, 0);
});
