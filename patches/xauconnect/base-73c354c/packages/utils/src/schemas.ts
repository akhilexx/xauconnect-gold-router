/**
 * XAUConnect — API contract schemas (zod).
 *
 * Shared by backend (validation), SDK (typing), and frontends.
 * Amounts cross the wire as decimal strings of base units (bigint-safe).
 */
import { z } from "zod";
import { CHAIN_KEYS } from "./chains.js";

export const ChainKeySchema = z.enum(CHAIN_KEYS as [string, ...string[]]);
export const AddressSchema = z.string().min(3).max(64);

/** Base-unit amounts as decimal strings; accepts JSON numbers/bigints (common agent mistake). */
export const AmountSchema = z.preprocess(
  (v) => {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.trunc(v).toString();
    if (typeof v === "bigint") return v.toString();
    return v;
  },
  z.string().regex(/^\d+$/, "expected base-unit integer string (pass a string or integer number)"),
);

/** Slippage bps; accepts numeric strings from form-encoded / sloppy JSON agents. */
export const SlippageBpsSchema = z.preprocess(
  (v) => {
    if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
    return v;
  },
  z.number().int().min(1).max(5000).default(50),
);

// ─── Swap quoting ────────────────────────────────────────────────────────────

export const QuoteRequestSchema = z.object({
  chainKey: ChainKeySchema,
  tokenIn: AddressSchema,
  tokenOut: AddressSchema,
  amountIn: AmountSchema,
  /** Slippage tolerance, default 50 (=0.5%). */
  slippageBps: SlippageBpsSchema,
  /** Wallet address for tx building (optional at quote time). */
  taker: AddressSchema.optional(),
});
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

export const RouteHopSchema = z.object({
  tokenIn: AddressSchema,
  tokenOut: AddressSchema,
  /** Pool fee tier (V3) or undefined (V2). */
  feeTier: z.number().int().optional(),
});
export type RouteHop = z.infer<typeof RouteHopSchema>;

/** One venue's quote — rendered as a row in the route-comparison table. */
export const RouteQuoteSchema = z.object({
  dexId: z.string(),
  dexName: z.string(),
  protocol: z.string(),
  /** Gross output before XAUConnect's protocol fee. */
  amountOut: AmountSchema,
  /** Net output the user receives after the protocol fee. */
  amountOutAfterFee: AmountSchema,
  /** Protocol fee captured, denominated in tokenOut. */
  protocolFee: AmountSchema,
  priceImpactBps: z.number(),
  estimatedGasUsd: z.number().optional(),
  path: z.array(RouteHopSchema),
  /** True when produced by the demo fallback rather than a live venue. */
  simulated: z.boolean().default(false),
  /** False for quote-only rows (e.g. direct DEX before own router is deployed). */
  executable: z.boolean().optional(),
});
export type RouteQuote = z.infer<typeof RouteQuoteSchema>;

export const AggregatedQuoteSchema = z.object({
  request: QuoteRequestSchema,
  /** All venue quotes, sorted best-first by amountOutAfterFee. */
  quotes: z.array(RouteQuoteSchema),
  best: RouteQuoteSchema.nullable(),
  protocolFeeBps: z.number(),
  minAmountOut: AmountSchema.nullable(),
  quotedAt: z.number(),
});
export type AggregatedQuote = z.infer<typeof AggregatedQuoteSchema>;

/** Built transaction payload returned by /swap/build. */
export const SwapTxSchema = z.object({
  chainKey: ChainKeySchema,
  /** EVM: { to, data, value } calldata. Solana: base64 serialized tx. */
  evm: z
    .object({ to: AddressSchema, data: z.string(), value: AmountSchema })
    .optional(),
  solanaTransaction: z.string().optional(),
  /** Result of pre-flight simulation (eth_call / simulateTransaction). */
  simulation: z.object({
    success: z.boolean(),
    error: z.string().optional(),
    expectedOut: AmountSchema.optional(),
  }),
});
export type SwapTx = z.infer<typeof SwapTxSchema>;

// ─── Cross-chain swap ────────────────────────────────────────────────────────

export const CrossChainQuoteRequestSchema = z.object({
  fromChainKey: ChainKeySchema,
  toChainKey: ChainKeySchema,
  tokenIn: AddressSchema,
  tokenOut: AddressSchema,
  amountIn: AmountSchema,
  slippageBps: SlippageBpsSchema,
  taker: AddressSchema,
  takerDestination: AddressSchema.optional(),
});
export type CrossChainQuoteRequest = z.infer<typeof CrossChainQuoteRequestSchema>;

export const CrossChainStepSchema = z.object({
  id: z.string(),
  label: z.string(),
  chainKey: ChainKeySchema.optional(),
  status: z.enum(["pending", "active", "complete", "failed"]).default("pending"),
  txHash: z.string().optional(),
});
export type CrossChainStep = z.infer<typeof CrossChainStepSchema>;

export const CrossChainQuoteSchema = z.object({
  provider: z.enum(["0x-cross-chain", "1inch-fusion-plus"]),
  fromChainKey: ChainKeySchema,
  toChainKey: ChainKeySchema,
  tokenIn: AddressSchema,
  tokenOut: AddressSchema,
  amountIn: AmountSchema,
  /** Gross bridge/swap output before XAU protocol fee. */
  amountOutGross: AmountSchema.optional(),
  /** Net output the user receives after protocol fee. */
  amountOut: AmountSchema,
  /** Protocol fee captured, denominated in tokenOut. */
  protocolFee: AmountSchema.default("0"),
  minAmountOut: AmountSchema,
  estimatedDurationSec: z.number().optional(),
  bridgeName: z.string().optional(),
  steps: z.array(CrossChainStepSchema),
  routeId: z.string(),
  quoteId: z.string().optional(),
  protocolFeeBps: z.number(),
  raw: z.unknown().optional(),
});
export type CrossChainQuote = z.infer<typeof CrossChainQuoteSchema>;

export const CrossChainBuildRequestSchema = z.object({
  request: CrossChainQuoteRequestSchema,
  quote: CrossChainQuoteSchema,
});
export type CrossChainBuildRequest = z.infer<typeof CrossChainBuildRequestSchema>;

export const CrossChainExecutionStepSchema = z.object({
  stepIndex: z.number().int(),
  chainKey: ChainKeySchema,
  action: z.string(),
  txPayload: z
    .object({
      evm: z
        .object({ to: AddressSchema, data: z.string(), value: AmountSchema })
        .optional(),
      solanaTransaction: z.string().optional(),
    })
    .optional(),
});
export type CrossChainExecutionStep = z.infer<typeof CrossChainExecutionStepSchema>;

export const CrossChainBuildSchema = z.object({
  fromChainKey: ChainKeySchema,
  toChainKey: ChainKeySchema,
  provider: z.enum(["0x-cross-chain", "1inch-fusion-plus"]),
  /** EVM origin tx when applicable. */
  evm: z
    .object({ to: AddressSchema, data: z.string(), value: AmountSchema, chainId: z.number().optional() })
    .optional(),
  /** Base64 Solana tx when origin is Solana. */
  solanaTransaction: z.string().optional(),
  quoteId: z.string().optional(),
  routeId: z.string(),
  steps: z.array(CrossChainStepSchema),
  executionSteps: z.array(CrossChainExecutionStepSchema).optional(),
});
export type CrossChainBuild = z.infer<typeof CrossChainBuildSchema>;

// ─── Liquidity (LP aggregation) ──────────────────────────────────────────────

export const LpQuoteRequestSchema = z.object({
  chainKey: ChainKeySchema,
  action: z.enum(["add", "remove"]),
  tokenA: AddressSchema,
  tokenB: AddressSchema,
  /** For add: amount of tokenA. For remove: LP token amount. */
  amount: AmountSchema,
  dexId: z.string().optional(),
});
export type LpQuoteRequest = z.infer<typeof LpQuoteRequestSchema>;

export const LpQuoteSchema = z.object({
  dexId: z.string(),
  dexName: z.string(),
  pairAddress: AddressSchema.optional(),
  amountA: AmountSchema,
  amountB: AmountSchema,
  expectedLpTokens: AmountSchema.optional(),
  shareOfPoolBps: z.number().optional(),
  lpFeeBps: z.number(),
  lpFeeAmount: AmountSchema,
  aprEstimate: z.number().optional(),
  simulated: z.boolean().default(false),
});
export type LpQuote = z.infer<typeof LpQuoteSchema>;

// ─── Token launchpad ─────────────────────────────────────────────────────────

export const LaunchTypeSchema = z.enum(["standard", "bonding-curve"]);

/** Named Gold Curve presets. Same economics on every launch of that preset. */
export const CurvePresetSchema = z.enum(["fair", "shield", "distribute"]);
export type CurvePreset = z.infer<typeof CurvePresetSchema>;

/** Quote asset for a Solana Gold Curve. Thresholds match Meteora keeper auto-migration. */
export const CurveQuoteSchema = z.enum(["sol", "usdc"]);
export type CurveQuote = z.infer<typeof CurveQuoteSchema>;

export const TokenLaunchRequestSchema = z.object({
  chainKey: ChainKeySchema,
  name: z.string().min(1).max(64),
  symbol: z.string().min(1).max(12).regex(/^[A-Z0-9]+$/, "uppercase alphanumerics only"),
  /** Total supply in whole tokens (18 decimals applied on-chain). */
  totalSupply: z.string().regex(/^\d+$/),
  description: z.string().max(2000).default(""),
  logoIpfsCid: z.string().optional(),
  website: z.string().url().optional().or(z.literal("")),
  twitter: z.string().max(100).optional(),
  telegram: z.string().max(100).optional(),
  launchType: LaunchTypeSchema.default("standard"),
  /** Standard launches: optionally seed an LP and lock it. */
  createLiquidityPool: z.boolean().default(false),
  lockLiquidity: z.boolean().default(false),
  lockDurationDays: z.number().int().min(0).max(3650).default(180),
  /** Fee payment currency. */
  feeCurrency: z.enum(["native", "usdc", "xau"]).default("native"),
  creator: AddressSchema,
  /** Solana bonding-curve only: which published Gold Curve config to launch on. */
  curvePreset: CurvePresetSchema.optional(),
  /** Solana bonding-curve only: SOL (10 SOL graduation) or USDC (750 USDC graduation). */
  quote: CurveQuoteSchema.optional(),
  /** Optional first buy, in whole quote tokens (e.g. "0.05"). */
  firstBuyAmount: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
});
export type TokenLaunchRequest = z.infer<typeof TokenLaunchRequestSchema>;

// ─── Market data / discovery ─────────────────────────────────────────────────

export const MarketTokenSchema = z.object({
  chainKey: ChainKeySchema,
  address: AddressSchema,
  symbol: z.string(),
  name: z.string(),
  priceUsd: z.number(),
  change1hPct: z.number().optional(),
  change24hPct: z.number(),
  volume24hUsd: z.number(),
  liquidityUsd: z.number(),
  marketCapUsd: z.number().optional(),
  holders: z.number().optional(),
  logoURI: z.string().optional(),
  createdAt: z.number().optional(),
  /** Set when launched through the XAUConnect launchpad. */
  xauLaunch: z.boolean().default(false),
  auditBadge: z.enum(["none", "pending", "verified"]).default("none"),
});
export type MarketToken = z.infer<typeof MarketTokenSchema>;

export const DiscoveryTabSchema = z.enum(["trending", "new", "gainers", "volume"]);
export type DiscoveryTab = z.infer<typeof DiscoveryTabSchema>;

export const CandleSchema = z.object({
  time: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().optional(),
});
export type Candle = z.infer<typeof CandleSchema>;

export const CandleIntervalSchema = z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);
export type CandleInterval = z.infer<typeof CandleIntervalSchema>;

// ─── Auth ────────────────────────────────────────────────────────────────────

export const AuthChallengeRequestSchema = z.object({
  address: AddressSchema,
  chainKind: z.enum(["evm", "solana"]).default("evm"),
});

export const AuthVerifyRequestSchema = z.object({
  address: AddressSchema,
  signature: z.string(),
  nonce: z.string(),
});

export const SessionSchema = z.object({
  address: AddressSchema,
  role: z.enum(["USER", "ADMIN"]),
  issuedAt: z.number(),
});
export type Session = z.infer<typeof SessionSchema>;

// ─── Admin ───────────────────────────────────────────────────────────────────

export const FeeConfigSchema = z.object({
  chainKey: ChainKeySchema,
  swapFeeBps: z.number().int().min(0).max(10_000),
  defaultSlippageBps: z.number().int().min(1).max(5000).default(50),
  lpFeeBps: z.number().int().min(0).max(100),
  /** Fiat buy/sell partner markup (bps) — defaults to swap fee per chain. */
  onrampFeeBps: z.number().int().min(0).max(10_000).default(300),
  launchFeeNative: AmountSchema,
  listingFeeUsd: z.number().min(0),
  enabled: z.boolean(),
});
export type FeeConfig = z.infer<typeof FeeConfigSchema>;

export const AdminMetricsSchema = z.object({
  totalVolumeUsd: z.number(),
  feesEarnedUsd: z.number(),
  activeUsers24h: z.number(),
  totalUsers: z.number(),
  tokensLaunched: z.number(),
  tvlUsd: z.number(),
  swapCount: z.number(),
  chainBreakdown: z.array(
    z.object({
      chainKey: ChainKeySchema,
      volumeUsd: z.number(),
      feesUsd: z.number(),
      swaps: z.number(),
    }),
  ),
  volumeSeries: z.array(z.object({ date: z.string(), volumeUsd: z.number(), feesUsd: z.number() })),
  treasury: z
    .object({
      totalUsd: z.number(),
      walletRows: z.number(),
      byChain: z.array(
        z.object({
          chainKey: ChainKeySchema,
          nativeSymbol: z.string(),
          nativeBalance: z.number(),
          nativePriceUsd: z.number(),
          balanceUsd: z.number(),
          walletCount: z.number(),
        }),
      ),
    })
    .optional(),
});
export type AdminMetrics = z.infer<typeof AdminMetricsSchema>;

export const AdminWalletSchema = z.object({
  chainKey: ChainKeySchema,
  address: z.string().min(20).max(128),
  label: z.string().max(64).optional(),
  purpose: z.enum(["treasury", "fee_collector", "operations", "on_chain_vault"]).default("treasury"),
});
export type AdminWalletInput = z.infer<typeof AdminWalletSchema>;

/** Client reports a wallet connect session (no auth required). */
export const WalletConnectRegisterSchema = z.object({
  address: AddressSchema,
  chainKind: z.enum(["evm", "solana"]).default("evm"),
  chainKey: ChainKeySchema.optional(),
  chainId: z.number().int().positive().optional(),
  connectorId: z.string().max(64).optional(),
  connectorName: z.string().max(64).optional(),
  walletApp: z.string().max(64).optional(),
  connectMethod: z.string().max(64).optional(),
  pagePath: z.string().max(512).optional(),
  referrer: z.string().max(512).optional(),
  /** True when the user switched chains — updates per-chain activity without a new session. */
  chainVisitOnly: z.boolean().optional(),
});
export type WalletConnectRegisterInput = z.infer<typeof WalletConnectRegisterSchema>;

// ─── WebSocket messages ──────────────────────────────────────────────────────

const WsChannelSchema = z.enum(["prices", "swaps", "trending", "launches"]);
export type WsChannel = z.infer<typeof WsChannelSchema>;

export const WsClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribe"), channel: WsChannelSchema }),
  z.object({ type: z.literal("unsubscribe"), channel: WsChannelSchema }),
  z.object({ type: z.literal("ping") }),
]);
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;

export interface WsServerMessage {
  type: WsChannel | "pong";
  payload?: unknown;
  ts: number;
}
