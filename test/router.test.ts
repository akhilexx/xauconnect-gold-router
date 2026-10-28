import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MockOneClick } from "../src/mock.ts";
import { TokenRegistry } from "../src/registry.ts";
import { defaultPolicy } from "../src/policy.ts";
import { planRoute } from "../src/router.ts";
import type { QuoteRequest, Token } from "../src/types.ts";

const tokens: Token[] = JSON.parse(readFileSync(new URL("../fixtures/tokens.json", import.meta.url), "utf8"));
const registry = new TokenRegistry(tokens);
const EVM = "0x0000000000000000000000000000000000000001";

test("plans one leg per source and picks the cheaper delivery", async () => {
  const seen: QuoteRequest[] = [];
  const mock = new MockOneClick(tokens);
  const client = { quote: (r: QuoteRequest) => { seen.push(r); return mock.quote(r); } };
  const plan = await planRoute(
    {
      sources: [
        { symbol: "USDC", chain: "arb", amount: "100", refundTo: EVM },
        { symbol: "USDT", chain: "eth", amount: "60", refundTo: EVM },
      ],
      deliveries: [
        { symbol: "XAUT", chain: "eth", mode: "DESTINATION_CHAIN", recipient: EVM },
        { symbol: "XAUT", chain: "eth", mode: "INTENTS", recipient: "alice.near" },
      ],
    },
    { client, registry, policy: defaultPolicy },
  );
  assert.equal(seen.length, 4);
  assert.ok(seen.every((r) => r.dry === true), "every quote must be a dry run");
  assert.equal(plan.legs.length, 2);
  assert.ok(plan.legs.every((l) => l.delivery.mode === "INTENTS"), "mock makes INTENTS delivery cheaper");
  assert.equal(plan.alternatives.length, 2);
  assert.equal(plan.legs[0].source.symbol, "USDC");
  assert.ok(plan.totals.amountOutUsd < plan.totals.amountInUsd);
  assert.equal(seen[0].amount, "100000000");
});

test("policy blocks oversized legs and disallowed outputs before quoting", async () => {
  let calls = 0;
  const mock = new MockOneClick(tokens);
  const client = { quote: (r: QuoteRequest) => { calls++; return mock.quote(r); } };
  const plan = await planRoute(
    {
      sources: [
        { symbol: "USDC", chain: "arb", amount: "999999", refundTo: EVM },
        { symbol: "USDC", chain: "base", amount: "10", refundTo: EVM },
      ],
      deliveries: [
        { symbol: "ETH", chain: "eth", mode: "DESTINATION_CHAIN", recipient: EVM },
        { symbol: "XAUT", chain: "eth", mode: "DESTINATION_CHAIN", recipient: EVM },
      ],
    },
    { client, registry, policy: defaultPolicy },
  );
  assert.equal(plan.rejected.length, 1);
  assert.match(plan.rejected[0].reason, /exceeds policy max/);
  assert.equal(calls, 1, "only the allowed XAUT delivery for the small leg is quoted");
  assert.ok(plan.failures.some((f) => /not allowed by policy/.test(f.error)));
  assert.equal(plan.legs.length, 1);
});

test("slippage is capped by policy and expensive quotes are rejected", async () => {
  const seen: QuoteRequest[] = [];
  const mock = new MockOneClick(tokens, () => 500); // 5% cost
  const client = { quote: (r: QuoteRequest) => { seen.push(r); return mock.quote(r); } };
  const plan = await planRoute(
    {
      sources: [{ symbol: "USDC", chain: "arb", amount: "50", refundTo: EVM }],
      deliveries: [{ symbol: "XAUT", chain: "eth", mode: "DESTINATION_CHAIN", recipient: EVM }],
      slippageBps: 900,
    },
    { client, registry, policy: defaultPolicy },
  );
  assert.equal(seen[0].slippageTolerance, defaultPolicy.maxSlippageBps);
  assert.equal(plan.legs.length, 0);
  assert.match(plan.failures[0].error, /cost 5\d\d bps exceeds/);
});

test("unsupported tokens and API errors surface as failures, not crashes", async () => {
  const client = { quote: async () => { throw new Error("recipient is not valid"); } };
  const plan = await planRoute(
    {
      sources: [
        { symbol: "DOGE", chain: "arb", amount: "1", refundTo: EVM },
        { symbol: "USDC", chain: "arb", amount: "1", refundTo: EVM },
      ],
      deliveries: [{ symbol: "XAUT", chain: "eth", mode: "DESTINATION_CHAIN", recipient: "bad" }],
    },
    { client, registry, policy: defaultPolicy },
  );
  assert.match(plan.rejected[0].reason, /not supported/);
  assert.equal(plan.failures[0].error, "recipient is not valid");
  assert.equal(plan.legs.length, 0);
});
