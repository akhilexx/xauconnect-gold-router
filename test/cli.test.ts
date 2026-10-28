import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli.ts";

test("parseArgs resolves recipients and refunds from env", () => {
  const env = { REFUND_EVM: "0xR", RECIPIENT_EVM: "0xD", NEAR_ACCOUNT: "me.near", REFUND_SOL: "SoLaddr" };
  const { intent } = parseArgs(["--from", "10:USDC:arb", "--from", "5:USDC:sol", "--to", "XAUT:eth", "--to", "XAUT:eth:INTENTS"], env);
  assert.equal(intent.sources[0].refundTo, "0xR");
  assert.equal(intent.sources[1].refundTo, "SoLaddr");
  assert.equal(intent.deliveries[0].recipient, "0xD");
  assert.equal(intent.deliveries[1].recipient, "me.near");
});

test("parseArgs explains missing addresses", () => {
  assert.throws(() => parseArgs(["--from", "10:USDC:sol", "--to", "XAUT:eth"], {}), /REFUND_SOL/);
});
