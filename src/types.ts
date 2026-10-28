// Shared types for the XAUConnect x NEAR Intents router.

export interface Token {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  priceUpdatedAt?: string;
  contractAddress?: string | null;
}

export type DepositType = "ORIGIN_CHAIN" | "INTENTS";
export type RecipientType = "DESTINATION_CHAIN" | "INTENTS";

/** Request body for POST /v0/quote on the 1Click API (subset we use). */
export interface QuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageTolerance: number; // basis points
  originAsset: string;
  depositType: DepositType;
  destinationAsset: string;
  amount: string; // smallest unit
  recipient: string;
  recipientType: RecipientType;
  refundTo: string;
  refundType: "ORIGIN_CHAIN" | "INTENTS";
  deadline: string; // ISO
  referral?: string;
}

export interface QuoteResponse {
  quote: {
    amountIn: string;
    amountInFormatted: string;
    amountInUsd: string;
    minAmountIn?: string;
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd: string;
    minAmountOut: string;
    timeEstimate: number; // seconds
    depositAddress?: string; // only when dry=false
    deadline?: string;
  };
  quoteRequest: QuoteRequest;
  signature: string;
  timestamp: string;
}

/** A holding the user (or agent) can spend from. */
export interface Source {
  symbol: string; // e.g. USDC
  chain: string; // 1Click blockchain key, e.g. arb
  amount: string; // human units, e.g. "250.5"
  refundTo: string; // address on the origin chain for refunds
}

/** Where the output should land. */
export interface Delivery {
  symbol: string; // e.g. XAUT
  chain: string; // e.g. eth
  recipient: string; // address on destination chain, or NEAR account if mode=INTENTS
  mode: RecipientType;
}

/** The user's goal: "turn these balances into gold, delivered here". */
export interface RouteIntent {
  sources: Source[];
  deliveries: Delivery[]; // candidate delivery options; router picks the best per source
  slippageBps?: number;
}

export interface RouteOption {
  source: Source;
  delivery: Delivery;
  originAsset: string;
  destinationAsset: string;
  amountInUsd: number;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: number;
  minAmountOut: string;
  timeEstimateSec: number;
  costBps: number; // (in - out) / in, in basis points, includes all fees + price impact
  signature: string;
  provider: "near-intents-1click";
}

export interface RouteFailure {
  source: Source;
  delivery: Delivery;
  error: string;
}

export interface RoutePlan {
  intentId: string;
  createdAt: string;
  dry: true;
  slippageBps?: number; // slippage the legs were quoted with (execute re-uses it)
  legs: RouteOption[]; // best option per source
  alternatives: RouteOption[]; // every other quoted option, ranked
  failures: RouteFailure[];
  rejected: { source: Source; reason: string }[]; // blocked by policy
  totals: { amountInUsd: number; amountOutUsd: number; costBps: number; maxTimeSec: number };
}
