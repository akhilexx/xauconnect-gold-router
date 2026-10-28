// Backlog item 3: "Fund from another chain" for Gold Curve pools.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GRADUATION, QUOTE_TOKEN_ADDRESS, RECIPES, graduationCheck, planFunding, recipeFromConfig, toBase } from "../src/xauconnect/fund-curve.ts";
import { NearIntentsVenue, nearIntentsConfigFromEnv } from "../src/xauconnect/near-intents.ts";
import { mockFetch } from "../src/mock.ts";
import { EVM_ADDR, SOL_WALLET, TOKENS, USDC_ARB, XAUGC } from "./helpers.ts";

test("pool config -> recipe -> quote token for all six configs", () => {
  const expected: Record<string, string> = {
    "fair-sol": "SOL", "fair-usdc": "USDC", "shield-sol": "SOL", "shield-usdc": "USDC", "distribute-sol": "SOL", "distribute-usdc": "USDC",
  };
  assert.equal(Object.keys(RECIPES).length, 6);
  for (const [id, r] of Object.entries(RECIPES)) {
    const got = recipeFromConfig(r.config);
    assert.deepEqual(got, { id, quote: expected[id] });
    const plan = planFunding({ mint: XAUGC, poolConfig: r.config, connectedWallet: SOL_WALLET, from: { chain: "arbitrum", token: USDC_ARB, sender: EVM_ADDR }, spend: "40000000" });
    assert.equal(plan.body.tokenOut, QUOTE_TOKEN_ADDRESS[expected[id] as "SOL"]);
  }
  assert.throws(() => recipeFromConfig("11111111111111111111111111111111"), /not a Gold Curve recipe/);
});

test("funding above the remaining graduation distance produces a warning", () => {
  assert.deepEqual(GRADUATION, { SOL: 10, USDC: 750 });
  assert.equal(graduationCheck("SOL", 9.8, 0.5).remaining, 0.2);
  assert.match(graduationCheck("SOL", 9.8, 0.5).warning ?? "", /Only 0.2 SOL is left/);
  assert.equal(graduationCheck("SOL", 9.8, 0.1).warning, undefined);
  assert.equal(graduationCheck("SOL", 8, 1).share, 0.5);
  assert.match(graduationCheck("USDC", 750, 1).warning ?? "", /already reached graduation/);
  const p = planFunding({ mint: XAUGC, recipe: "fair-usdc", connectedWallet: SOL_WALLET, from: { chain: "base", token: "native", sender: EVM_ADDR }, want: "100", raisedSoFar: 700 });
  assert.match(p.graduation?.warning ?? "", /Only 50 USDC/);
});

test("want -> EXACT_OUTPUT body delivering to the connected wallet only", () => {
  const p = planFunding({ mint: XAUGC, recipe: "fair-sol", connectedWallet: SOL_WALLET, from: { chain: "arbitrum", token: USDC_ARB, sender: EVM_ADDR }, want: "0.5" });
  assert.deepEqual(p.body, { fromChain: "arbitrum", toChain: "solana", tokenIn: USDC_ARB, tokenOut: "native", amount: "500000000", swapType: "EXACT_OUTPUT", slippageBps: 100, sender: EVM_ADDR, recipient: SOL_WALLET });
  assert.equal(p.handoffPath, `/token/solana/${XAUGC}`);
  assert.throws(() => planFunding({ mint: XAUGC, recipe: "fair-sol", connectedWallet: "", from: { chain: "arbitrum", token: USDC_ARB, sender: EVM_ADDR }, want: "1" }), /connect a Solana wallet/);
  assert.throws(() => planFunding({ mint: XAUGC, recipe: "fair-sol", connectedWallet: SOL_WALLET, from: { chain: "arbitrum", token: USDC_ARB, sender: EVM_ADDR }, want: "1", spend: "1" }), /exactly one/);
  assert.throws(() => planFunding({ mint: XAUGC, recipe: "fair-sol", connectedWallet: SOL_WALLET, from: { chain: "solana", token: "native", sender: SOL_WALLET }, want: "1" }), /already hold SOL/);
  assert.equal(toBase("1.5", 6), "1500000");
  assert.throws(() => toBase("1.1234567", 6), /decimals/);
});

test("end to end (mock fetch): plan -> venue dry quote delivers >= wanted SOL", async () => {
  const v = new NearIntentsVenue({ ...nearIntentsConfigFromEnv({ NEAR_INTENTS_ENABLED: "true" }), fetch: mockFetch(TOKENS) });
  const p = planFunding({ mint: XAUGC, recipe: "fair-sol", connectedWallet: SOL_WALLET, from: { chain: "arbitrum", token: USDC_ARB, sender: EVM_ADDR }, want: "0.5" });
  const q = await v.quote(p.body);
  assert.equal(q.amountOut, "500000000");
  assert.equal(q.minAmountOut, "500000000");
  assert.ok(BigInt(q.amountIn) > 0n);
  assert.equal(q.routeLabel, "XAU Route");
});
