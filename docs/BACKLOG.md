# Build backlog (in order of value)

There are two places for code. Both are NEW work and fall inside the code window (19 Oct-14 Nov 2026, Q-001):
- **R = this repo** (`xauconnect-gold-router`). It is the submitted repository. It is standalone and reproducible with Node only, which matters because the AI screeners run it (Q-017).
- **X = akhilexx/xauconnect, branch `near-intents-hackathon`**. Tag its base commit `pre-hackathon` and its final commit `hackathon-submission` (Q-003). The README of R links the diff `pre-hackathon...hackathon-submission`. Paths below come from the XAUConnect fact sheet and docs (SWAP_EXECUTION.md, SWAP_AND_FEES_DECISION_PLAN.md). Verify each one in the real checkout before editing.

Constraints:
- Never sign or move funds from code. Every on-chain action is signed in the user's own wallet.
- NEAR Intents has no testnet (Q-007): use mainnet `dry: true` quotes, and tiny amounts only in clips the owner approves and signs.
- XAUConnect branding rule: user-facing text never names third-party DEXs, and routes are "XAU Routes/Pools". In the UI, label the route "XAU Route · settled on NEAR Intents". **The owner must confirm** that naming NEAR Intents is OK, since judges need to see it.
- Secrets only in `.env` (`ONECLICK_JWT`). Never commit `.env`.

Status key: [x] done, [ ] to do. Tests: R uses `node:test` (no todo stubs remain; items 4-5 are in `test/xauconnect-quote.test.ts`, `test/agent.test.ts`, `test/agent-http.test.ts`). X uses the backend's existing runner: **check `backend/package.json`** for vitest or jest before writing tests. Contracts use Hardhat (`pnpm contracts:test`), but no contract change is planned.

## 0. Done in R (28 Oct)
- [x] 1Click client, registry, policy, router, mock, CLI, HTTP API, demo page (11 tests)
- [x] Gold Curve funding planner `src/goldcurve.ts` + `goldcurve` CLI command (5 tests), live quote USDC@arb/base -> SOL@sol verified
- [x] Solana delivery (`SOL`, `USDC` on `sol`) allowed by default policy

## 1-3. Built in R on 28 Oct (22:25-23:00 IST), and shipped to X as patches. Not yet applied to X
The X source wasn't available while this was built: it is on the owner's Mac. So the work was done in this order:
1. The X modules were written as **self-contained files inside R**, under `src/xauconnect/`, with no imports, and tested in R.
2. They were copied byte for byte into `patches/xauconnect/tree/`. `test/patches.test.ts` enforces that the copies match.
3. They were exported as `git am` patches 0001-0004, which add **new files only** under the fact-sheet paths.
4. Edits to *existing* X files are anchored snippets in `patches/xauconnect/INTEGRATION.md`, marked ADAPT. They are unverified until someone applies them against the real code.

### 1. NEAR Intents adapter in the XAUConnect backend (X, P0)
- [x] `backend/src/services/routing/near-intents.ts` (patch 0001; R `src/xauconnect/near-intents.ts`). It contains:
  - a tokens/quote/status/deposit-submit client with token-list caching;
  - a chain-key map `ethereum|bsc|polygon|arbitrum|base|avalanche|solana` -> `eth|bsc|pol|arb|base|avax|sol`;
  - native sentinels;
  - an `XAU Route` label, with `near-intents` used as the internal venue id;
  - `NEAR_INTENTS_ENABLED` off by default;
  - Express-agnostic handlers (`quote`, `build`, `status`, `submitDeposit`).
  It is written fresh for X, not ported line by line from `src/oneclick.ts`.
- [ ] Register in `cross-chain.ts`: snippet in INTEGRATION.md section 2 (ADAPT, unverified)
- [ ] Mount in `routes/swap.ts`: snippet in INTEGRATION.md section 3 (ADAPT). Behaviour of the handlers it mounts:
  - quote is always dry;
  - build makes the only `dry:false` call, gated by confirm, enabled, execution and the 60 s expiry;
  - status is proxied.
- [x] User-error mapping with no provider names (`toUserError`, `USER_ERRORS` in the module). Wiring into `user-errors.ts` is INTEGRATION.md section 4 (ADAPT)
- [x] Env: `NEAR_INTENTS_ENABLED`, `NEAR_INTENTS_EXECUTION_ENABLED`, `ONECLICK_BASE_URL`, `ONECLICK_JWT`, `NEAR_INTENTS_REFERRAL`, `ONECLICK_TIMEOUT_MS`. These go in `.env.example` per INTEGRATION.md section 1; no values are committed
- Tests (R `test/near-intents.test.ts`, 15 passing; a 5-test subset ships in patch 0001 and passes under `tsx --test`):
  - chain map round-trip;
  - quote mapping;
  - `dry:false` exactly once and only from build;
  - status proxy;
  - error mapping;
  - flag off means zero fetches;
  - no provider names in user strings.
  - X's own runner (vitest/jest) still needs checking: see `backend/package.json`

### 2. Wallet-signed deposit (X, P0; R mirror)
- [x] R: `POST /v1/routes/:id/execute` (`src/execute.ts`) returns unsigned deposit instructions only (EVM calldata, Solana instruction data, or manual instructions). It refuses unless `confirm:true` **and** `EXECUTION_ENABLED=1`. Before the one `dry:false` call it:
  - re-checks policy;
  - re-quotes if the plan is older than 60 s;
  - aborts on price movement beyond slippage or an amount mismatch.
  `POST /v1/deposits/submit` is gated the same way. 9 tests.
- [x] X web helpers in patch 0002:
  - `apps/web/src/lib/near-intents/deposit.ts`: EVM `transfer`/native; Solana SystemProgram or SPL `TransferChecked` with an idempotent ATA create, built with web3.js and signed by the user's wallet.
  - `solana-deposit-ix.ts`: its byte layout matches web3.js in a smoke build.
  - `status.ts`: poller and timeline.
  - `components/swap/near-intents-status.tsx`.
  These are type-checked, not run in the app or with a wallet.
- [ ] Wire into `swap-panel.tsx`: INTEGRATION.md section 5 (ADAPT, unverified)
- [ ] Record swaps via the existing `/api/swap/record` with `venue: "near-intents"` (INTEGRATION.md section 3 note; the earlier name `xau-route-intents` was dropped for the venue id)
- Not verified (needs one small deposit run by the owner; 1Click has no testnet): that SPL deposits to the deposit address's ATA are credited.

### 3. Gold Curve: "Fund from another chain" (X, P0/P1)
- [x] `apps/web/src/lib/near-intents/fund-curve.ts` (patch 0003; R `src/xauconnect/fund-curve.ts`):
  - maps pool config to recipe to quote token for all six recipes;
  - "want" maps to EXACT_OUTPUT and "spend" to EXACT_INPUT;
  - the recipient is always the connected Solana wallet;
  - adds graduation progress (10 SOL / 750 USDC) and a warning above the remaining amount;
  - hands off to `/token/solana/<mint>`.
- [x] `components/launchpad/fund-from-another-chain.tsx` panel, with a review checkbox before signing. It is type-checked, not rendered in the app
- [ ] Place the panel on the token page: INTEGRATION.md section 6 (ADAPT). The existing DBC buy flow is not touched; the panel only links to it
- Tests (R `test/fund-curve.test.ts`, 4):
  - six recipes;
  - connected-wallet recipient only;
  - graduation warning;
  - exact-output body.
  - A snapshot test of the existing DBC buy call was **not** written, because that code isn't available here.
- CLI: `node src/cli.ts fund ...`; HTTP: `POST /v1/goldcurve/fund`. Live dry runs: docs/live-dry-quotes.md

## 4. XAUT "gold from any chain" (X + R, P1)
- [x] In R (29 Oct, commit 1e9e6aa): `src/xauconnect-quote.ts` asks XAUConnect's same-chain quote (`POST https://xauconnect.com/api/swap/quote`, headers `X-Client-Source: agent`, body in XAUConnect's `QuoteRequest` shape) for same-chain wallet legs (e.g. USDT@eth -> XAUT@eth) and maps `best.amountOutAfterFee` to a RouteOption with provider `xauconnect`. The router ranks across providers by cost, then ETA. Off unless `XAUCONNECT_COMPARE=1`. These legs are a hand-off to xauconnect.com/swap; execute refuses them (`HANDOFF_ONLY`). Not verified: a live call to xauconnect.com (the fixture is schema-shaped, values illustrative).
- [ ] In X: a preset "Buy gold (XAUT)" on `/swap`, with destination XAUT on Ethereum or kept in a NEAR Intents balance (`recipientType: INTENTS`, NEAR account from the user).
- Tests (R `test/xauconnect-quote.test.ts`, 5): the fixture maps to RouteOption (venue names dropped, simulated/quote-only rejected); request shape and header; mixed-provider ranking by cost then ETA; a timeout or HTTP 500 becomes a failure entry and NEAR Intents legs still plan; execute refuses hand-off legs before any 1Click call.

## 5. Agent / tool endpoint (R, P1)
- [x] R (29 Oct, commit 077f396): `GET /.well-known/agent-tools.json` with `plan_gold_route`, `plan_gold_curve_funding`, `get_route_status` and `list_supported_assets`, each with a JSON Schema; `POST /v1/agent/tools/:name` validates arguments against it (`src/jsonschema.ts`, zero dependencies). All tools are read-only.
- [ ] X: add the tools to XAUConnect's existing agent action manifest (needs the real file; not done).
- [x] Per-agent keys (`AGENT_KEYS`, SHA-256 hashes only, revocable) and per-key policy: daily USD planning budget (UTC day, reserved before quoting) and an output allow-list on top of the server policy. Audit log of every allow/deny/error (memory, optional JSONL `AGENT_AUDIT_LOG`); `GET /v1/agent/audit` returns the caller's own entries. Budgets and the log reset on restart.
- Tests (R `test/agent.test.ts` 6, `test/agent-http.test.ts` 2): the manifest validates against its schema and each tool's example against its input schema; the budget blocks once exhausted and resets next UTC day; unknown, revoked or missing keys return 401 with zero quotes; disallowed outputs 403 with zero quotes; the audit log records request shape, decision and reason, never the key.

## 6. Polish (P2)
- [ ] 1Click JWT via partners.near-intents.org (removes the 0.2% fee, Q-006); optional confidential swaps toggle.
- [ ] Hosted demo (Q-012: a plus; keep it up until at least 18 Nov, ideally 25 Nov). Prepared 29 Oct: `DEMO_PUBLIC=1` read-only mode, `render.yaml`, docs/HOSTED-DEMO.md, test/demo.test.ts (6 tests), local live smoke OK. Re-checked 29 Oct after items 4-5: `render.yaml`'s start command `node src/server.ts` with `DEMO_PUBLIC=1`, `MOCK=0` starts, loads the live token list, `/health` ok, page and agent manifest 200, deposit submit 403 `DEMO_READ_ONLY`, agent call without a key 401. Remaining: the owner/King Bot deploys it on Render.
- [ ] Refresh the README numbers (done 29 Oct for test counts and items 4-5; refresh the bps examples at submit time), take screenshots, record the video, update PROVENANCE (done 29 Oct for items 4-5), and tag `hackathon-submission` on X.
