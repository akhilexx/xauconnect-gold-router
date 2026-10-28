// Multi-chain router: fan out dry quotes on NEAR Intents for every (source, delivery) pair,
// rank them by net value delivered, and return one best leg per source plus alternatives.

import { randomUUID } from "node:crypto";
import type { OneClickClient } from "./oneclick.ts";
import { checkOutput, checkSource, type Policy } from "./policy.ts";
import type { TokenRegistry } from "./registry.ts";
import type { QuoteRequest, RouteFailure, RouteIntent, RouteOption, RoutePlan } from "./types.ts";
import { toBaseUnits } from "./units.ts";

export interface RouterDeps {
  client: Pick<OneClickClient, "quote">;
  registry: TokenRegistry;
  policy: Policy;
  now?: () => Date;
  quoteTtlMs?: number;
  referral?: string;
}

export async function planRoute(intent: RouteIntent, deps: RouterDeps): Promise<RoutePlan> {
  const now = deps.now ?? (() => new Date());
  const slippage = Math.min(intent.slippageBps ?? 50, deps.policy.maxSlippageBps);
  const deadline = new Date(now().getTime() + (deps.quoteTtlMs ?? 10 * 60_000)).toISOString();

  const rejected: RoutePlan["rejected"] = [];
  const failures: RouteFailure[] = [];
  const options: RouteOption[] = [];

  // Policy: total notional across all sources.
  let totalUsd = 0;
  const jobs: Promise<void>[] = [];

  for (const source of intent.sources) {
    let inToken;
    try {
      inToken = deps.registry.resolve(source.symbol, source.chain);
    } catch (e) {
      rejected.push({ source, reason: (e as Error).message });
      continue;
    }
    const why = checkSource(deps.policy, source, inToken);
    if (why) { rejected.push({ source, reason: why }); continue; }
    const legUsd = Number(source.amount) * inToken.price;
    if (totalUsd + legUsd > deps.policy.maxUsdTotal) {
      rejected.push({ source, reason: `total would exceed policy max $${deps.policy.maxUsdTotal}` });
      continue;
    }
    totalUsd += legUsd;

    for (const delivery of intent.deliveries) {
      const outWhy = checkOutput(deps.policy, delivery.symbol, delivery.chain);
      if (outWhy) { failures.push({ source, delivery, error: outWhy }); continue; }
      let outToken;
      try { outToken = deps.registry.resolve(delivery.symbol, delivery.chain); }
      catch (e) { failures.push({ source, delivery, error: (e as Error).message }); continue; }

      const req: QuoteRequest = {
        dry: true,
        swapType: "EXACT_INPUT",
        slippageTolerance: slippage,
        originAsset: inToken.assetId,
        depositType: "ORIGIN_CHAIN",
        destinationAsset: outToken.assetId,
        amount: toBaseUnits(source.amount, inToken.decimals),
        recipient: delivery.recipient,
        recipientType: delivery.mode,
        refundTo: source.refundTo,
        refundType: "ORIGIN_CHAIN",
        deadline,
        ...(deps.referral ? { referral: deps.referral } : {}),
      };
      jobs.push(
        deps.client.quote(req).then(
          (r) => {
            const inUsd = Number(r.quote.amountInUsd);
            const outUsd = Number(r.quote.amountOutUsd);
            const costBps = inUsd > 0 ? Math.round(((inUsd - outUsd) / inUsd) * 10_000) : 0;
            if (costBps > deps.policy.maxCostBps) {
              failures.push({ source, delivery, error: `cost ${costBps} bps exceeds policy max ${deps.policy.maxCostBps} bps` });
              return;
            }
            options.push({
              source, delivery,
              originAsset: inToken.assetId, destinationAsset: outToken.assetId,
              amountInUsd: inUsd, amountOut: r.quote.amountOut, amountOutFormatted: r.quote.amountOutFormatted,
              amountOutUsd: outUsd, minAmountOut: r.quote.minAmountOut,
              timeEstimateSec: r.quote.timeEstimate, costBps, signature: r.signature,
              provider: "near-intents-1click",
            });
          },
          (e: Error) => { failures.push({ source, delivery, error: e.message }); },
        ),
      );
    }
  }

  await Promise.all(jobs);

  // Rank: lowest cost first, then fastest.
  options.sort((a, b) => a.costBps - b.costBps || a.timeEstimateSec - b.timeEstimateSec);
  const legs: RouteOption[] = [];
  const alternatives: RouteOption[] = [];
  const seen = new Set<Source>();
  for (const o of options) {
    if (!seen.has(o.source)) { seen.add(o.source); legs.push(o); } else alternatives.push(o);
  }
  // Keep legs in the user's source order for readability.
  legs.sort((a, b) => intent.sources.indexOf(a.source) - intent.sources.indexOf(b.source));

  const inUsd = legs.reduce((s, l) => s + l.amountInUsd, 0);
  const outUsd = legs.reduce((s, l) => s + l.amountOutUsd, 0);
  return {
    intentId: randomUUID(),
    createdAt: now().toISOString(),
    dry: true,
    slippageBps: slippage,
    legs, alternatives, failures, rejected,
    totals: {
      amountInUsd: round2(inUsd), amountOutUsd: round2(outUsd),
      costBps: inUsd > 0 ? Math.round(((inUsd - outUsd) / inUsd) * 10_000) : 0,
      maxTimeSec: legs.reduce((m, l) => Math.max(m, l.timeEstimateSec), 0),
    },
  };
}

type Source = RouteIntent["sources"][number];
const round2 = (n: number) => Math.round(n * 100) / 100;
