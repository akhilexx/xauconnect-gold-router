/**
 * XAUConnect-shaped wrapper around the NEAR Intents venue.
 *
 * Target path in the XAUConnect repo: backend/src/services/routing/near-intents-xau.ts
 * (the patch build rewrites the one import below to "./near-intents.js" for NodeNext).
 *
 * Shapes mirror @xauconnect/utils schemas.ts at public main 73c354c:
 *   CrossChainQuoteRequest {fromChainKey,toChainKey,tokenIn,tokenOut,amountIn,slippageBps,taker,takerDestination?}
 *   CrossChainQuote / CrossChainBuild (provider widened to "near-intents"; see INTEGRATION.md)
 * Errors use the backend's envelope {error:{code,message}} so the web user-errors mapping applies.
 * No keys, no signing; quote is dry; build/submit stay behind the venue's two gates.
 */
import {
  NearIntentsError, NearIntentsVenue, ROUTE_LABEL, VENUE_ID, CHAIN_TO_ONECLICK, toUserError, validateQuoteInput,
  type CrossChainQuote as VenueQuote, type CrossChainQuoteInput, type DepositInstructions, type NearIntentsErrorCode,
  type StatusResult, type XauChainKey,
} from "./near-intents.ts";

/** Same fields as @xauconnect/utils CrossChainQuoteRequest. */
export interface XauCrossChainQuoteRequest {
  fromChainKey: string;
  toChainKey: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps: number;
  taker: string;
  takerDestination?: string;
}

export interface XauCrossChainStep {
  id: string;
  label: string;
  chainKey?: string;
  status: "pending" | "active" | "complete" | "failed";
  txHash?: string;
}

/** @xauconnect/utils CrossChainQuote with provider "near-intents" plus quoteRef for build. */
export interface XauNearIntentsQuote {
  provider: typeof VENUE_ID;
  fromChainKey: string;
  toChainKey: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOutGross?: string;
  amountOut: string;
  protocolFee: string;
  minAmountOut: string;
  estimatedDurationSec?: number;
  bridgeName?: string;
  steps: XauCrossChainStep[];
  routeId: string;
  quoteId?: string;
  protocolFeeBps: number;
  raw?: unknown;
}

export interface XauNearIntentsBuild {
  fromChainKey: string;
  toChainKey: string;
  provider: typeof VENUE_ID;
  evm?: { to: string; data: string; value: string; chainId?: number };
  solanaTransaction?: string;
  quoteId?: string;
  routeId: string;
  steps: XauCrossChainStep[];
  /** Unsigned deposit instructions; web lib/near-intents/deposit.ts turns these into a wallet request. */
  deposit: DepositInstructions;
}

export type XauCrossChainStatus = "pending" | "completed" | "failed" | "unknown";

export const EVM_CHAIN_ID: Readonly<Record<Exclude<XauChainKey, "solana">, number>> = {
  ethereum: 1, bsc: 56, polygon: 137, arbitrum: 42161, base: 8453, avalanche: 43114,
};

export function isXauRequest(b: unknown): b is XauCrossChainQuoteRequest {
  return typeof b === "object" && b !== null && "fromChainKey" in b && "toChainKey" in b;
}

/** XAUConnect request -> venue input. Recipient is takerDestination, else taker (same-family chains only). */
export function toVenueInput(req: XauCrossChainQuoteRequest): CrossChainQuoteInput {
  return validateQuoteInput({
    fromChain: req.fromChainKey,
    toChain: req.toChainKey,
    tokenIn: req.tokenIn,
    tokenOut: req.tokenOut,
    amount: req.amountIn,
    slippageBps: req.slippageBps,
    sender: req.taker,
    recipient: req.takerDestination ?? req.taker,
  });
}

function steps(from: string, to: string): XauCrossChainStep[] {
  return [
    { id: "deposit", label: "Send from your wallet", chainKey: from, status: "pending" },
    { id: "settle", label: ROUTE_LABEL, status: "pending" },
    { id: "deliver", label: "Receive", chainKey: to, status: "pending" },
  ];
}

/** Venue quote -> XAUConnect CrossChainQuote. No XAU protocol fee is taken on this venue (0 bps). */
export function toXauQuote(q: VenueQuote, quoteRef: string): XauNearIntentsQuote {
  return {
    provider: VENUE_ID,
    fromChainKey: q.fromChain,
    toChainKey: q.toChain,
    tokenIn: q.tokenIn,
    tokenOut: q.tokenOut,
    amountIn: q.amountIn,
    amountOutGross: q.amountOut,
    amountOut: q.amountOut,
    protocolFee: "0",
    minAmountOut: q.minAmountOut,
    estimatedDurationSec: q.etaSeconds,
    bridgeName: ROUTE_LABEL,
    steps: steps(q.fromChain, q.toChain),
    routeId: `${VENUE_ID}:${quoteRef}`,
    quoteId: quoteRef,
    protocolFeeBps: 0,
    raw: {
      amountInFormatted: q.amountInFormatted, amountOutFormatted: q.amountOutFormatted,
      amountInUsd: q.amountInUsd, amountOutUsd: q.amountOutUsd, costBps: q.costBps, expiresAt: q.expiresAt, dry: true,
    },
  };
}

/** Deposit instructions -> XAUConnect CrossChainBuild. EVM origins get a ready {to,data,value,chainId}. */
export function toXauBuild(d: DepositInstructions): XauNearIntentsBuild {
  const from = d.chain;
  return {
    fromChainKey: from,
    toChainKey: d.quote.toChain,
    provider: VENUE_ID,
    evm: d.evm && from !== "solana" ? { ...d.evm, chainId: EVM_CHAIN_ID[from] } : undefined,
    quoteId: d.quoteId,
    routeId: `${VENUE_ID}:${d.quoteId}`,
    steps: steps(from, d.quote.toChain),
    deposit: d,
  };
}

/** 1Click status -> XAUConnect's normalizeCrossChainStatus vocabulary. REFUNDED counts as failed + refunded. */
export function normalizeNearIntentsStatus(s: Pick<StatusResult, "status" | "destinationTxs">): {
  status: XauCrossChainStatus; refunded: boolean; rawStatus: string; destinationTxHash?: string;
} {
  const raw = String(s.status);
  const map: Record<string, XauCrossChainStatus> = {
    KNOWN_DEPOSIT_TX: "pending", PENDING_DEPOSIT: "pending", INCOMPLETE_DEPOSIT: "pending", PROCESSING: "pending",
    SUCCESS: "completed", REFUNDED: "failed", FAILED: "failed",
  };
  return { status: map[raw] ?? "unknown", refunded: raw === "REFUNDED", rawStatus: raw, destinationTxHash: s.destinationTxs[0] };
}

/** Status body for the web timeline: `status` stays the 1Click value; `xauStatus` is the normalized one. */
function statusBody(s: Pick<StatusResult, "status" | "destinationTxs" | "terminal">) {
  const n = normalizeNearIntentsStatus(s);
  return { status: n.rawStatus, xauStatus: n.status, refunded: n.refunded, terminal: s.terminal, destinationTxs: s.destinationTxs };
}

// ---------- handlers in the XAUConnect envelope ----------

export interface XauResult { status: number; json: unknown }

const HTTP_FOR: Partial<Record<NearIntentsErrorCode, number>> = {
  DISABLED: 503, EXECUTION_DISABLED: 403, CONFIRM_REQUIRED: 403, QUOTE_EXPIRED: 410, PRICE_MOVED: 409, AMOUNT_MISMATCH: 409,
  INVALID_ADDRESS: 400, UNSUPPORTED_CHAIN: 400, UNSUPPORTED_TOKEN: 422, AMOUNT_TOO_LOW: 422, NO_ROUTE: 422, TIMEOUT: 504, UPSTREAM: 502,
};

/** Codes are prefixed so they can sit in XAUConnect's USER_ERROR_MESSAGES tables without clashing. */
export function xauErrorCode(c: NearIntentsErrorCode): string {
  return `NEAR_INTENTS_${c}`;
}

export function xauFail(e: unknown): XauResult {
  const code: NearIntentsErrorCode = e instanceof NearIntentsError ? e.code : "UPSTREAM";
  return { status: HTTP_FOR[code] ?? 502, json: { error: { code: xauErrorCode(code), message: toUserError(e) } } };
}

const SUPPORTED = new Set(Object.keys(CHAIN_TO_ONECLICK));

/**
 * Framework-agnostic handlers for backend/src/routes/near-intents.ts.
 * quote returns {quoteRef, quote (venue shape, read by the web panels), crossChainQuote (XAUConnect shape)}.
 * quote accepts either the XAUConnect CrossChainQuoteRequest shape or the venue shape
 * (fromChain/amount/sender/recipient) used by the web Fund-from-another-chain panel.
 */
export function createXauNearIntentsHandlers(
  venue: NearIntentsVenue,
  opts: { now?: () => number; newId?: () => string; maxEntries?: number } = {},
) {
  const now = opts.now ?? (() => Date.now());
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const cache = new Map<string, { input: CrossChainQuoteInput; quote: VenueQuote }>();
  const prune = () => {
    for (const [k, v] of cache) if (now() > v.quote.expiresAt) cache.delete(k);
    while (cache.size > (opts.maxEntries ?? 5000)) cache.delete(cache.keys().next().value as string);
  };
  return {
    /** POST /swap/cross-chain/near-intents/quote. Always dry. */
    async quote(body: unknown): Promise<XauResult> {
      try {
        if (isXauRequest(body) && body.fromChainKey === body.toChainKey)
          throw new NearIntentsError("NO_ROUTE", "same chain; use the same-chain quote");
        const input = isXauRequest(body) ? toVenueInput(body) : validateQuoteInput(body);
        const q = await venue.quote(input);
        prune();
        const quoteRef = newId();
        cache.set(quoteRef, { input, quote: q });
        return { status: 200, json: { quoteRef, quote: q, crossChainQuote: toXauQuote(q, quoteRef) } };
      } catch (e) { return xauFail(e); }
    },
    /** POST /swap/cross-chain/near-intents/build {quoteRef, confirm:true}. Gated; one build per quoteRef. */
    async build(body: unknown): Promise<XauResult> {
      try {
        const b = (body ?? {}) as { quoteRef?: unknown; confirm?: unknown };
        const ref = typeof b.quoteRef === "string" ? b.quoteRef : "";
        const hit = cache.get(ref);
        if (!hit) throw new NearIntentsError("QUOTE_EXPIRED", "unknown or used quoteRef");
        const deposit = await venue.build(hit.input, hit.quote, { confirm: b.confirm === true });
        cache.delete(ref);
        return { status: 200, json: toXauBuild(deposit) };
      } catch (e) { return xauFail(e); }
    },
    /** GET /swap/cross-chain/near-intents/status/:quoteId (quoteId = depositAddress or depositAddress|memo). */
    async status(quoteId: string): Promise<XauResult> {
      try {
        if (!quoteId || quoteId.length > 200) throw new NearIntentsError("UPSTREAM", "quoteId required");
        const s = await venue.status(quoteId);
        return { status: 200, json: statusBody(s) };
      } catch (e) { return xauFail(e); }
    },
    /** POST /swap/cross-chain/near-intents/submit-deposit {quoteId, txHash, confirm:true}. Optional speed-up. */
    async submitDeposit(body: unknown): Promise<XauResult> {
      try {
        const b = (body ?? {}) as { quoteId?: unknown; txHash?: unknown; confirm?: unknown };
        if (typeof b.quoteId !== "string" || typeof b.txHash !== "string" || !b.quoteId || !b.txHash)
          throw new NearIntentsError("UPSTREAM", "quoteId and txHash required");
        const s = await venue.submitDeposit({ quoteId: b.quoteId, txHash: b.txHash, confirm: b.confirm === true });
        return { status: 200, json: statusBody(s) };
      } catch (e) { return xauFail(e); }
    },
    /** For tests / ops: chains this venue can route. */
    supportedChains(): string[] { return [...SUPPORTED]; },
  };
}
