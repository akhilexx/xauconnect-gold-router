# Hand edits to existing XAUConnect files

The router repo's box has no copy of the XAUConnect source. That means the edits below are **not
diffs against real code**. They are snippets with "find this anchor" instructions, built from the
documented paths and behaviour in `docs/SWAP_EXECUTION.md` and the factsheet, which says the
backend is Express and the web app is Next.js 15. Function and variable names inside these files
are guesses and marked `ADAPT`. Apply them on branch `near-intents-hackathon` after `git am`
has added the new files.

Order: 1 → 2 → 3 → 4 → 5 → 6. Run `pnpm -w typecheck` (or the repo's equivalent) after each one.

## 1. `.env.example` (repo root)

Append:

```dotenv
# NEAR Intents venue for cross-chain XAU Routes (hackathon branch). Off by default.
NEAR_INTENTS_ENABLED=false
# 1 lets /swap/cross-chain/build request a real deposit address (each build still needs confirm:true)
NEAR_INTENTS_EXECUTION_ENABLED=
ONECLICK_BASE_URL=https://1click.chaindefuser.com
# Optional. Without it 1Click adds a 0.2% fee. Never commit a real value.
ONECLICK_JWT=
NEAR_INTENTS_REFERRAL=xauconnect
ONECLICK_TIMEOUT_MS=8000
```

## 2. `backend/src/services/routing/cross-chain.ts`

Anchor: the function that builds the list of cross-chain quotes (behind `POST /swap/cross-chain/quote`).

```ts
import { NearIntentsVenue, nearIntentsConfigFromEnv, createNearIntentsHandlers } from "./near-intents";

export const nearIntents = new NearIntentsVenue(nearIntentsConfigFromEnv(process.env));
export const nearIntentsHandlers = createNearIntentsHandlers(nearIntents);
```

If cross-chain.ts gathers quotes from several venues into one list, add NEAR Intents as one more
candidate **only when `nearIntents.enabled`**. Map the existing request to `CrossChainQuoteInput`.
ADAPT the field names:

```ts
// ADAPT: req.fromChain/req.toChain are XAUConnect chain keys (ethereum|bsc|polygon|arbitrum|base|avalanche|solana)
if (nearIntents.enabled) {
  candidates.push(
    nearIntentsHandlers.quote({
      fromChain: req.fromChain, toChain: req.toChain, tokenIn: req.tokenIn, tokenOut: req.tokenOut,
      amount: req.amountIn /* base units */, slippageBps: req.slippageBps, sender: req.fromAddress, recipient: req.toAddress,
    }).then((r) => (r.status === 200 ? { venue: "near-intents", ...(r.json as object) } : null)),
  );
}
```

Ranking: compare `quote.amountOutUsd` (or `quote.costBps`) with the existing cross-chain quotes.
A quote from this venue keeps its `quoteRef`, and the build step must send it back.

## 3. `backend/src/routes/swap.ts` (Express)

Anchor: next to the existing `/swap/cross-chain/*` routes.

```ts
import { nearIntentsHandlers } from "../services/routing/cross-chain";

// Explicit venue routes (simplest to review). The generic /swap/cross-chain/* routes can dispatch here when venue === "near-intents".
router.post("/swap/cross-chain/near-intents/quote", async (req, res) => {
  const r = await nearIntentsHandlers.quote(req.body);
  res.status(r.status).json(r.json);
});
router.post("/swap/cross-chain/near-intents/build", async (req, res) => {
  const r = await nearIntentsHandlers.build(req.body); // { quoteRef, confirm: true }
  res.status(r.status).json(r.json);
});
router.post("/swap/cross-chain/submit-deposit", async (req, res) => {
  const r = await nearIntentsHandlers.submitDeposit(req.body); // { quoteId, txHash, confirm: true }
  res.status(r.status).json(r.json);
});
```

In the existing `GET /swap/cross-chain/status/:quoteId` handler, add this branch before the
current lookup. NEAR Intents quote ids are deposit addresses, optionally `addr|memo`. Mark them
in the record (ADAPT) or try this venue when the id is not a known internal quote id:

```ts
if (isNearIntentsQuoteId(req.params.quoteId)) { // ADAPT: e.g. look up the venue saved by /api/swap/record
  const r = await nearIntentsHandlers.status(req.params.quoteId);
  return res.status(r.status).json(r.json);
}
```

`/api/swap/record`: record NEAR Intents swaps with `venue: "near-intents"` and the deposit tx
hash, the same way other swaps are recorded. That keeps volume and fee stats consistent.

## 4. `backend/src/lib/user-errors.ts` and `apps/web/src/lib/user-errors.ts`

The handlers already return `{ error, code }` with `error` taken from `USER_ERRORS` in
near-intents.ts, and that copy never names a venue. If the app maps codes centrally, add these
codes: `DISABLED, EXECUTION_DISABLED, CONFIRM_REQUIRED, UNSUPPORTED_CHAIN, UNSUPPORTED_TOKEN,
AMOUNT_TOO_LOW, INVALID_ADDRESS, NO_ROUTE, PRICE_MOVED, AMOUNT_MISMATCH, QUOTE_EXPIRED, TIMEOUT,
UPSTREAM`. Copy the strings from `USER_ERRORS` so backend and web stay identical.

## 5. `apps/web/src/components/swap/swap-panel.tsx`

Anchor: `executeCompositeCrossChain` (it calls `sendTransactionAsync({to,data,value})`).

```ts
import { sendEvmDeposit, sendSolanaDeposit, reportDeposit } from "@/lib/near-intents/deposit"; // ADAPT alias
import { NearIntentsStatus } from "@/components/swap/near-intents-status";

// when the selected cross-chain quote has venue === "near-intents":
const built = await api.post("/swap/cross-chain/near-intents/build", { quoteRef: selected.quoteRef, confirm: true }); // ADAPT api client
const ins = built.deposit;
const txHash = ins.evm
  ? await sendEvmDeposit(ins, sendTransactionAsync)            // no approve() needed: plain ERC-20 transfer
  : await sendSolanaDeposit(ins, { payer: solanaPublicKey, getLatestBlockhash, signTransaction, submitSigned }); // ADAPT to existing Solana submit helper
await reportDeposit(API_BASE, ins.quoteId, txHash).catch(() => {}); // optional speed-up
setNearIntentsQuoteId(ins.quoteId); // render <NearIntentsStatus quoteId=... apiBase=API_BASE />
```

The confirm button must sit behind a visible review step: amount, receiving wallet, and "I
reviewed" ticked. That step is where `confirm: true` comes from.

## 6. Gold Curve token page

Anchor: the token page that renders the existing Gold Curve buy panel
(`/token/solana/<mint>`; the component is probably under `apps/web/src/components/launchpad/`
or `apps/web/src/app/token/...`; ADAPT).

```tsx
import { FundFromAnotherChain } from "@/components/launchpad/fund-from-another-chain";

{pool.isGoldCurve && process.env.NEXT_PUBLIC_NEAR_INTENTS_ENABLED === "true" ? (
  <FundFromAnotherChain
    mint={mint} poolConfig={pool.config /* DBC config account */} raisedSoFar={pool.quoteRaised /* in SOL/USDC, ADAPT */}
    solanaWallet={solanaAddress} evmAddress={evmAddress}
    getQuote={(body) => api.post("/swap/cross-chain/near-intents/quote", body)}
    onConfirm={async (quoteRef) => { /* same as step 5: build -> sendEvmDeposit -> reportDeposit -> status */ }}
  />
) : null}
```

Add `NEXT_PUBLIC_NEAR_INTENTS_ENABLED=false` to the web env.

## Label

User-facing label: **"XAU Route"**. The optional disclosure line **"XAU Route · settled on NEAR
Intents"** (`SETTLEMENT_NOTE`, and `showSettlementNote` in the status component) needs the
owner's OK before it is turned on.
