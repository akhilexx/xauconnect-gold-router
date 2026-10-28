// Fund an XAUConnect Gold Curve buy from any chain.
// NEW (hackathon) code. The Gold Curve launchpad itself (Meteora DBC recipes, launch/buy flow,
// token pages) is PRE-EXISTING XAUConnect functionality and is only referenced here.
//
// The router delivers the curve's quote token (SOL or USDC) to the buyer's Solana wallet through
// NEAR Intents. The buyer then completes the buy on the existing XAUConnect token page, signing in
// their own Solana wallet.

import type { RouteIntent, Source } from "./types.ts";

export type QuoteToken = "SOL" | "USDC";

/** Published XAUConnect Gold Curve recipes (public config accounts, from the XAUConnect README). */
export const RECIPES = {
  "fair-sol": { quote: "SOL", config: "ExTrSGZBjzMrueBNHEALCCJmppB9zpoTSWJea4iR2gQu" },
  "fair-usdc": { quote: "USDC", config: "Hrro7hmEAXyN9uGgMWwDwosJiuCjhXcVn6xGw5pChBn8" },
  "shield-sol": { quote: "SOL", config: "5Edj53kfFx2da3dJy9gcxKLZF6W45QYozog5S4hNfA25" },
  "shield-usdc": { quote: "USDC", config: "4VyDGF5jS9JqUBQqbijzVDDrtq7T6dHMURNudmwzPKZB" },
  "distribute-sol": { quote: "SOL", config: "3sLsCEfr4aCdkczvqy3mM4nyWB4P3Ec6yd9rbQM2Xune" },
  "distribute-usdc": { quote: "USDC", config: "DT4NYCPLJYjPN8TqHQZrHj1PovVa6xmzRKVKvruc5vWy" },
} as const satisfies Record<string, { quote: QuoteToken; config: string }>;

export type RecipeId = keyof typeof RECIPES;

/** Graduation threshold per quote token (XAUConnect README: exactly 10 SOL or 750 USDC). */
export const GRADUATION: Record<QuoteToken, number> = { SOL: 10, USDC: 750 };

const SOLANA_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface GoldCurveFunding {
  mint: string;
  recipe: RecipeId;
  solanaWallet: string;
  sources: Source[];
  slippageBps?: number;
}

export function goldCurveIntent(f: GoldCurveFunding): { intent: RouteIntent; quote: QuoteToken; handoffUrl: string } {
  const r = RECIPES[f.recipe];
  if (!r) throw new Error(`unknown recipe ${f.recipe}; one of ${Object.keys(RECIPES).join(", ")}`);
  if (!SOLANA_ADDR.test(f.mint)) throw new Error("mint is not a valid Solana address");
  if (!SOLANA_ADDR.test(f.solanaWallet)) throw new Error("solanaWallet is not a valid Solana address");
  if (!f.sources.length) throw new Error("need at least one source");
  return {
    quote: r.quote,
    intent: {
      sources: f.sources,
      deliveries: [{ symbol: r.quote, chain: "sol", mode: "DESTINATION_CHAIN", recipient: f.solanaWallet }],
      slippageBps: f.slippageBps,
    },
    handoffUrl: `https://xauconnect.com/token/solana/${f.mint}`,
  };
}

/** Share of the remaining distance to graduation that a buy of `amount` quote tokens covers (0..1). */
export function graduationShare(quote: QuoteToken, raisedSoFar: number, amount: number): number {
  const left = Math.max(GRADUATION[quote] - raisedSoFar, 0);
  if (left === 0) return 0;
  return Math.min(amount / left, 1);
}
