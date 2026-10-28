/**
 * Status timeline for a cross-chain XAU Route deposit.
 * Target path: apps/web/src/components/swap/near-intents-status.tsx
 * NOT tested in the router repo. Plain elements; swap classNames for the app's design system.
 */
import { useEffect, useState } from "react";
import { STEPS, pollStatus, timeline } from "../../lib/near-intents/status";

export function NearIntentsStatus(props: { quoteId: string; apiBase: string; onDone?: (status: string) => void; showSettlementNote?: boolean }) {
  const [status, setStatus] = useState("PENDING_DEPOSIT");
  useEffect(() => {
    const ac = new AbortController();
    const get = async () => {
      const r = await fetch(`${props.apiBase}/swap/cross-chain/status/${encodeURIComponent(props.quoteId)}`, { signal: ac.signal });
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as { status: string };
    };
    pollStatus(get, { intervalMs: 5000, signal: ac.signal, onUpdate: setStatus }).then((r) => { if (r.terminal) props.onDone?.(r.status); });
    return () => ac.abort();
  }, [props.quoteId, props.apiBase]);
  const t = timeline(status);
  return (
    <div role="status" aria-live="polite">
      <ol>
        {STEPS.map((s, i) => (
          <li key={s.key} data-state={i < t.step ? "done" : i === t.step ? "current" : "todo"}>{s.label}</li>
        ))}
      </ol>
      <p>{t.label}</p>
      {/* Disclosure wording needs owner sign-off before enabling. */}
      {props.showSettlementNote ? <p>XAU Route · settled on NEAR Intents</p> : null}
    </div>
  );
}
