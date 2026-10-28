# Hosted demo plan (Render, zero secrets, dry quotes only)

Status, 29 Oct 2026: **prepared, not deployed.** The rules (Q-012) say a hosted demo is a plus and
should stay up until 18 Nov (ideally 25 Nov). The video is still required as a fallback.

## What the hosted demo is

`DEMO_PUBLIC=1 node src/server.ts` serves the demo page and the read-only API:

| Endpoint | Demo behaviour |
|---|---|
| `GET /`, `GET /health` | page with a "Hosted demo: dry quotes only" banner; health shows `demoPublic: true, executionEnabled: false` |
| `POST /v1/routes` | multi-source plan to XAUT, live 1Click **dry** quotes |
| `POST /v1/goldcurve/fund` | Fund from another chain for XAUGC (fair-sol): exact-output dry quote, then hand-off link to xauconnect.com |
| `POST /v1/xau/swap/cross-chain/near-intents/quote` | the same handlers patch 0005 adds to XAUConnect, returning a real `CrossChainQuote` shape |
| `POST /v1/routes/:id/execute`, `/v1/deposits/submit`, `.../near-intents/build` | **always 403 `DEMO_READ_ONLY`**, whatever `EXECUTION_ENABLED` says |

Guards in code (src/server.ts, test/demo.test.ts, 6 tests):
- Execution gate is checked before any handler runs, so no deposit address is ever requested.
- The server refuses to start if `DEMO_PUBLIC=1` and `EXECUTION_ENABLED` are both set.
- POSTs are rate limited per IP (`DEMO_RATE_PER_MIN`, default 30; Render's `X-Forwarded-For` is used).
- Bodies are capped at 50 kB. Internal error messages are hidden in demo mode.
- `nosniff`, `no-referrer` and `X-Frame-Options: DENY` headers are set.
- No secrets: there is no JWT (1Click charges its 0.2% no-JWT fee on quotes, which is fine for dry quotes).

Local proof, 29 Oct 03:55 IST (`DEMO_PUBLIC=1 MOCK=0`, live 1Click, dry):
- `/v1/goldcurve/fund` for 0.25 SOL from Arbitrum USDC: recipe fair-sol, "XAU Route", pay 25.879422 USDC (~$25.87), ETA 22 s.
- XAU-shaped quote Base USDC 25 → SOL: provider near-intents, bridgeName "XAU Route", amountOut 243956922 lamports, min 241517352, 32 s.
- build: 403 DEMO_READ_ONLY. The page banner rendered.

## Deploy steps (owner or King Bot; Forge does not deploy)

1. Make the repo public (or connect the private repo to Render).
2. Render → New → Blueprint → pick the repo; `render.yaml` creates `xauconnect-gold-router-demo` (free plan, Node 24).
3. Set `RECIPIENT_EVM` and `RECIPIENT_SOL` to the **public** demo addresses the owner approves. Never set
   `EXECUTION_ENABLED`, `ONECLICK_JWT`, or any key.
4. Deploy, then check: `/health` shows `demoPublic: true`; one Fund quote works; the build button shows 403.
5. Put the URL in the submission's demo field. Keep it running until at least 18 Nov.
   The free plan sleeps when idle (cold start ~30-60 s). A paid starter plan avoids this, so mention it to the owner.
6. Fallback: if 1Click is down during judging, set `MOCK=1` (fixture quotes, banner says MOCK).
