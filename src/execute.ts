// Wallet-signed deposit flow for a router plan (backlog item 2, router side).
//
// NEW (hackathon) code. Nothing here signs, holds keys, or moves funds. It turns one confirmed
// plan leg into unsigned deposit instructions that the user's own wallet would sign:
//   EVM ERC-20  -> { to: token, data: transfer(depositAddress, amount), value: 0 }
//   EVM native  -> { to: depositAddress, value: amount }
//   Solana      -> SystemProgram.Transfer or SPL TransferChecked to the deposit address
//
// Gates, all checked before any network call:
//   1. the request carries confirm: true
//   2. the server runs with EXECUTION_ENABLED=1 (default off)
//   3. policy limits re-checked against the leg now, not at plan time
// Then: a plan older than 60s is re-quoted (dry) first; a quote whose minAmountOut is worse than
// the plan's amountOut minus slippage aborts; exactly one dry:false request per leg, for exactly the
// plan's amount; a leg can be prepared once.
//
// There is no 1Click testnet. With EXECUTION_ENABLED unset (the default and the only mode used in
// this repo's tests and demos) no deposit address is ever requested.

import type { OneClickClient } from "./oneclick.ts";
import { checkOutput, checkSource, type Policy } from "./policy.ts";
import type { TokenRegistry } from "./registry.ts";
import type { QuoteRequest, QuoteResponse, RouteOption, RoutePlan } from "./types.ts";
import { toBaseUnits } from "./units.ts";
import { erc20TransferData, TERMINAL_STATUSES } from "./xauconnect/near-intents.ts";
import { splTransferCheckedData, systemTransferData, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./xauconnect/solana-deposit-ix.ts";

export const STALE_MS = 60_000;

export type ExecCode =
  | "CONFIRM_REQUIRED" | "EXECUTION_DISABLED" | "UNKNOWN_PLAN" | "UNKNOWN_LEG" | "ALREADY_PREPARED"
  | "POLICY" | "PRICE_MOVED" | "AMOUNT_MISMATCH" | "NO_DEPOSIT_ADDRESS" | "UNSUPPORTED_ORIGIN";

export class ExecutionError extends Error {
  code: ExecCode;
  constructor(code: ExecCode, message: string) {
    super(message);
    this.name = "ExecutionError";
    this.code = code;
  }
}

export interface ExecDeps {
  client: Pick<OneClickClient, "quote">;
  registry: TokenRegistry;
  policy: Policy;
  env: Record<string, string | undefined>;
  now?: () => Date;
  referral?: string;
}

export interface LegDeposit {
  intentId: string;
  leg: number;
  chain: string;
  depositAddress: string;
  depositMemo?: string;
  asset: { symbol: string; decimals: number; contractAddress: string | null };
  amount: string; // base units, equals the plan leg amount
  amountFormatted: string;
  minAmountOut: string;
  deadline?: string;
  requoted: boolean;
  evm?: { to: string; data: string; value: string };
  solana?: { programId: string; kind: "system-transfer" | "spl-transfer"; to: string; mint?: string; dataHex: string };
  manual?: string; // chains we don't encode: plain-language instruction only
  note: string;
}

const EVM = new Set(["eth", "arb", "base", "op", "pol", "bsc", "avax", "gnosis", "bera", "scroll", "monad", "xlayer", "abs", "plasma"]);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** In-memory plan store: remembers plan creation time and which legs were already prepared. */
export class PlanStore {
  private plans = new Map<string, { plan: RoutePlan; prepared: Set<number> }>();
  put(plan: RoutePlan): void {
    this.plans.set(plan.intentId, { plan, prepared: new Set() });
    if (this.plans.size > 500) this.plans.delete(this.plans.keys().next().value as string);
  }
  get(id: string): { plan: RoutePlan; prepared: Set<number> } | undefined {
    return this.plans.get(id);
  }
}

export function assertExecutionAllowed(confirm: unknown, env: Record<string, string | undefined>): void {
  if (confirm !== true) throw new ExecutionError("CONFIRM_REQUIRED", "execute needs { confirm: true } after the user reviewed the plan");
  if (env.EXECUTION_ENABLED !== "1") throw new ExecutionError("EXECUTION_DISABLED", "execution is off (set EXECUTION_ENABLED=1 to allow deposit addresses)");
}

function legRequest(plan: RoutePlan, leg: RouteOption, decimals: number, dry: boolean, deps: ExecDeps): QuoteRequest {
  const now = deps.now ? deps.now() : new Date();
  return {
    dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: plan.slippageBps ?? 50,
    originAsset: leg.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: leg.destinationAsset,
    amount: toBaseUnits(leg.source.amount, decimals),
    recipient: leg.delivery.recipient,
    recipientType: leg.delivery.mode,
    refundTo: leg.source.refundTo,
    refundType: "ORIGIN_CHAIN",
    deadline: new Date(now.getTime() + 30 * 60_000).toISOString(),
    ...(deps.referral ? { referral: deps.referral } : {}),
  };
}

function floorOut(amountOut: string, slippageBps: number): bigint {
  return (BigInt(amountOut) * BigInt(10_000 - slippageBps)) / 10_000n;
}

export async function prepareLegDeposit(
  store: PlanStore, intentId: string, legIndex: number, opts: { confirm?: unknown }, deps: ExecDeps,
): Promise<LegDeposit> {
  assertExecutionAllowed(opts.confirm, deps.env);
  const entry = store.get(intentId);
  if (!entry) throw new ExecutionError("UNKNOWN_PLAN", `no plan ${intentId}; plan again`);
  const { plan, prepared } = entry;
  const leg = plan.legs[legIndex];
  if (!leg) throw new ExecutionError("UNKNOWN_LEG", `plan has no leg ${legIndex}`);
  if (prepared.has(legIndex)) throw new ExecutionError("ALREADY_PREPARED", `leg ${legIndex} already has a deposit address`);

  // Policy is re-checked now: limits may have been tightened since planning.
  const token = deps.registry.resolve(leg.source.symbol, leg.source.chain);
  const why = checkSource(deps.policy, leg.source, token) ?? checkOutput(deps.policy, leg.delivery.symbol, leg.delivery.chain);
  if (why) throw new ExecutionError("POLICY", why);
  if (leg.costBps > deps.policy.maxCostBps) throw new ExecutionError("POLICY", `cost ${leg.costBps} bps exceeds policy max ${deps.policy.maxCostBps} bps`);

  const slip = plan.slippageBps ?? 50;
  const planAmount = toBaseUnits(leg.source.amount, token.decimals);
  let refOut = leg.amountOut;
  let requoted = false;
  const now = deps.now ? deps.now() : new Date();
  if (now.getTime() - Date.parse(plan.createdAt) > STALE_MS) {
    const fresh = await deps.client.quote(legRequest(plan, leg, token.decimals, true, deps));
    if (BigInt(fresh.quote.minAmountOut) < floorOut(leg.amountOut, slip))
      throw new ExecutionError("PRICE_MOVED", `fresh minAmountOut ${fresh.quote.minAmountOut} is below plan amountOut ${leg.amountOut} minus ${slip} bps`);
    refOut = fresh.quote.amountOut;
    requoted = true;
  }

  prepared.add(legIndex); // mark before the call: never two deposit addresses for one leg
  const live: QuoteResponse = await deps.client.quote(legRequest(plan, leg, token.decimals, false, deps));
  const q = live.quote;
  if (!q.depositAddress) throw new ExecutionError("NO_DEPOSIT_ADDRESS", "1Click returned no deposit address");
  if (BigInt(q.amountIn) > BigInt(planAmount)) throw new ExecutionError("AMOUNT_MISMATCH", `quote wants ${q.amountIn}, plan says ${planAmount}`);
  if (BigInt(q.minAmountOut) < floorOut(refOut, slip))
    throw new ExecutionError("PRICE_MOVED", `minAmountOut ${q.minAmountOut} is below ${refOut} minus ${slip} bps`);

  const out: LegDeposit = {
    intentId, leg: legIndex, chain: leg.source.chain,
    depositAddress: q.depositAddress, depositMemo: (q as { depositMemo?: string }).depositMemo,
    asset: { symbol: token.symbol, decimals: token.decimals, contractAddress: token.contractAddress ?? null },
    amount: planAmount, amountFormatted: leg.source.amount, minAmountOut: q.minAmountOut, deadline: q.deadline, requoted,
    note: "Unsigned. Sign and send from your own wallet before the deadline, then optionally POST /v1/deposits/submit with the tx hash.",
  };
  const ca = token.contractAddress ?? null;
  if (EVM.has(leg.source.chain)) {
    out.evm = ca ? { to: ca, data: erc20TransferData(q.depositAddress, planAmount), value: "0" } : { to: q.depositAddress, data: "0x", value: planAmount };
  } else if (leg.source.chain === "sol") {
    out.solana = ca
      ? { programId: TOKEN_PROGRAM_ID, kind: "spl-transfer", to: q.depositAddress, mint: ca, dataHex: hex(splTransferCheckedData(planAmount, token.decimals)) }
      : { programId: SYSTEM_PROGRAM_ID, kind: "system-transfer", to: q.depositAddress, dataHex: hex(systemTransferData(planAmount)) };
  } else {
    out.manual = `Send exactly ${leg.source.amount} ${token.symbol} on ${leg.source.chain} to ${q.depositAddress}${out.depositMemo ? ` with memo ${out.depositMemo}` : ""}.`;
  }
  return out;
}

/** Report a deposit tx hash to 1Click. Same gates. Never sends anything on-chain. */
export async function submitDepositTx(
  body: { txHash: string; depositAddress: string; memo?: string; confirm?: unknown },
  deps: { client: Pick<OneClickClient, "depositSubmit">; env: Record<string, string | undefined> },
): Promise<{ status: string }> {
  assertExecutionAllowed(body.confirm, deps.env);
  if (!body.txHash || !body.depositAddress) throw new ExecutionError("UNKNOWN_LEG", "txHash and depositAddress are required");
  return deps.client.depositSubmit({ txHash: body.txHash, depositAddress: body.depositAddress, ...(body.memo ? { memo: body.memo } : {}) });
}

export { TERMINAL_STATUSES };
