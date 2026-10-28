# Patches for the XAUConnect repo (for King Bot, on the owner's Mac)

These patches build backlog items 1 to 3 inside XAUConnect on a new branch,
`near-intents-hackathon`. They come in two parts:

| Part | What | How |
|---|---|---|
| A | `0001`-`0004` `.patch`: **new files only** | `git am`. These apply cleanly to any tree that doesn't already have these paths |
| B | `INTEGRATION.md`: edits to **existing** files (`.env.example`, `cross-chain.ts`, `routes/swap.ts`, `user-errors.ts`, `swap-panel.tsx`, token page) | Applied by hand. They were written without the real files, so names marked `ADAPT` need checking |

## Apply (on the Mac, in the XAUConnect repo)

```bash
git status                       # must be clean
git switch -c near-intents-hackathon
git am --3way /path/to/xauconnect-gold-router/patches/xauconnect/000*.patch
# then INTEGRATION.md steps 1-6, committing each one
pnpm install && pnpm -w typecheck   # or the repo's own scripts
npx tsx --test backend/src/services/routing/near-intents.test.ts
```

Undo: `git am --abort` while applying, or `git switch - && git branch -D near-intents-hackathon`.
Nothing in this branch is deployed or pushed by applying it. Both env switches default off.

## Files added by part A

| Patch | Target path | Tested where |
|---|---|---|
| 0001 | `backend/src/services/routing/near-intents.ts` | Same bytes as router `src/xauconnect/near-intents.ts`: 15 tests in router `test/near-intents.test.ts`, plus `test/fund-curve.test.ts` and `test/server.test.ts` |
| 0001 | `backend/src/services/routing/near-intents.test.ts` | 5 tests, pass with `tsx --test` on the box |
| 0002 | `apps/web/src/lib/near-intents/solana-deposit-ix.ts` | Same bytes as router `src/xauconnect/solana-deposit-ix.ts` (`test/solana-ix.test.ts`) |
| 0002 | `apps/web/src/lib/near-intents/status.ts` | Same bytes as router `src/xauconnect/status.ts` (`test/execute.test.ts` poller, `test/solana-ix.test.ts` timeline) |
| 0002 | `apps/web/src/lib/near-intents/deposit.ts` | Type-checked with @solana/web3.js 1.x. Built unsigned SPL and SOL txs in a smoke run. No wallet test |
| 0002 | `apps/web/src/components/swap/near-intents-status.tsx` | Type-checked (React 19 types) only |
| 0003 | `apps/web/src/lib/near-intents/fund-curve.ts` | Same bytes as router `src/xauconnect/fund-curve.ts` (`test/fund-curve.test.ts`) |
| 0003 | `apps/web/src/components/launchpad/fund-from-another-chain.tsx` | Type-checked only |
| 0004 | `docs/NEAR_INTENTS.md` | n/a |

Type checking ran on the box: strict mode, `moduleResolution: bundler`, `jsx: react-jsx`. The
real tsconfig may use other settings, such as path aliases or `noUncheckedIndexedAccess`.

## Regenerate

`scripts/build-xau-patches.sh` copies the tested modules from `src/xauconnect/` into `tree/`
and rebuilds the `.patch` files. `test/patches.test.ts` fails if `tree/` and `src/xauconnect/`
drift, or if the patches stop applying.
