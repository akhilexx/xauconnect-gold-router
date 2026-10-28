import type { RoutePlan } from "./types.ts";

export function formatPlan(p: RoutePlan): string {
  const out: string[] = [];
  out.push(`Route plan ${p.intentId} (dry run, nothing sent)`);
  for (const l of p.legs) {
    out.push(
      `  ${l.source.amount} ${l.source.symbol}@${l.source.chain} -> ${l.amountOutFormatted} ${l.delivery.symbol}@${l.delivery.chain}` +
        ` [${l.delivery.mode}]  in $${l.amountInUsd.toFixed(2)} out $${l.amountOutUsd.toFixed(2)}  cost ${l.costBps} bps  ~${l.timeEstimateSec}s`,
    );
  }
  if (p.alternatives.length) {
    out.push("  alternatives considered:");
    for (const a of p.alternatives)
      out.push(`    ${a.source.symbol}@${a.source.chain} -> ${a.delivery.symbol}@${a.delivery.chain} [${a.delivery.mode}] cost ${a.costBps} bps`);
  }
  for (const r of p.rejected) out.push(`  BLOCKED by policy: ${r.source.amount} ${r.source.symbol}@${r.source.chain}: ${r.reason}`);
  for (const f of p.failures) out.push(`  no quote: ${f.source.symbol}@${f.source.chain} -> ${f.delivery.symbol}@${f.delivery.chain}: ${f.error}`);
  out.push(`  TOTAL in $${p.totals.amountInUsd} -> out $${p.totals.amountOutUsd}  (${p.totals.costBps} bps, slowest leg ~${p.totals.maxTimeSec}s)`);
  return out.join("\n");
}
