import { test } from "node:test";
import assert from "node:assert/strict";
import { fromBaseUnits, toBaseUnits } from "../src/units.ts";

test("toBaseUnits handles whole and fractional amounts", () => {
  assert.equal(toBaseUnits("100", 6), "100000000");
  assert.equal(toBaseUnits("0.5", 6), "500000");
  assert.equal(toBaseUnits("1", 24), "1000000000000000000000000");
  assert.equal(toBaseUnits("0", 6), "0");
});
test("toBaseUnits rejects bad input", () => {
  assert.throws(() => toBaseUnits("1.1234567", 6));
  assert.throws(() => toBaseUnits("-1", 6));
  assert.throws(() => toBaseUnits("abc", 6));
});
test("fromBaseUnits round-trips", () => {
  assert.equal(fromBaseUnits("24599", 6), "0.024599");
  assert.equal(fromBaseUnits("100000000", 6), "100");
});
