import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GRADUATION, RECIPES, goldCurveIntent, graduationShare } from "../src/goldcurve.ts";
import { MockOneClick } from "../src/mock.ts";
import { TokenRegistry } from "../src/registry.ts";
import { defaultPolicy } from "../src/policy.ts";
import { planRoute } from "../src/router.ts";
import type { Token } from "../src/types.ts";

const MINT = "HXXMuNxDShXhK6QGd4CczTgSiXr1YqNbUdpg9rTbWj5r"; // XAUGC, live Fair/SOL pool (public)
const WALLET = "ENobDuF4iGAmF1Y211aLj6gXCNpdHBfnNkUyLDdbUabb"; // any valid public Solana address
const EVM = "0x0000000000000000000000000000000000000001";

test("six recipes, graduation 10 SOL / 750 USDC", () => {
  assert.equal(Object.keys(RECIPES).length, 6);
  assert.deepEqual(GRADUATION, { SOL: 10, USDC: 750 });
});

test("gold curve intent delivers the recipe's quote token to the Solana wallet", () => {
  const { intent, quote, handoffUrl } = goldCurveIntent({ mint: MINT, recipe: "fair-sol", solanaWallet: WALLET, sources: [{ symbol: "USDC", chain: "arb", amount: "50", refundTo: EVM }] });
  assert.equal(quote, "SOL");
  assert.deepEqual(intent.deliveries, [{ symbol: "SOL", chain: "sol", mode: "DESTINATION_CHAIN", recipient: WALLET }]);
  assert.equal(handoffUrl, `https://xauconnect.com/token/solana/${MINT}`);
});

test("rejects bad addresses and unknown recipes", () => {
  const s = [{ symbol: "USDC", chain: "arb", amount: "1", refundTo: EVM }];
  assert.throws(() => goldCurveIntent({ mint: "0xnope", recipe: "fair-sol", solanaWallet: WALLET, sources: s }), /mint/);
  assert.throws(() => goldCurveIntent({ mint: MINT, recipe: "fair-sol", solanaWallet: "bad", sources: s }), /solanaWallet/);
  // @ts-expect-error unknown recipe
  assert.throws(() => goldCurveIntent({ mint: MINT, recipe: "turbo", solanaWallet: WALLET, sources: s }), /unknown recipe/);
});

test("graduationShare", () => {
  assert.equal(graduationShare("SOL", 8, 1), 0.5);
  assert.equal(graduationShare("SOL", 10, 1), 0);
  assert.equal(graduationShare("USDC", 0, 1500), 1);
});

test("end to end with mock: USDC on two EVM chains -> USDC on Solana for a USDC recipe", async () => {
  const tokens: Token[] = JSON.parse(readFileSync(new URL("../fixtures/tokens.json", import.meta.url), "utf8"));
  const { intent } = goldCurveIntent({ mint: MINT, recipe: "fair-usdc", solanaWallet: WALLET, sources: [
    { symbol: "USDC", chain: "arb", amount: "30", refundTo: EVM }, { symbol: "USDC", chain: "base", amount: "20", refundTo: EVM }] });
  const plan = await planRoute(intent, { client: new MockOneClick(tokens), registry: new TokenRegistry(tokens), policy: defaultPolicy });
  assert.equal(plan.legs.length, 2);
  assert.ok(plan.legs.every((l) => l.delivery.chain === "sol" && l.delivery.symbol === "USDC"));
});
