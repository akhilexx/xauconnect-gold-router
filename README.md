# XAUConnect Gold Router

| | |
| --- | --- |
| Project | XAUConnect Gold Router: NEAR Intents settlement for [XAUConnect](https://xauconnect.com) |
| Owner | Akhilesh Patil, [@akhilexx](https://github.com/akhilexx), owner of XAUConnect ([github.com/akhilexx/xauconnect](https://github.com/akhilexx/xauconnect)) |
| Event | NEAR HACKATHON, 19 Oct-14 Nov 2026 (code window per HACKATHON.md Q-001) |
| Tracks | `defi`, `realworld`, `agents` |
| Prize account (NEAR mainnet, implicit) | `d10d7e27627fa755058f776b9632ad29bd407a423db15406ecde02a47cd60c3e` |
| License | MIT |

**What it is:** a cross-chain routing and settlement layer, built on NEAR Intents (1Click Swap API), for XAUConnect. It does two jobs:
1. **Gold from any chain:** stablecoins on Arbitrum, Ethereum, Base, Solana and other chains become tokenized gold (XAUT) in one plan.
2. **Fund a Gold Curve buy from any chain:** USDC or USDT on an EVM chain becomes SOL or USDC in the buyer's Solana wallet. That is the quote token an XAUConnect Gold Curve pool needs. The buyer then buys on the existing XAUConnect token page.

It ships as a dependency-free CLI, an HTTP API for wallets and AI agents (with hard spending limits), and a demo page. The integration into the XAUConnect app is a clearly separated branch of the XAUConnect repo (see [What is new vs pre-existing](#what-is-new-vs-pre-existing)).

**Problem:** XAUConnect quotes and swaps on 7 chains, but moving value *between* chains goes through EVM-only bridge routes. A Solana Gold Curve buyer who holds USDC on Base has to bridge by hand first.

**How NEAR fits in:** every cross-chain leg settles through NEAR Intents. The router uses `/v0/tokens` for the live asset registry, `/v0/quote` for signed solver quotes (dry run by default), and `/v0/status` for tracking. It can also deliver into a NEAR Intents balance (`recipientType: INTENTS`), which live quotes show costs less than withdrawing to a chain.

## Try it (judges: do X -> see Y)
Requires Node.js >= 23.6, which runs TypeScript directly. There is no install step and there are no dependencies.

1. Offline, no network:
   ```sh
   npm test        # -> 16 pass, 0 fail (plus todo stubs for planned work)
   npm run demo    # -> MOCK MODE plan: 2 legs into XAUT, INTENTS delivery picked as cheaper
   ```
2. Live NEAR Intents quotes (dry run; nothing is signed or sent). Use any public addresses you own:
   ```sh
   A=0xYourEvmAddress; S=YourSolanaAddress; N=your-account.near
   node src/cli.ts tokens XAUT
   # -> XAUT  eth  $<price>  nep141:eth-0x68749665ff8d2d112fa859aa293f07a622782f38.omft.near
   node src/cli.ts plan --from 100:USDC:arb:$A --from 60:USDT:eth:$A --from 25:USDC:base:$A --to XAUT:eth:DESTINATION_CHAIN:$A
   # -> one leg per source chain, cost in bps and ETA per leg, and a total
   node src/cli.ts plan --from 100:USDC:arb:$A --to XAUT:eth:INTENTS:$N --to XAUT:eth:DESTINATION_CHAIN:$A
   # -> picks INTENTS delivery; DESTINATION_CHAIN listed as the costlier alternative
   node src/cli.ts goldcurve --mint HXXMuNxDShXhK6QGd4CczTgSiXr1YqNbUdpg9rTbWj5r --recipe fair-sol --wallet $S --from 40:USDC:arb:$A --from 30:USDC:base:$A
   # -> SOL delivered to the Solana wallet for the live XAUGC Fair/SOL pool, plus the XAUConnect token page link to finish the buy
   ```
3. HTTP API and demo page: `npm start` (or `MOCK=1 npm start`), open `http://localhost:8787/`, edit the intent, click **Plan route**. Or run `curl -X POST localhost:8787/v1/routes -d @examples/intent.json`.
4. Policy guardrails: `POLICY_MAX_USD_PER_LEG=50 node src/cli.ts plan --from 100:USDC:arb:$A --to XAUT:eth:DESTINATION_CHAIN:$A` -> `BLOCKED by policy`, and no quote is requested.

Example live output (28 Oct 2026, dry run):
```
100 USDC@arb -> 0.024648 XAUT@eth [INTENTS]  in $99.94 out $99.68  cost 25 bps  ~27s
  alternatives considered:
    USDC@arb -> XAUT@eth [DESTINATION_CHAIN] cost 50 bps
40 USDC@arb -> 0.395210543 SOL@sol [DESTINATION_CHAIN]  in $39.97 out $39.89  cost 21 bps  ~22s
```

## Architecture
```mermaid
flowchart LR
  subgraph NEW["NEW in the hackathon window"]
    API[Gold Router CLI / HTTP API]
    P{Policy engine}
    F[Fan-out + rank]
    GC[Gold Curve funding planner]
    ADP[XAUConnect adapter<br/>branch near-intents-hackathon:<br/>backend/src/services/routing/near-intents.ts]
  end
  subgraph OLD["PRE-EXISTING XAUConnect (baseline, not judged)"]
    WEB[apps/web swap-panel.tsx]
    ENG[backend routing engine.ts / cross-chain.ts]
    GCX[Gold Curve launchpad<br/>Meteora DBC, 6 recipes]
    SUB[/swap/submit-solana/]
  end
  AG[AI agent] --> API
  WEB --> ENG --> ADP --> OC
  API --> P --> F --> OC[NEAR Intents 1Click API]
  GC --> F
  OC --> SOLV[(NEAR Intents solvers / verifier)]
  SOLV -.XAUT.-> ETH[Ethereum wallet or NEAR Intents balance]
  SOLV -.SOL / USDC.-> SOLW[Solana wallet] -.user signs buy.-> GCX
```
Dotted lines are settlement and the user's own signing. The router never holds keys or funds.

### Code map (this repo)
| Path | What |
| --- | --- |
| `src/oneclick.ts` | 1Click API client (tokens, quote, status), optional JWT |
| `src/registry.ts` | Symbol + chain -> 1Click `assetId` from the live token list |
| `src/policy.ts` | Spending guardrails, configurable via env |
| `src/router.ts` | Fan-out, ranking, plan assembly |
| `src/goldcurve.ts` | Gold Curve recipes (public configs) and funding intents |
| `src/mock.ts` | Offline deterministic quote simulator for tests |
| `src/cli.ts`, `src/server.ts`, `web/index.html` | Interfaces |
| `test/` | `node:test` tests; `test/backlog.test.ts` holds todo stubs for planned work |

## What is new vs pre-existing
**Pre-existing XAUConnect (baseline, before 19 Oct 2026; not submitted for judging):** the public repo [akhilexx/xauconnect](https://github.com/akhilexx/xauconnect) (Turborepo: `apps/web` Next.js 15, `apps/mobile` Expo, `backend` Express API, Prisma/PostgreSQL, `packages/contracts|sdk|ui|utils`). That baseline includes:
- multi-chain swap quotes, builds, liquidity and the wallet view on Ethereum, BNB Chain, Polygon, Arbitrum, Base, Avalanche and Solana;
- EVM-origin cross-chain routes (`backend/src/services/routing/cross-chain.ts`);
- the Solana broadcast relay (`/swap/submit-solana`);
- the on-chain market indexer;
- the Gold Curve launchpad: Meteora DBC, six recipes, and the live XAUGC pool.

**New (hackathon window):**
- this repository, all of it, with its real git history starting 28 Oct 2026: the router, policy engine, Gold Curve funding planner, CLI, API and demo page. HACKATHON.md Q-001: "Code before 2026-11-01? Yes, from the announcement on 2026-10-19 ... Earlier commits are baseline." No commit in this repository predates 28 Oct 2026, and none of its code is copied from XAUConnect.
- a branch `near-intents-hackathon` on akhilexx/xauconnect, tagged `pre-hackathon` at its base and `hackathon-submission` at the end (per Q-003). It holds the NEAR Intents adapter and UI wiring. Diff link: *(added when the branch exists)*.

Full log: [docs/PROVENANCE.md](docs/PROVENANCE.md). Plan of record: [docs/BACKLOG.md](docs/BACKLOG.md). Track rationale: [docs/TRACKS.md](docs/TRACKS.md).

## XAUConnect today (self-reported)
These are the owner's figures, read from the XAUConnect production database on 28 Oct 2026 (aggregates only). XAUConnect is early stage: it is shipped and live, the indexer runs at scale, and usage is tiny.
- Registered users 12 (first 15 Jun 2026); active 24h 0, 7d 2, 30d 5; connected wallets 7.
- Swaps 11 total (2 in the last 30 days), all-time volume about $10.34, protocol fees about $0.28. By chain: Solana 3 swaps ($7.14), Polygon 4 ($3.20), Base 2, Ethereum 2.
- Gold Curve launches on mainnet: 1 (XAUGC).
- Indexer: 49,261 pools tracked; 1,174 API requests logged.

## What is real vs simulated
| Piece | Status |
| --- | --- |
| Token registry, dry-run quotes, status lookups | Real, live 1Click API (mainnet; NEAR Intents has no testnet, Q-007) |
| Policy engine, ranking, multi-source planning, Gold Curve funding plan | Real |
| `MOCK=1` quotes | Simulated fees, offline tests only |
| Execution (sending deposits) | Planned: user-signed in the XAUConnect UI, tiny amounts. The router never signs |
| XAUConnect adapter and UI | Planned on branch `near-intents-hackathon` |

## Setup
```sh
cp .env.example .env   # public addresses only; never a private key or seed phrase
npm test && npm start
```

## Safety
- Dry-run quotes by default. No private keys, nothing signed by this code.
- Secrets (JWT) only via environment variables; `.env` is git-ignored.
- Not financial advice. XAUT and bonding-curve tokens carry issuer, bridge and smart-contract risk.

## License
MIT. See LICENSE.
