/**
 * "Fund from another chain" panel for a Gold Curve token page.
 * Target path: apps/web/src/components/launchpad/fund-from-another-chain.tsx
 * NOT tested in the router repo. Side effects come in as props so it fits the app's API client and wallets:
 *   getQuote   -> POST /swap/cross-chain/quote  (venue near-intents, dry)
 *   onConfirm  -> POST /swap/cross-chain/build {quoteRef, confirm:true}, then deposit.ts sendEvmDeposit
 * After delivery the user buys with the existing Gold Curve buy widget on the same page.
 */
import { useMemo, useState } from "react";
import { planFunding, type CrossChainQuoteBody } from "../../lib/near-intents/fund-curve";

/** USDC per EVM chain as listed by the venue (checked against the live token list on 2026-10-28). */
export const USDC_BY_CHAIN: Record<string, string> = {
  ethereum: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  arbitrum: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  base: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  polygon: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
  bsc: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
  avalanche: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
};

export interface QuoteView { quoteRef: string; quote: { amountInFormatted: string; amountOutFormatted: string; amountInUsd: number; etaSeconds: number; routeLabel: string } }

export function FundFromAnotherChain(props: {
  mint: string;
  poolConfig: string;
  raisedSoFar?: number;
  solanaWallet?: string;
  evmAddress?: string;
  getQuote: (body: CrossChainQuoteBody) => Promise<QuoteView>;
  onConfirm: (quoteRef: string) => Promise<void>;
}) {
  const [chain, setChain] = useState<keyof typeof USDC_BY_CHAIN>("arbitrum");
  const [want, setWant] = useState("");
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const plan = useMemo(() => {
    try {
      if (!want || !props.solanaWallet || !props.evmAddress) return null;
      return planFunding({
        mint: props.mint, poolConfig: props.poolConfig, connectedWallet: props.solanaWallet,
        from: { chain: chain as CrossChainQuoteBody["fromChain"], token: USDC_BY_CHAIN[chain], sender: props.evmAddress },
        want, raisedSoFar: props.raisedSoFar,
      });
    } catch (e) { return { error: (e as Error).message } as const; }
  }, [want, chain, props.mint, props.poolConfig, props.solanaWallet, props.evmAddress, props.raisedSoFar]);

  const fetchQuote = async () => {
    if (!plan || "error" in plan) return;
    setBusy(true); setError(null); setQuote(null); setReviewed(false);
    try { setQuote(await props.getQuote(plan.body)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (!props.solanaWallet) return <p>Connect a Solana wallet to receive the curve's quote token.</p>;
  if (!props.evmAddress) return <p>Connect the wallet you want to pay from.</p>;
  return (
    <section aria-label="Fund from another chain">
      <h3>Fund from another chain</h3>
      <label>Pay with USDC on
        <select value={chain} onChange={(e) => setChain(e.target.value)}>
          {Object.keys(USDC_BY_CHAIN).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label>Receive on Solana ({plan && !("error" in plan) ? plan.quoteToken : "quote token"})
        <input inputMode="decimal" value={want} onChange={(e) => setWant(e.target.value)} placeholder="0.5" />
      </label>
      {plan && "error" in plan ? <p role="alert">{plan.error}</p> : null}
      {plan && !("error" in plan) && plan.graduation?.warning ? <p role="alert">{plan.graduation.warning}</p> : null}
      <button type="button" disabled={!plan || "error" in plan || busy} onClick={fetchQuote}>Get XAU Route</button>
      {quote ? (
        <div>
          <p>{quote.quote.routeLabel}: pay {quote.quote.amountInFormatted} USDC (~${quote.quote.amountInUsd.toFixed(2)}) and receive {quote.quote.amountOutFormatted} in your Solana wallet in about {quote.quote.etaSeconds}s.</p>
          <label><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I reviewed the amount and the receiving wallet</label>
          <button type="button" disabled={!reviewed || busy} onClick={async () => { setBusy(true); try { await props.onConfirm(quote.quoteRef); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
            Confirm in wallet
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <p>When it arrives, buy with the Gold Curve panel on this page.</p>
    </section>
  );
}
