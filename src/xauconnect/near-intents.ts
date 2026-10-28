/**
 * NEAR Intents venue for XAUConnect cross-chain routing.
 *
 * Target path in the XAUConnect repo: backend/src/services/routing/near-intents.ts
 * This file is self-contained (no imports) so the same bytes are tested in the
 * xauconnect-gold-router repo and dropped into XAUConnect unchanged.
 *
 * Model (matches XAUConnect's non-custodial execution): the backend never holds keys
 * and never signs. quote() is always a dry 1Click quote. build() asks 1Click for a
 * real deposit address (dry:false) only when NEAR_INTENTS_EXECUTION_ENABLED=1 AND the
 * caller passes confirm:true, and returns unsigned deposit instructions that the
 * user's own wallet signs (EVM: sendTransaction {to,data,value}; Solana: transfer ix).
 *
 * User-facing strings never name the venue: routes are "XAU Route"
 * (XAUConnect branding rule). The optional settlement note is a separate constant.
 */

export type XauChainKey = "ethereum" | "bsc" | "polygon" | "arbitrum" | "base" | "avalanche" | "solana";

export const CHAIN_TO_ONECLICK: Readonly<Record<XauChainKey, string>> = {
  ethereum: "eth",
  bsc: "bsc",
  polygon: "pol",
  arbitrum: "arb",
  base: "base",
  avalanche: "avax",
  solana: "sol",
};

const ONECLICK_TO_CHAIN: Readonly<Record<string, XauChainKey>> = Object.fromEntries(
  Object.entries(CHAIN_TO_ONECLICK).map(([k, v]) => [v, k as XauChainKey]),
);

/** Native gas token symbol per 1Click chain (1Click lists natives with no contractAddress). */
const NATIVE_SYMBOL: Readonly<Record<string, string>> = {
  eth: "ETH", arb: "ETH", base: "ETH", bsc: "BNB", pol: "POL", avax: "AVAX", sol: "SOL",
};

/** Ways XAUConnect / common wallets write "the native token". wSOL mint is treated as SOL. */
const NATIVE_SENTINELS = new Set([
  "native",
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "0x0000000000000000000000000000000000000000",
  "so11111111111111111111111111111111111111112",
]);

export const ROUTE_LABEL = "XAU Route";
/** Optional disclosure line for the UI. Needs owner sign-off before it is shown. */
export const SETTLEMENT_NOTE = "settled on NEAR Intents";
export const VENUE_ID = "near-intents";
export const QUOTE_TTL_MS = 60_000;

export function toOneClickChain(k: string): string {
  const c = CHAIN_TO_ONECLICK[k as XauChainKey];
  if (!c) throw new NearIntentsError("UNSUPPORTED_CHAIN", `unsupported chain ${k}`);
  return c;
}

export function fromOneClickChain(c: string): XauChainKey {
  const k = ONECLICK_TO_CHAIN[c];
  if (!k) throw new NearIntentsError("UNSUPPORTED_CHAIN", `unsupported 1Click chain ${c}`);
  return k;
}

export function isNative(token: string): boolean {
  return NATIVE_SENTINELS.has(token.toLowerCase());
}

// ---------- config ----------

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface NearIntentsConfig {
  /** Show NEAR Intents quotes at all. Default false. */
  enabled: boolean;
  /** Allow build() to request a real deposit address. Default false. */
  executionEnabled: boolean;
  baseUrl: string;
  jwt?: string;
  referral?: string;
  timeoutMs: number;
  tokenTtlMs: number;
  fetch?: FetchLike;
  now?: () => number;
}

export function nearIntentsConfigFromEnv(env: Record<string, string | undefined>): NearIntentsConfig {
  return {
    enabled: env.NEAR_INTENTS_ENABLED === "true" || env.NEAR_INTENTS_ENABLED === "1",
    executionEnabled: env.NEAR_INTENTS_EXECUTION_ENABLED === "1",
    baseUrl: (env.ONECLICK_BASE_URL || "https://1click.chaindefuser.com").replace(/\/$/, ""),
    jwt: env.ONECLICK_JWT || undefined,
    referral: env.NEAR_INTENTS_REFERRAL || undefined,
    timeoutMs: Number(env.ONECLICK_TIMEOUT_MS || 8000),
    tokenTtlMs: 10 * 60_000,
  };
}

// ---------- types ----------

export type SwapType = "EXACT_INPUT" | "EXACT_OUTPUT";

export interface CrossChainQuoteInput {
  fromChain: XauChainKey;
  toChain: XauChainKey;
  /** token address / mint, or a native sentinel ("native", 0xEeee..., wSOL mint) */
  tokenIn: string;
  tokenOut: string;
  /** base units. EXACT_INPUT: amount in. EXACT_OUTPUT: amount out wanted. */
  amount: string;
  swapType?: SwapType;
  slippageBps: number;
  /** user's address on fromChain; refunds go here */
  sender: string;
  /** user's address on toChain */
  recipient: string;
}

export interface OneClickToken {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
  price?: number;
  contractAddress?: string | null;
}

export interface OneClickQuoteRequest {
  dry: boolean;
  swapType: SwapType;
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  deadline: string;
  referral?: string;
}

export interface OneClickQuote {
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn?: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  timeEstimate: number;
  depositAddress?: string;
  depositMemo?: string;
  deadline?: string;
}

export interface CrossChainQuote {
  venue: typeof VENUE_ID;
  routeLabel: typeof ROUTE_LABEL;
  fromChain: XauChainKey;
  toChain: XauChainKey;
  tokenIn: string;
  tokenOut: string;
  swapType: SwapType;
  /** base units the user must send */
  amountIn: string;
  /** EXACT_OUTPUT only: least the user can send */
  minAmountIn?: string;
  amountOut: string;
  minAmountOut: string;
  amountInFormatted: string;
  amountOutFormatted: string;
  amountInUsd: number;
  amountOutUsd: number;
  /** (usdIn - usdOut) / usdIn in bps, includes venue + bridge fees */
  costBps: number;
  etaSeconds: number;
  slippageBps: number;
  quotedAt: number;
  expiresAt: number;
  /** what build() must re-request with dry:false */
  request: OneClickQuoteRequest;
  signature: string;
}

export interface EvmDepositTx {
  to: string;
  data: string;
  /** wei as decimal string */
  value: string;
}

export interface SolanaDeposit {
  kind: "system-transfer" | "spl-transfer";
  /** deposit address (owner of the destination ATA for SPL) */
  to: string;
  mint?: string;
  amount: string;
  decimals: number;
}

export interface DepositInstructions {
  venue: typeof VENUE_ID;
  routeLabel: typeof ROUTE_LABEL;
  /** opaque id for status(): depositAddress or depositAddress|memo */
  quoteId: string;
  chain: XauChainKey;
  depositAddress: string;
  depositMemo?: string;
  /** base units to send; never more than the confirmed quote's amountIn */
  amount: string;
  amountFormatted: string;
  minAmountOut: string;
  amountOutFormatted: string;
  deadline?: string;
  evm?: EvmDepositTx;
  solana?: SolanaDeposit;
  quote: CrossChainQuote;
}

export type DepositStatus =
  | "KNOWN_DEPOSIT_TX" | "PENDING_DEPOSIT" | "INCOMPLETE_DEPOSIT" | "PROCESSING"
  | "SUCCESS" | "REFUNDED" | "FAILED";

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["SUCCESS", "REFUNDED", "FAILED"]);

export interface StatusResult {
  status: DepositStatus | string;
  terminal: boolean;
  /** destination tx hashes when 1Click reports them */
  destinationTxs: string[];
  raw: unknown;
}

export type NearIntentsErrorCode =
  | "DISABLED" | "EXECUTION_DISABLED" | "CONFIRM_REQUIRED" | "UNSUPPORTED_CHAIN" | "UNSUPPORTED_TOKEN"
  | "AMOUNT_TOO_LOW" | "INVALID_ADDRESS" | "NO_ROUTE" | "PRICE_MOVED" | "AMOUNT_MISMATCH" | "QUOTE_EXPIRED"
  | "TIMEOUT" | "UPSTREAM";

export class NearIntentsError extends Error {
  code: NearIntentsErrorCode;
  status?: number;
  constructor(code: NearIntentsErrorCode, message: string, status?: number) {
    super(message);
    this.name = "NearIntentsError";
    this.code = code;
    this.status = status;
  }
}

/** Copy shown to users. Never names a venue, DEX or bridge. */
export const USER_ERRORS: Readonly<Record<NearIntentsErrorCode, string>> = {
  DISABLED: "Cross-chain XAU Routes are not available right now.",
  EXECUTION_DISABLED: "Cross-chain execution is switched off. You can still compare quotes.",
  CONFIRM_REQUIRED: "Please review and confirm the route before sending.",
  UNSUPPORTED_CHAIN: "That chain isn't supported for cross-chain XAU Routes yet.",
  UNSUPPORTED_TOKEN: "That token isn't supported for cross-chain XAU Routes yet.",
  AMOUNT_TOO_LOW: "Amount is too small for a cross-chain XAU Route. Try a larger amount.",
  INVALID_ADDRESS: "The destination address isn't valid for that chain.",
  NO_ROUTE: "No XAU Route is available for this pair right now.",
  PRICE_MOVED: "The price moved beyond your slippage setting. Review the new quote.",
  AMOUNT_MISMATCH: "The amount changed since you confirmed. Review the new quote.",
  QUOTE_EXPIRED: "This quote expired. Refresh to get a new XAU Route.",
  TIMEOUT: "Getting a cross-chain XAU Route took too long. Please try again.",
  UPSTREAM: "Couldn't get a cross-chain XAU Route. Please try again.",
};

export function classifyUpstream(status: number, message: string): NearIntentsErrorCode {
  const m = message.toLowerCase();
  if (/too low|at least|minimum/.test(m)) return "AMOUNT_TOO_LOW";
  if (/recipient|refund|address/.test(m) && /not valid|invalid/.test(m)) return "INVALID_ADDRESS";
  if (/not supported|no route|failed to get quote|unsupported|not found/.test(m)) return "NO_ROUTE";
  if (status === 408 || status === 504) return "TIMEOUT";
  return "UPSTREAM";
}

export function toUserError(e: unknown): string {
  if (e instanceof NearIntentsError) return USER_ERRORS[e.code];
  if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) return USER_ERRORS.TIMEOUT;
  return USER_ERRORS.UPSTREAM;
}

// ---------- encoding ----------

/** ERC-20 transfer(address,uint256) calldata. */
export function erc20TransferData(to: string, amount: string | bigint): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new NearIntentsError("INVALID_ADDRESS", `bad EVM address ${to}`);
  const amt = BigInt(amount);
  if (amt <= 0n) throw new NearIntentsError("AMOUNT_TOO_LOW", "amount must be positive");
  return "0xa9059cbb" + to.slice(2).toLowerCase().padStart(64, "0") + amt.toString(16).padStart(64, "0");
}

function costBps(usdIn: number, usdOut: number): number {
  if (!(usdIn > 0)) return 0;
  return Math.round(((usdIn - usdOut) / usdIn) * 10_000);
}

// ---------- venue ----------

export class NearIntentsVenue {
  private cfg: NearIntentsConfig;
  private tokens: OneClickToken[] | null = null;
  private tokensAt = 0;

  constructor(cfg: NearIntentsConfig) {
    this.cfg = cfg;
  }

  get enabled(): boolean {
    return this.cfg.enabled;
  }

  private now(): number {
    return this.cfg.now ? this.cfg.now() : Date.now();
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const f = this.cfg.fetch ?? fetch;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.cfg.jwt) headers.Authorization = `Bearer ${this.cfg.jwt}`;
    let res: Response;
    try {
      res = await f(this.cfg.baseUrl + path, { ...init, headers, signal: AbortSignal.timeout(this.cfg.timeoutMs) });
    } catch (e) {
      if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError"))
        throw new NearIntentsError("TIMEOUT", `1Click ${path} timed out`);
      throw new NearIntentsError("UPSTREAM", `1Click ${path}: ${(e as Error).message}`);
    }
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    if (!res.ok) {
      const msg = typeof body === "object" && body && "message" in body ? String((body as { message: unknown }).message) : text;
      throw new NearIntentsError(classifyUpstream(res.status, msg), `1Click ${res.status}: ${msg}`, res.status);
    }
    return body as T;
  }

  async listTokens(): Promise<OneClickToken[]> {
    if (!this.tokens || this.now() - this.tokensAt > this.cfg.tokenTtlMs) {
      this.tokens = await this.req<OneClickToken[]>("/v0/tokens");
      this.tokensAt = this.now();
    }
    return this.tokens;
  }

  /** Map an XAUConnect (chain, address|native) pair to a 1Click token. */
  async resolve(chain: XauChainKey, token: string): Promise<OneClickToken> {
    const c = toOneClickChain(chain);
    const list = (await this.listTokens()).filter((t) => t.blockchain === c);
    let hit: OneClickToken | undefined;
    if (isNative(token)) {
      hit = list.find((t) => !t.contractAddress && t.symbol === NATIVE_SYMBOL[c]);
    } else {
      const want = c === "sol" ? token : token.toLowerCase();
      hit = list.find((t) => t.contractAddress && (c === "sol" ? t.contractAddress : t.contractAddress.toLowerCase()) === want);
    }
    if (!hit) throw new NearIntentsError("UNSUPPORTED_TOKEN", `no 1Click asset for ${token} on ${chain}`);
    return hit;
  }

  private async buildRequest(input: CrossChainQuoteInput, dry: boolean): Promise<{ req: OneClickQuoteRequest; tin: OneClickToken; tout: OneClickToken }> {
    if (!this.cfg.enabled) throw new NearIntentsError("DISABLED", "NEAR_INTENTS_ENABLED is not set");
    if (!/^\d+$/.test(input.amount) || BigInt(input.amount) <= 0n)
      throw new NearIntentsError("AMOUNT_TOO_LOW", "amount must be a positive integer in base units");
    const [tin, tout] = await Promise.all([this.resolve(input.fromChain, input.tokenIn), this.resolve(input.toChain, input.tokenOut)]);
    const req: OneClickQuoteRequest = {
      dry,
      swapType: input.swapType ?? "EXACT_INPUT",
      slippageTolerance: input.slippageBps,
      originAsset: tin.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: tout.assetId,
      amount: input.amount,
      recipient: input.recipient,
      recipientType: "DESTINATION_CHAIN",
      refundTo: input.sender,
      refundType: "ORIGIN_CHAIN",
      deadline: new Date(this.now() + 30 * 60_000).toISOString(),
    };
    if (this.cfg.referral) req.referral = this.cfg.referral;
    return { req, tin, tout };
  }

  private toQuote(input: CrossChainQuoteInput, req: OneClickQuoteRequest, q: OneClickQuote, signature: string): CrossChainQuote {
    const usdIn = Number(q.amountInUsd);
    const usdOut = Number(q.amountOutUsd);
    const at = this.now();
    return {
      venue: VENUE_ID,
      routeLabel: ROUTE_LABEL,
      fromChain: input.fromChain,
      toChain: input.toChain,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      swapType: req.swapType,
      amountIn: q.amountIn,
      minAmountIn: q.minAmountIn,
      amountOut: q.amountOut,
      minAmountOut: q.minAmountOut,
      amountInFormatted: q.amountInFormatted,
      amountOutFormatted: q.amountOutFormatted,
      amountInUsd: usdIn,
      amountOutUsd: usdOut,
      costBps: costBps(usdIn, usdOut),
      etaSeconds: q.timeEstimate,
      slippageBps: input.slippageBps,
      quotedAt: at,
      expiresAt: at + QUOTE_TTL_MS,
      request: { ...req, dry: true },
      signature,
    };
  }

  /** Dry quote only. Never creates a deposit address. */
  async quote(input: CrossChainQuoteInput): Promise<CrossChainQuote> {
    const { req } = await this.buildRequest(input, true);
    const r = await this.req<{ quote: OneClickQuote; signature: string }>("/v0/quote", { method: "POST", body: JSON.stringify(req) });
    return this.toQuote(input, req, r.quote, r.signature);
  }

  /**
   * Turn a confirmed quote into unsigned deposit instructions.
   * Requires NEAR_INTENTS_EXECUTION_ENABLED=1 and confirm === true. Makes exactly one dry:false call.
   * Aborts if the new quote is worse than the confirmed one by more than its slippage, or if it
   * would ask the user to send more than they confirmed.
   */
  async build(input: CrossChainQuoteInput, confirmed: CrossChainQuote, opts: { confirm?: boolean }): Promise<DepositInstructions> {
    if (!this.cfg.enabled) throw new NearIntentsError("DISABLED", "NEAR_INTENTS_ENABLED is not set");
    if (!this.cfg.executionEnabled) throw new NearIntentsError("EXECUTION_DISABLED", "NEAR_INTENTS_EXECUTION_ENABLED is not 1");
    if (opts.confirm !== true) throw new NearIntentsError("CONFIRM_REQUIRED", "confirm:true is required");
    if (this.now() > confirmed.expiresAt) throw new NearIntentsError("QUOTE_EXPIRED", "confirmed quote is older than 60s");
    const { req, tin } = await this.buildRequest(input, false);
    const r = await this.req<{ quote: OneClickQuote; signature: string }>("/v0/quote", { method: "POST", body: JSON.stringify(req) });
    const q = r.quote;
    if (!q.depositAddress) throw new NearIntentsError("UPSTREAM", "1Click returned no depositAddress");
    const slip = BigInt(confirmed.slippageBps);
    if (req.swapType === "EXACT_INPUT") {
      const floor = (BigInt(confirmed.amountOut) * (10_000n - slip)) / 10_000n;
      if (BigInt(q.minAmountOut) < floor) throw new NearIntentsError("PRICE_MOVED", `minAmountOut ${q.minAmountOut} < ${floor}`);
      if (BigInt(q.amountIn) > BigInt(confirmed.amountIn)) throw new NearIntentsError("AMOUNT_MISMATCH", "amountIn grew");
    } else {
      const ceil = (BigInt(confirmed.amountIn) * (10_000n + slip)) / 10_000n;
      if (BigInt(q.amountIn) > ceil) throw new NearIntentsError("PRICE_MOVED", `amountIn ${q.amountIn} > ${ceil}`);
    }
    const amount = q.amountIn;
    const ins: DepositInstructions = {
      venue: VENUE_ID,
      routeLabel: ROUTE_LABEL,
      quoteId: q.depositMemo ? `${q.depositAddress}|${q.depositMemo}` : q.depositAddress,
      chain: input.fromChain,
      depositAddress: q.depositAddress,
      depositMemo: q.depositMemo,
      amount,
      amountFormatted: q.amountInFormatted,
      minAmountOut: q.minAmountOut,
      amountOutFormatted: q.amountOutFormatted,
      deadline: q.deadline,
      quote: this.toQuote(input, req, q, r.signature),
    };
    if (input.fromChain === "solana") {
      ins.solana = tin.contractAddress
        ? { kind: "spl-transfer", to: q.depositAddress, mint: tin.contractAddress, amount, decimals: tin.decimals }
        : { kind: "system-transfer", to: q.depositAddress, amount, decimals: tin.decimals };
    } else {
      ins.evm = tin.contractAddress
        ? { to: tin.contractAddress, data: erc20TransferData(q.depositAddress, amount), value: "0" }
        : { to: q.depositAddress, data: "0x", value: amount };
    }
    return ins;
  }

  /** Optional speed-up: tell 1Click the deposit tx hash. Same gates as build(). */
  async submitDeposit(p: { quoteId: string; txHash: string; confirm?: boolean }): Promise<StatusResult> {
    if (!this.cfg.enabled) throw new NearIntentsError("DISABLED", "NEAR_INTENTS_ENABLED is not set");
    if (!this.cfg.executionEnabled) throw new NearIntentsError("EXECUTION_DISABLED", "NEAR_INTENTS_EXECUTION_ENABLED is not 1");
    if (p.confirm !== true) throw new NearIntentsError("CONFIRM_REQUIRED", "confirm:true is required");
    const [depositAddress, memo] = p.quoteId.split("|");
    const body: Record<string, string> = { txHash: p.txHash, depositAddress };
    if (memo) body.memo = memo;
    const r = await this.req<{ status: string }>("/v0/deposit/submit", { method: "POST", body: JSON.stringify(body) });
    return { status: r.status, terminal: TERMINAL_STATUSES.has(r.status), destinationTxs: [], raw: r };
  }

  /** Read-only status for /swap/cross-chain/status/{quoteId}. */
  async status(quoteId: string): Promise<StatusResult> {
    if (!this.cfg.enabled) throw new NearIntentsError("DISABLED", "NEAR_INTENTS_ENABLED is not set");
    const [depositAddress, memo] = quoteId.split("|");
    const qs = new URLSearchParams({ depositAddress });
    if (memo) qs.set("depositMemo", memo);
    const r = await this.req<{ status: string; swapDetails?: { destinationChainTxHashes?: { hash: string }[] } }>(`/v0/status?${qs}`);
    const destinationTxs = (r.swapDetails?.destinationChainTxHashes ?? []).map((t) => t.hash);
    return { status: r.status, terminal: TERMINAL_STATUSES.has(r.status), destinationTxs, raw: r };
  }
}

// ---------- framework-agnostic route handlers ----------
// Wire these into backend/src/routes/swap.ts (see patches/xauconnect/INTEGRATION.md). Quotes are cached
// server-side so build() never trusts amounts or expiry sent back by the browser, and each quoteRef can be
// built once (one deposit address per confirmed quote).

export interface HandlerResult { status: number; json: unknown }

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function addrOk(chain: XauChainKey, a: unknown): boolean {
  return typeof a === "string" && (chain === "solana" ? SOL_RE.test(a) : EVM_RE.test(a));
}

export function validateQuoteInput(b: unknown): CrossChainQuoteInput {
  const o = (b ?? {}) as Record<string, unknown>;
  const bad = (m: string) => new NearIntentsError("INVALID_ADDRESS", m);
  for (const k of ["fromChain", "toChain"]) if (!(String(o[k]) in CHAIN_TO_ONECLICK)) throw new NearIntentsError("UNSUPPORTED_CHAIN", `${k} not supported`);
  const fromChain = o.fromChain as XauChainKey, toChain = o.toChain as XauChainKey;
  if (typeof o.tokenIn !== "string" || typeof o.tokenOut !== "string") throw new NearIntentsError("UNSUPPORTED_TOKEN", "tokenIn and tokenOut required");
  if (typeof o.amount !== "string" || !/^\d{1,40}$/.test(o.amount) || BigInt(o.amount) === 0n) throw new NearIntentsError("AMOUNT_TOO_LOW", "amount must be base units");
  const slippageBps = Number(o.slippageBps ?? 100);
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 1000) throw new NearIntentsError("PRICE_MOVED", "slippageBps must be 1..1000");
  if (!addrOk(fromChain, o.sender)) throw bad("sender is not a valid address on fromChain");
  if (!addrOk(toChain, o.recipient)) throw bad("recipient is not a valid address on toChain");
  const swapType = o.swapType === "EXACT_OUTPUT" ? "EXACT_OUTPUT" : "EXACT_INPUT";
  return { fromChain, toChain, tokenIn: o.tokenIn, tokenOut: o.tokenOut, amount: o.amount, swapType, slippageBps, sender: o.sender as string, recipient: o.recipient as string };
}

const HTTP_FOR: Partial<Record<NearIntentsErrorCode, number>> = {
  DISABLED: 503, EXECUTION_DISABLED: 403, CONFIRM_REQUIRED: 403, QUOTE_EXPIRED: 410, PRICE_MOVED: 409, AMOUNT_MISMATCH: 409,
  INVALID_ADDRESS: 400, UNSUPPORTED_CHAIN: 400, UNSUPPORTED_TOKEN: 422, AMOUNT_TOO_LOW: 422, NO_ROUTE: 422, TIMEOUT: 504, UPSTREAM: 502,
};

function fail(e: unknown): HandlerResult {
  const code: NearIntentsErrorCode = e instanceof NearIntentsError ? e.code : "UPSTREAM";
  return { status: HTTP_FOR[code] ?? 502, json: { error: toUserError(e), code } };
}

export function createNearIntentsHandlers(venue: NearIntentsVenue, opts: { now?: () => number; newId?: () => string; maxEntries?: number } = {}) {
  const now = opts.now ?? (() => Date.now());
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const cache = new Map<string, { input: CrossChainQuoteInput; quote: CrossChainQuote }>();
  const prune = () => {
    for (const [k, v] of cache) if (now() > v.quote.expiresAt) cache.delete(k);
    while (cache.size > (opts.maxEntries ?? 5000)) cache.delete(cache.keys().next().value as string);
  };
  return {
    /** POST /swap/cross-chain/quote (venue=near-intents). Dry. */
    async quote(body: unknown): Promise<HandlerResult> {
      try {
        const input = validateQuoteInput(body);
        const quote = await venue.quote(input);
        prune();
        const quoteRef = newId();
        cache.set(quoteRef, { input, quote });
        return { status: 200, json: { quoteRef, quote } };
      } catch (e) { return fail(e); }
    },
    /** POST /swap/cross-chain/build { quoteRef, confirm: true }. Gated; one build per quoteRef. */
    async build(body: unknown): Promise<HandlerResult> {
      try {
        const b = (body ?? {}) as { quoteRef?: string; confirm?: unknown };
        const hit = b.quoteRef ? cache.get(b.quoteRef) : undefined;
        if (!hit) throw new NearIntentsError("QUOTE_EXPIRED", "unknown or used quoteRef");
        const deposit = await venue.build(hit.input, hit.quote, { confirm: b.confirm === true });
        cache.delete(b.quoteRef as string);
        return { status: 200, json: { deposit } };
      } catch (e) { return fail(e); }
    },
    /** GET /swap/cross-chain/status/{quoteId} for near-intents quote ids. */
    async status(quoteId: string): Promise<HandlerResult> {
      try {
        const s = await venue.status(quoteId);
        return { status: 200, json: { status: s.status, terminal: s.terminal, destinationTxs: s.destinationTxs } };
      } catch (e) { return fail(e); }
    },
    /** POST /swap/cross-chain/submit-deposit { quoteId, txHash, confirm: true }. Optional speed-up. */
    async submitDeposit(body: unknown): Promise<HandlerResult> {
      try {
        const b = (body ?? {}) as { quoteId?: string; txHash?: string; confirm?: unknown };
        if (!b.quoteId || !b.txHash) throw new NearIntentsError("UPSTREAM", "quoteId and txHash required");
        const s = await venue.submitDeposit({ quoteId: b.quoteId, txHash: b.txHash, confirm: b.confirm === true });
        return { status: 200, json: { status: s.status, terminal: s.terminal } };
      } catch (e) { return fail(e); }
    },
  };
}
