/**
 * "Fund from another chain" for XAUConnect Gold Curve pools.
 *
 * Target path in the XAUConnect repo: apps/web/src/lib/near-intents/fund-curve.ts
 * Self-contained (no imports). Pure logic: pool config -> recipe -> quote token, the body for
 * POST /swap/cross-chain/quote, the graduation warning, and the hand-off to the existing buy
 * widget. The buy itself stays the existing Gold Curve flow, signed in the user's Solana wallet.
 */

export type QuoteToken = "SOL" | "USDC";

/** Published Gold Curve recipes (public config accounts, from the XAUConnect README). */
export const RECIPES = {
  "fair-sol": { quote: "SOL", config: "ExTrSGZBjzMrueBNHEALCCJmppB9zpoTSWJea4iR2gQu" },
  "fair-usdc": { quote: "USDC", config: "Hrro7hmEAXyN9uGgMWwDwosJiuCjhXcVn6xGw5pChBn8" },
  "shield-sol": { quote: "SOL", config: "5Edj53kfFx2da3dJy9gcxKLZF6W45QYozog5S4hNfA25" },
  "shield-usdc": { quote: "USDC", config: "4VyDGF5jS9JqUBQqbijzVDDrtq7T6dHMURNudmwzPKZB" },
  "distribute-sol": { quote: "SOL", config: "3sLsCEfr4aCdkczvqy3mM4nyWB4P3Ec6yd9rbQM2Xune" },
  "distribute-usdc": { quote: "USDC", config: "DT4NYCPLJYjPN8TqHQZrHj1PovVa6xmzRKVKvruc5vWy" },
} as const;

export type RecipeId = keyof typeof RECIPES;

/** Graduation threshold per quote token (XAUConnect README: 10 SOL or 750 USDC). */
export const GRADUATION: Readonly<Record<QuoteToken, number>> = { SOL: 10, USDC: 750 };

/** How the quote token is addressed on Solana in a cross-chain quote body. */
export const QUOTE_TOKEN_ADDRESS: Readonly<Record<QuoteToken, string>> = {
  SOL: "native",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};
export const QUOTE_DECIMALS: Readonly<Record<QuoteToken, number>> = { SOL: 9, USDC: 6 };

const SOLANA_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function recipeFromConfig(config: string): { id: RecipeId; quote: QuoteToken } {
  for (const [id, r] of Object.entries(RECIPES)) if (r.config === config) return { id: id as RecipeId, quote: r.quote };
  throw new Error(`pool config ${config} is not a Gold Curve recipe`);
}

export function toBase(amount: string, decimals: number): string {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new Error(`bad amount ${amount}`);
  const [w, f = ""] = amount.split(".");
  if (f.length > decimals) throw new Error(`${amount} has more than ${decimals} decimals`);
  return (BigInt(w) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, "0") || "0")).toString();
}

export interface GraduationCheck {
  remaining: number;
  /** share of the remaining distance this buy covers, 0..1 */
  share: number;
  warning?: string;
}

export function graduationCheck(quote: QuoteToken, raisedSoFar: number, buyAmount: number): GraduationCheck {
  const remaining = Math.max(Number((GRADUATION[quote] - raisedSoFar).toFixed(QUOTE_DECIMALS[quote])), 0);
  const share = remaining === 0 ? 0 : Math.min(buyAmount / remaining, 1);
  let warning: string | undefined;
  if (remaining === 0) warning = "This pool has already reached graduation. Check the token page before buying.";
  else if (buyAmount > remaining)
    warning = `Only ${remaining} ${quote} is left before this pool graduates. Anything above that may not fill on the curve.`;
  return { remaining, share, warning };
}

/** Body for XAUConnect's POST /swap/cross-chain/quote with the NEAR Intents venue. */
export interface CrossChainQuoteBody {
  fromChain: "ethereum" | "bsc" | "polygon" | "arbitrum" | "base" | "avalanche" | "solana";
  toChain: "solana";
  tokenIn: string;
  tokenOut: string;
  amount: string;
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageBps: number;
  sender: string;
  recipient: string;
}

export interface FundingInput {
  mint: string;
  /** pass the pool's config account (preferred) or a recipe id */
  poolConfig?: string;
  recipe?: RecipeId;
  /** the Solana wallet connected in XAUConnect; delivery goes only here */
  connectedWallet: string;
  from: { chain: CrossChainQuoteBody["fromChain"]; token: string; sender: string };
  /** EXACT_OUTPUT: quote tokens to land on Solana, decimal string, e.g. "0.5" */
  want?: string;
  /** EXACT_INPUT: base units of the source token to spend */
  spend?: string;
  slippageBps?: number;
  /** quote tokens already raised in the pool, if the page knows it */
  raisedSoFar?: number;
}

export interface FundingPlan {
  recipe: RecipeId;
  quoteToken: QuoteToken;
  body: CrossChainQuoteBody;
  graduation?: GraduationCheck;
  /** existing XAUConnect token page; the user finishes the buy there */
  handoffPath: string;
}

export function planFunding(f: FundingInput): FundingPlan {
  if (!SOLANA_ADDR.test(f.mint)) throw new Error("mint is not a valid Solana address");
  if (!SOLANA_ADDR.test(f.connectedWallet)) throw new Error("connect a Solana wallet first");
  const r = f.poolConfig ? recipeFromConfig(f.poolConfig) : f.recipe && RECIPES[f.recipe] ? { id: f.recipe, quote: RECIPES[f.recipe].quote as QuoteToken } : null;
  if (!r) throw new Error("need the pool config or a recipe id");
  if ((f.want ? 1 : 0) + (f.spend ? 1 : 0) !== 1) throw new Error("set exactly one of want or spend");
  if (f.from.chain === "solana" && f.from.token === QUOTE_TOKEN_ADDRESS[r.quote])
    throw new Error(`you already hold ${r.quote} on Solana; buy directly on the token page`);
  const body: CrossChainQuoteBody = {
    fromChain: f.from.chain,
    toChain: "solana",
    tokenIn: f.from.token,
    tokenOut: QUOTE_TOKEN_ADDRESS[r.quote],
    amount: f.want ? toBase(f.want, QUOTE_DECIMALS[r.quote]) : (f.spend as string),
    swapType: f.want ? "EXACT_OUTPUT" : "EXACT_INPUT",
    slippageBps: f.slippageBps ?? 100,
    sender: f.from.sender,
    recipient: f.connectedWallet,
  };
  const plan: FundingPlan = { recipe: r.id, quoteToken: r.quote, body, handoffPath: `/token/solana/${f.mint}` };
  if (f.want && f.raisedSoFar !== undefined) plan.graduation = graduationCheck(r.quote, f.raisedSoFar, Number(f.want));
  return plan;
}
