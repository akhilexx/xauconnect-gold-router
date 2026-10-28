import { readFileSync } from "node:fs";
import type { Token } from "../src/types.ts";

export const TOKENS: Token[] = JSON.parse(readFileSync(new URL("../fixtures/tokens.json", import.meta.url), "utf8"));
export const EVM_ADDR = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // public, used only as a quote recipient/refund
export const SOL_WALLET = "ENobDuF4iGAmF1Y211aLj6gXCNpdHBfnNkUyLDdbUabb"; // public Solana address
export const XAUGC = "HXXMuNxDShXhK6QGd4CczTgSiXr1YqNbUdpg9rTbWj5r";
export const USDC_ARB = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
export const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export interface Call { path: string; body?: Record<string, unknown> }

/** fetch stub: records calls, serves tokens, answers /v0/quote with `quote(body)`. */
export function stubFetch(quote: (body: Record<string, unknown>) => Record<string, unknown> | Response, extra: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: u.pathname + u.search, body });
    if (u.pathname === "/v0/tokens") return new Response(JSON.stringify(TOKENS));
    if (u.pathname === "/v0/quote") {
      const r = quote(body);
      return r instanceof Response ? r : new Response(JSON.stringify({ quote: r, signature: "stub", timestamp: "t" }));
    }
    if (u.pathname in extra) return new Response(JSON.stringify(extra[u.pathname]));
    return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
  };
  return { f, calls, quotes: () => calls.filter((c) => c.path === "/v0/quote") };
}
