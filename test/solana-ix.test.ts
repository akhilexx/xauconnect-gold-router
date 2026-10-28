import { test } from "node:test";
import assert from "node:assert/strict";
import { createAtaIdempotentData, splTransferCheckedData, systemTransferData } from "../src/xauconnect/solana-deposit-ix.ts";
import { timeline } from "../src/xauconnect/status.ts";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

test("SystemProgram.Transfer data: u32 LE 2 + u64 LE lamports", () => {
  assert.equal(hex(systemTransferData(1_000_000_000n)), "02000000" + "00ca9a3b00000000");
  assert.throws(() => systemTransferData(-1n));
});

test("SPL TransferChecked data: 12 + u64 LE + decimals", () => {
  assert.equal(hex(splTransferCheckedData("1", 6)), "0c" + "0100000000000000" + "06");
  assert.equal(hex(splTransferCheckedData(18446744073709551615n, 9)), "0c" + "ffffffffffffffff" + "09");
  assert.throws(() => splTransferCheckedData(18446744073709551616n, 9));
  assert.equal(hex(createAtaIdempotentData()), "01");
});

test("status timeline copy", () => {
  assert.equal(timeline("PENDING_DEPOSIT").step, 0);
  assert.equal(timeline("PROCESSING").step, 2);
  assert.equal(timeline("SUCCESS").outcome, "delivered");
  assert.equal(timeline("REFUNDED").outcome, "refunded");
  for (const s of ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"])
    assert.doesNotMatch(timeline(s).label, /near|1click|intents|bridge/i);
});
