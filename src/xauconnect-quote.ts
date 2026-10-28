// XAUConnect same-chain quote as a comparison provider for the router (backlog item 4, R side).
//
// For a leg whose source and delivery are on the same chain (e.g. USDT@eth -> XAUT@eth, delivered to a
// wallet), XAUConnect's own aggregator may beat a NEAR Intents round trip. This module asks
//   POST {XAUCONNECT_BASE_URL}/api/swap/quote   headers: X-Client-Source: agent
// with XAUConnect's QuoteRequest shape (packages/utils/src/schemas.ts at public main 73c354c:
// chainKey, tokenIn, tokenOut, amountIn in base units, slippageBps) and maps the AggregatedQuote
// (best.amountOutAfterFee, minAmountOut) to a RouteOption with provider "xauconnect".
//
// Read-only: the router never builds or executes these legs. An xauconnect leg is a hand-off to
// https://xauconnect.com/swap, where the user's own wallet signs; /v1/routes/:id/execute refuses it.
// Each quote has its own timeout (default 5 s), so a slow XAUConnect never holds back NEAR Intents legs.
// Venue/DEX names from the response are dropped: user-facing text says "XAU Route" only.

import type { FetchLike } from "./oneclick.ts";
import type { Delivery, RouteOption, Source, Token } from "./types.ts";
import { fromBaseUnits, toBaseUnits } from "./units.ts";

/** 1Click blockchain key -> XAUConnect chainKey (same-chain quotes only). */
export const XAU_CHAIN_KEY: Record<string, string> = {
  eth: "ethereum", arb: "arbitrum", base: "base", bsc: "bsc", pol: "polygon", avax: "avalanche", sol: "solana",
};

/** Subset of XAUConnect's AggregatedQuote that this mapper reads. */
export interface XauAggregatedQuote {
  best: { amountOut: string; amountOutAfterFee: string; protocolFee?: string; priceImpactBps?: number; simulated?: boolean; executable?: boolean } | null;
  quotes?: unknown[];
  protocolFeeBps?: number;
  minAmountOut: string | null;
  quotedAt?: number;
}

export interface LegContext { source: Source; delivery: Delivery; inToken: Token; outToken: Token; slippageBps: number }

/** A quote provider the router can fan out to in addition to NEAR Intents. */
export interface QuoteProvider {
  readonly id: RouteOption["provider"];
  supports(ctx: LegContext): boolean;
  quote(ctx: LegContext): Promise<RouteOption>;
}

export interface XauConnectQuoteOptions { baseUrl?: string; fetch?: FetchLike; timeoutMs?: number; etaSec?: number }

export class XauConnectQuoteProvider implements QuoteProvider {
  readonly id = "xauconnect" as const;
  readonly baseUrl: string;
  private f: FetchLike;
  private timeoutMs: number;
  private etaSec: number;
  constructor(opts: XauConnectQuoteOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://xauconnect.com").replace(/\/$/, "");
    this.f = opts.fetch ?? ((u, i) => fetch(u, i));
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.etaSec = opts.etaSec ?? 30; // one same-chain transaction; XAUConnect quotes carry no ETA
  }

  supports({ source, delivery, inToken, outToken }: LegContext): boolean {
    return source.chain === delivery.chain && delivery.mode === "DESTINATION_CHAIN" && source.chain in XAU_CHAIN_KEY
      && !!inToken.contractAddress && !!outToken.contractAddress
      && inToken.contractAddress.toLowerCase() !== outToken.contractAddress.toLowerCase();
  }

  async quote(ctx: LegContext): Promise<RouteOption> {
    const { source, inToken, outToken, slippageBps } = ctx;
    const amountIn = toBaseUnits(source.amount, inToken.decimals);
    const body = { chainKey: XAU_CHAIN_KEY[source.chain], tokenIn: inToken.contractAddress, tokenOut: outToken.contractAddress, amountIn, slippageBps };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.f(`${this.baseUrl}/api/swap/quote`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Client-Source": "agent" }, body: JSON.stringify(body), signal: ac.signal,
      });
    } catch (e) {
      throw new Error(ac.signal.aborted ? `XAU Route same-chain quote timed out after ${this.timeoutMs} ms` : `XAU Route same-chain quote failed: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`XAU Route same-chain quote failed (HTTP ${res.status})`);
    return mapXauQuote((await res.json()) as XauAggregatedQuote, ctx, this.etaSec);
  }
}

/** Map an XAUConnect AggregatedQuote to a RouteOption. Throws if there is no live, executable best route. */
export function mapXauQuote(q: XauAggregatedQuote, ctx: LegContext, etaSec = 30): RouteOption {
  const { source, delivery, inToken, outToken } = ctx;
  if (!q || !q.best) throw new Error("XAU Route has no same-chain route for this pair");
  if (q.best.simulated) throw new Error("XAU Route returned a simulated quote; ignored");
  if (q.best.executable === false) throw new Error("XAU Route best route is quote-only; ignored");
  const out = String(q.best.amountOutAfterFee);
  const outFmt = fromBaseUnits(out, outToken.decimals);
  const inUsd = Number(source.amount) * inToken.price;
  const outUsd = Number(outFmt) * outToken.price;
  return {
    source, delivery,
    originAsset: inToken.assetId, destinationAsset: outToken.assetId,
    amountInUsd: round6(inUsd), amountOut: out, amountOutFormatted: outFmt, amountOutUsd: round6(outUsd),
    minAmountOut: String(q.minAmountOut ?? out),
    timeEstimateSec: etaSec,
    costBps: inUsd > 0 ? Math.round(((inUsd - outUsd) / inUsd) * 10_000) : 0,
    signature: `xauconnect:${q.quotedAt ?? "unsigned"}`,
    provider: "xauconnect",
    handoffUrl: "https://xauconnect.com/swap",
  };
}

/** XAUCONNECT_COMPARE=1 turns the comparison on (off by default). */
export function xauProviderFromEnv(env: Record<string, string | undefined>, fetchImpl?: FetchLike): XauConnectQuoteProvider | null {
  if (env.XAUCONNECT_COMPARE !== "1") return null;
  return new XauConnectQuoteProvider({
    baseUrl: env.XAUCONNECT_BASE_URL, fetch: fetchImpl,
    timeoutMs: env.XAUCONNECT_TIMEOUT_MS ? Number(env.XAUCONNECT_TIMEOUT_MS) : undefined,
  });
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
