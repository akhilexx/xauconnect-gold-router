import { test } from "node:test";
import assert from "node:assert/strict";
import { OneClickClient, OneClickError } from "../src/oneclick.ts";

test("client sends JWT and parses errors", async () => {
  let seenAuth = "";
  const fetch = async (_u: string, init?: RequestInit) => {
    seenAuth = (init?.headers as Record<string, string>).Authorization ?? "";
    return new Response(JSON.stringify({ message: "recipient is not valid" }), { status: 400 });
  };
  const c = new OneClickClient({ jwt: "abc", fetch });
  await assert.rejects(() => c.tokens(), (e: unknown) => e instanceof OneClickError && e.status === 400 && /recipient/.test(e.message));
  assert.equal(seenAuth, "Bearer abc");
});

test("status builds the query string", async () => {
  let url = "";
  const fetch = async (u: string) => { url = u; return new Response('{"status":"PENDING_DEPOSIT"}'); };
  const c = new OneClickClient({ fetch });
  const r = await c.status("0xabc", "memo1");
  assert.deepEqual(r, { status: "PENDING_DEPOSIT" });
  assert.equal(url, "https://1click.chaindefuser.com/v0/status?depositAddress=0xabc&depositMemo=memo1");
});
