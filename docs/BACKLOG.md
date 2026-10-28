# Build backlog (in order of value)

There are two places for code. Both are NEW work and fall inside the code window (19 Oct-14 Nov 2026, Q-001):
- **R = this repo** (`xauconnect-gold-router`). It is the submitted repository. It is standalone and reproducible with Node only, which matters because the AI screeners run it (Q-017).
- **X = akhilexx/xauconnect, branch `near-intents-hackathon`**. Tag its base commit `pre-hackathon` and its final commit `hackathon-submission` (Q-003). The README of R links the diff `pre-hackathon...hackathon-submission`. Paths below come from the XAUConnect fact sheet and docs (SWAP_EXECUTION.md, SWAP_AND_FEES_DECISION_PLAN.md). Verify each one in the real checkout before editing.

Constraints:
- Never sign or move funds from code. Every on-chain action is signed in the user's own wallet.
- NEAR Intents has no testnet (Q-007): use mainnet `dry: true` quotes, and tiny amounts only in clips the owner approves and signs.
- XAUConnect branding rule: user-facing text never names third-party DEXs, and routes are "XAU Routes/Pools". In the UI, label the route "XAU Route · settled on NEAR Intents". **The owner must confirm** that naming NEAR Intents is OK, since judges need to see it.
- Secrets only in `.env` (`ONECLICK_JWT`). Never commit `.env`.

Status key: [x] done, [ ] to do. Tests: R uses `node:test` (stubs in `test/backlog.test.ts`). X uses the backend's existing runner: **check `backend/package.json`** for vitest or jest before writing tests. Contracts use Hardhat (`pnpm contracts:test`), but no contract change is planned.

## 0. Done in R (28 Oct)
- [x] 1Click client, registry, policy, router, mock, CLI, HTTP API, demo page (11 tests)
- [x] Gold Curve funding planner `src/goldcurve.ts` + `goldcurve` CLI command (5 tests), live quote USDC@arb/base -> SOL@sol verified
- [x] Solana delivery (`SOL`, `USDC` on `sol`) allowed by default policy

## 1. NEAR Intents adapter in the XAUConnect backend (X, P0)
Goal: XAUConnect's own quote fan-out gets a cross-chain venue that covers Solana <-> EVM, which today's EVM-only cross-chain routes do not.
- [ ] `backend/src/services/routing/near-intents.ts` (new): 1Click tokens/quote/status client with token-list caching, plus a chain-key map from XAUConnect `ethereum|bsc|polygon|arbitrum|base|avalanche|solana` to 1Click `eth|bsc|pol|arb|base|avax|sol`. Port it from R `src/oneclick.ts` / `src/registry.ts`, and say in the commit that it is ported from R.
- [ ] Register it as a cross-chain venue in `backend/src/services/routing/cross-chain.ts`. Its result has the same shape as existing cross-chain quotes, with route label `XAU Route` and provider id `near-intents` (internal only).
- [ ] `backend/src/routes/swap.ts`: `/swap/cross-chain/quote` includes NEAR Intents quotes. `/swap/cross-chain/build` with a NEAR Intents route returns a **deposit instruction** `{ chain, depositAddress, token, amount, memo?, deadline }`, from a `dry:false` quote that is requested only at build time. `/swap/cross-chain/status/{quoteId}` proxies `/v0/status`.
- [ ] `backend/src/lib/user-errors.ts`: map 1Click errors (recipient invalid, amount too low, no route) to user-facing text with no provider names.
- [ ] Env: `ONECLICK_BASE_URL`, `ONECLICK_JWT` (optional), `NEAR_INTENTS_ENABLED=false` by default, all in `.env.example` only.
- Tests (X backend runner): the chain map round-trips; the quote maps into the existing CrossChainQuote shape; build calls `dry:false` exactly once and only from build, never from quote; status proxy; errors are mapped; the feature flag off means no 1Click calls; no provider names in user-facing strings.

## 2. Wallet-signed deposit in the swap UI (X, P0)
- [ ] `apps/web/src/components/swap/swap-panel.tsx`: for a NEAR Intents route, an EVM origin uses the existing wagmi `writeContract` for an ERC-20 `transfer(depositAddress, amount)`, or `sendTransaction` for a native asset. A Solana origin builds an SPL transfer, signs it in Phantom/Solflare, and broadcasts via the existing `/swap/submit-solana`. After that, call the 1Click `deposit/submit` with the tx hash (via the backend).
- [ ] Status timeline (PENDING_DEPOSIT -> PROCESSING -> SUCCESS / REFUNDED / FAILED) polling `/swap/cross-chain/status/{quoteId}`.
- [ ] Quote-freshness guard: re-quote if the quote is older than 60 s or `minAmountOut` is worse than the slippage.
- [ ] `POST /swap/record`, the existing analytics, records the route as `xau-route-intents`.
- Tests: transfer calldata (`a9059cbb`, padded address, amount); the SPL transfer instruction builder; a stale quote blocks signing; the poller stops on terminal states; UI strings contain no provider names.
- R mirrors this as `POST /v1/routes/:id/execute`, which returns deposit instructions only, behind `confirm:true` + `EXECUTION_ENABLED=1` (tests in `test/backlog.test.ts`).

## 3. Gold Curve: "Buy from any chain" (X, P0/P1)
Goal: a Gold Curve buyer holding USDC/USDT on any EVM chain gets the curve's quote token (SOL or USDC) on Solana in one flow, then buys on the existing token page.
- [ ] On the token page for Gold Curve pools (`apps/web`, the existing `/token/solana/[mint]` page; locate the buy widget component), add an "Fund from another chain" option. It reads the recipe quote token from the pool config (Fair/Shield/Distribute x SOL/USDC), calls the NEAR Intents route to deliver exactly the needed amount to the connected Solana wallet, then hands off to the existing DBC buy flow (backend Gold Curve prepare/quote/swap; pre-existing, unchanged).
- [ ] Show progress toward graduation (10 SOL / 750 USDC) and what share of the remaining distance the buy covers (port `graduationShare` from R `src/goldcurve.ts`).
- Tests: the quote token is derived from all six recipe configs; the funding intent delivers to the connected wallet only; a funding amount over the remaining graduation distance warns; the existing DBC buy path is untouched (snapshot of the call).

## 4. XAUT "gold from any chain" (X + R, P1)
- [ ] In R: add XAUConnect's same-chain quote (`POST https://xauconnect.com/api/swap/quote`, headers `X-Client-Source: agent`) as a comparison provider for same-chain legs (e.g. USDT@eth -> XAUT@eth). Rank across providers.
- [ ] In X: a preset "Buy gold (XAUT)" on `/swap`, with destination XAUT on Ethereum or kept in a NEAR Intents balance (`recipientType: INTENTS`, NEAR account from the user).
- Tests: the XAUConnect quote fixture maps to RouteOption; mixed-provider ranking; an XAUConnect timeout does not block NEAR Intents legs.

## 5. Agent / tool endpoint (R, P1)
- [ ] `GET /.well-known/agent-tools.json` (or an MCP server) with `plan_gold_route`, `plan_gold_curve_funding`, `get_route_status` and `list_supported_assets`, plus JSON Schemas. Add it to XAUConnect's existing agent action manifest (X) as well.
- [ ] Per-agent keys and policy (daily USD budget, allowed outputs), plus an audit log.
- Tests: the manifest validates; the budget blocks once exhausted; an unknown key returns 401 without quoting; the audit log records each decision.

## 6. Polish (P2)
- [ ] 1Click JWT via partners.near-intents.org (removes the 0.2% fee, Q-006); optional confidential swaps toggle.
- [ ] Hosted demo (Q-012: a plus; keep it up until at least 18 Nov, ideally 25 Nov): deploy R's server or the XAUConnect branch to staging.
- [ ] Refresh the README numbers, take screenshots, record the video, update PROVENANCE, and tag `hackathon-submission` on X.
