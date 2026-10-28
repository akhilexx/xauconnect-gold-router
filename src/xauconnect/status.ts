/**
 * Deposit status polling and timeline copy for cross-chain XAU Routes.
 *
 * Target path in the XAUConnect repo: apps/web/src/lib/near-intents/status.ts
 * Self-contained. Polls XAUConnect's GET /swap/cross-chain/status/{quoteId} (or any getter)
 * until a terminal state. Copy never names the venue.
 */

export const TERMINAL = new Set(["SUCCESS", "REFUNDED", "FAILED"]);

export interface Step { key: string; label: string }

export const STEPS: readonly Step[] = [
  { key: "sent", label: "Deposit sent from your wallet" },
  { key: "seen", label: "Deposit confirmed" },
  { key: "routing", label: "Routing to gold" },
  { key: "done", label: "Delivered" },
];

/** Index of the current step (0..3) plus a terminal outcome if any. */
export function timeline(status: string): { step: number; outcome?: "delivered" | "refunded" | "failed"; label: string } {
  switch (status) {
    case "PENDING_DEPOSIT": return { step: 0, label: "Waiting for your deposit" };
    case "KNOWN_DEPOSIT_TX": return { step: 1, label: "Deposit seen, waiting for confirmations" };
    case "INCOMPLETE_DEPOSIT": return { step: 1, label: "Deposit is below the quoted amount; it will be refunded if not topped up" };
    case "PROCESSING": return { step: 2, label: "Routing to gold" };
    case "SUCCESS": return { step: 3, outcome: "delivered", label: "Delivered" };
    case "REFUNDED": return { step: 3, outcome: "refunded", label: "Refunded to your wallet" };
    case "FAILED": return { step: 3, outcome: "failed", label: "Route failed. Contact support with your deposit tx" };
    default: return { step: 0, label: "Checking status" };
  }
}

export interface PollOptions {
  intervalMs?: number;
  maxPolls?: number;
  onUpdate?: (status: string) => void;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

/** Polls until SUCCESS/REFUNDED/FAILED, maxPolls, or abort. Returns the last status seen. */
export async function pollStatus(get: () => Promise<{ status: string }>, o: PollOptions = {}): Promise<{ status: string; polls: number; terminal: boolean }> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const max = o.maxPolls ?? 240;
  let last = "UNKNOWN";
  for (let i = 1; i <= max; i++) {
    if (o.signal?.aborted) return { status: last, polls: i - 1, terminal: false };
    try {
      last = (await get()).status;
      o.onUpdate?.(last);
      if (TERMINAL.has(last)) return { status: last, polls: i, terminal: true };
    } catch {
      /* transient; keep polling */
    }
    if (i < max) await sleep(o.intervalMs ?? 5000);
  }
  return { status: last, polls: max, terminal: false };
}
