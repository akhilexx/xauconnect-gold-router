# Hand edits to existing XAUConnect files

**Verified against public `akhilexx/xauconnect` main `73c354c`** (2026-10-19 01:30 IST, the last commit
before the hackathon announcement). Read on 29 Oct 2026 through the GitHub contents API. Every anchor
below was found in those exact bytes. If the owner's Mac copy has moved past `73c354c`, re-check the
anchors there first.

Most of the wiring is now in real patches, so only **three** hand edits are left:

| Was (28 Oct, written blind) | Now |
|---|---|
| §2 edit `cross-chain.ts` | **Dropped.** `CrossChainQuoteSchema.provider` is `z.enum(["0x-cross-chain","1inch-fusion-plus"])` in `packages/utils/src/schemas.ts`, and `/cross-chain/build` validates against it. Putting the venue into `quoteCrossChain()` would mean widening a shared schema that the existing `buildCrossChain()` dispatch also relies on. The venue gets its own sub-router instead, and existing routes stay unchanged |
| §3 edit `routes/swap.ts` | **Patch 0006** (real diff, applies with plain `git am`): one import, plus `swapRouter.use("/cross-chain/near-intents", nearIntentsRouter)` |
| §4 `user-errors.ts` | **Dropped.** The sub-router returns the backend's own `{error:{code,message}}` envelope, using `NEAR_INTENTS_*` codes and copy that is already safe to show users (it passes the `INTERNAL_MARKERS` regex in both user-errors files) |
| backend had no test runner | **Patch 0006** adds `"test": "tsx --test …"` to `backend/package.json` (`tsx` is already a devDependency) |

Bugs that were found by checking against the real compiler settings, and are now fixed:
- `backend/tsconfig.json` uses `module`/`moduleResolution: NodeNext`, and CI runs `pnpm typecheck` and `pnpm build`. Because of that, the shipped test's extensionless `import … from "./near-intents"` would have failed CI. It is now `./near-intents.js`.
- `tsconfig.base.json` has `noUncheckedIndexedAccess: true`. That turned up three `string | undefined` errors (in `near-intents.ts` status/submit and `fund-curve.ts` toBase, and in `fund-from-another-chain.tsx`). All three are fixed.
- `scripts/typecheck-xau-mirror.sh` now type-checks the whole patch tree with those exact settings, against the real neighbouring files (`middleware/error.ts`, `lib/user-errors.ts`, `utils/schemas.ts`, `utils/chains.ts`, all byte-identical). It also proves at compile time that our request, quote and build shapes are assignable to the real `CrossChainQuoteRequest`, `CrossChainQuote` and `CrossChainBuild`, with `provider` as the only exception.

## 1. `.env.example` (repo root), append

`.env.example` was not opened, on purpose (we don't touch env files). Append this block by hand:

```dotenv
# NEAR Intents venue for cross-chain XAU Routes (hackathon branch). Off by default.
NEAR_INTENTS_ENABLED=false
# 1 lets /swap/cross-chain/near-intents/build request a real deposit address (each build still needs confirm:true)
NEAR_INTENTS_EXECUTION_ENABLED=
ONECLICK_BASE_URL=https://1click.chaindefuser.com
# Optional. Without it 1Click adds a 0.2% fee. Never commit a real value.
ONECLICK_JWT=
NEAR_INTENTS_REFERRAL=xauconnect
ONECLICK_TIMEOUT_MS=8000
NEXT_PUBLIC_NEAR_INTENTS_ENABLED=false
```

`backend/src/routes/near-intents.ts` reads these from `process.env`. `backend/src/config.ts` doesn't need
any changes because the venue doesn't go through its zod env schema.

## 2. `apps/web/src/components/swap/swap-panel.tsx`: offer the XAU Route for cross-chain pairs (optional for the demo)

Verified anchors: `crossChainRequest` (a `useMemo`, ~line 423) builds a real `CrossChainQuoteRequest`;
`crossChainQuoteQuery` (~463) calls `api.crossChainQuote`; `executeCrossChain()` (~700) runs execution.

1. Add a second query for the cross-chain request, behind `process.env.NEXT_PUBLIC_NEAR_INTENTS_ENABLED === "true"`:
   ```ts
   const nearQuoteQuery = useQuery({
     queryKey: ["near-intents-quote", crossChainRequest],
     enabled: nearEnabled && Boolean(crossChainRequest),
     queryFn: async () => {
       const r = await fetch(`${API_URL}/swap/cross-chain/near-intents/quote`, {
         method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(crossChainRequest),
       });
       if (!r.ok) return null;
       return (await r.json()) as { quoteRef: string; crossChainQuote: CrossChainQuote & { provider: string } };
     },
   });
   ```
   `API_URL` comes from `@/lib/api`. Show the result as one more route row labelled `crossChainQuote.bridgeName`
   (`"XAU Route"`). Never name the venue in the UI.
2. If the user picks that row, **do not** send it through `submitEvmCrossChainBuilt()`. That function runs an
   ERC-20 `approve(built.evm.to, amount)` before it sends. For our build, `evm.to` is the token contract itself
   and `data` is a plain `transfer` to the deposit address, so no approval is needed and one would be wrong.
   Use this instead:
   ```ts
   const b = await fetch(`${API_URL}/swap/cross-chain/near-intents/build`, { method: "POST",
     headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteRef, confirm: true }) }).then((r) => r.json());
   if (b.error) throw new Error(b.error.message);
   await ensureEvmChain(fromChainKey);
   const hash = await sendEvmDeposit(b.deposit, (tx) => sendTransactionAsync(tx));   // lib/near-intents/deposit
   await reportDeposit(API_URL, b.deposit.quoteId, hash).catch(() => {});           // optional speed-up
   // then render <NearIntentsStatus quoteId={b.deposit.quoteId} apiBase={API_URL} />
   ```
   For a Solana origin, use `sendSolanaDeposit(...)` with the panel's existing `/swap/submit-solana` submitter.
   The build returns no `solanaTransaction`, because the backend builds no Solana transactions for this venue.
3. `confirm: true` must only be sent from the Swap button's click handler, never on render or on refetch.

## 3. Gold Curve token page: Fund from another chain

Verified anchors: `apps/web/src/app/(site)/token/[chainKey]/[address]/page.tsx` renders `TokenDetail`. In turn,
`components/discover/token-detail.tsx` renders `<GoldCurvePanel chainKey={chainKey} address={address} />`
(~line 195). `components/discover/gold-curve-panel.tsx` gets `curve: GoldCurveView` from `api.goldCurve(address)`.
That `GoldCurveView` already has every input the panel needs: `config`, `raised`, `threshold`, `quoteSymbol`,
`migrated`.

In `GoldCurvePanel`, after `if (!curve) return null;`:
```tsx
const nearEnabled = process.env.NEXT_PUBLIC_NEAR_INTENTS_ENABLED === "true";
return (
  <>
    <GoldCurveCard curve={curve} />
    {nearEnabled && !curve.migrated ? (
      <FundFromAnotherChain mint={curve.mint} poolConfig={curve.config} raisedSoFar={Number(curve.raised)}
        solanaWallet={solanaAddress} evmAddress={evmAddress} getQuote={postNearQuote} onConfirm={buildAndSend} />
    ) : null}
  </>
);
```
`solanaAddress` and `evmAddress` come from `hooks/use-active-wallet.ts`. `postNearQuote` posts to
`/swap/cross-chain/near-intents/quote`. `buildAndSend` follows the same steps as §2.2.

Live check (29 Oct 03:51 IST, `GET https://xauconnect.com/api/launchpad/curve/HXXMuNxD…`): XAUGC is
`preset: "fair"`, quote SOL, `config` `ExTrSGZB…`, threshold 10 SOL, raised 0.00014979 SOL, not migrated. That is
the `fair-sol` recipe, and `recipeFromConfig()` resolves it (router test `fund-curve.test.ts`).

## Label

User-facing strings say only "XAU Route". The optional disclosure `SETTLEMENT_NOTE` ("settled on NEAR Intents")
is shown only when `<NearIntentsStatus showSettlementNote />` is passed, and that **needs the owner's OK**.
