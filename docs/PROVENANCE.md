# Provenance

Rules (https://nearhackathon.com/HACKATHON.md, re-read 28 Oct 2026, 22:00 and 22:20 IST):
- Q-001: "Code before 2026-11-01? Yes, from the announcement on 2026-10-19 ... Earlier commits are baseline."
- Q-002: "Existing product on another chain? Allowed. Only the NEAR integration built in the window is judged. Disclose in README."
- Q-003: "New repo required? No. Dedicated branch, or tags pre-hackathon and hackathon-submission, plus a README section linking the diff."
- Q-004: "Old project as-is: no. New feature in the window: yes, if separated per Q-003."
- Q-005: libraries, templates and AI-written code are allowed; list them; "own old libs count as baseline."

## Pre-existing (baseline, not judged)
XAUConnect, owned by Akhilesh Patil (@akhilexx): public repo https://github.com/akhilexx/xauconnect, branch `main` (18 commits as of 28 Oct 2026). It predates 19 Oct 2026. *Owner to confirm the date of the last pre-window commit and to tag it `pre-hackathon`.* It includes:
- Web app (`apps/web`, Next.js 15), mobile app (`apps/mobile`, Expo), backend API (`backend`, Express + WS), Prisma/PostgreSQL schema
- Same-chain swap aggregation and build on Ethereum, BNB Chain, Polygon, Arbitrum, Base, Avalanche and Solana (`backend/src/services/routing/engine.ts`, `meta.ts`, `build.ts`)
- EVM-origin cross-chain quote/build (`backend/src/services/routing/cross-chain.ts`), Solana broadcast relay (`backend/src/services/solana-submit.ts`)
- EVM contracts: aggregator router, fee collector, liquidity zap (`packages/contracts`)
- On-chain market indexer, SEO pages, fiat on-ramp scaffolding
- Gold Curve launchpad: Meteora DBC, six recipes, the live XAUGC pool (mint `HXXMuNxDShXhK6QGd4CczTgSiXr1YqNbUdpg9rTbWj5r`)

None of this code is presented as hackathon work.

## Built in the window (19 Oct-14 Nov 2026)
**Decision (owner, 28 Oct 2026, 22:18 IST): publish the real git history.** There is no fresh or orphan branch and no rewritten dates. `main` is the true history of this repository, and its first commit is dated 28 Oct 2026, 13:53 IST (08:23 UTC). That date is after the official announcement, 2026-10-19T19:01:58Z, so all of this repository falls inside the code window.

Rule relied on, quoted from https://nearhackathon.com/HACKATHON.md (fetched 28 Oct 2026, 22:20 IST; unchanged from the 22:00 IST copy):
> **Q-001. Code before 2026-11-01?** Yes, from the announcement on 2026-10-19 (https://x.com/nearprotocol/status/2112257967818997891). The window runs from then to 2026-11-14. Earlier commits are baseline.

The landing page (https://nearhackathon.com/#apply, same date) says: "01 Build your project. Code written since the announcement counts".

| Date (IST) | Work in this repository (all in the window) |
| --- | --- |
| 28 Oct 2026, 13:53 | Design spike, 6 commits: 1Click client, token registry, units, policy engine, router, offline mock, CLI, HTTP API, demo page, tests, README |
| 28 Oct 2026, evening | Gold Curve funding planner (`src/goldcurve.ts`, `goldcurve` CLI command), Solana delivery in the default policy, project metadata, docs reworked around the real XAUConnect codebase, backlog and test stubs |
| from then until 14 Nov 2026 | Backlog items (docs/BACKLOG.md), each as its own dated commit |

Every commit keeps its real author date. Commits were written by the owner's AI build assistant (see below). Author names may be set to the owner's GitHub identity when published; dates are never changed.

Separately, on the XAUConnect repo, branch `near-intents-hackathon` will hold the NEAR Intents adapter and UI wiring. Its base is tagged `pre-hackathon` and its end `hackathon-submission` (Q-003), and the README links the diff. Not started as of 28 Oct 2026.

## Third-party and AI-written code (Q-005)
- No runtime dependencies. Uses Node.js built-ins only.
- NEAR Intents 1Click API (HTTP).
- Code in this repository was largely written by an AI build assistant working for the owner and reviewed by the owner.
