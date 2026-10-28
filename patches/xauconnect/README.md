# Patches for the XAUConnect repo (for King Bot, on the owner's Mac)

These patches build backlog items 1 to 3 inside XAUConnect on a new branch, `near-intents-hackathon`.
Their base is public main `73c354c`, the last commit before the 19 Oct announcement. Tag that commit
`pre-hackathon`.

| Part | What | How |
|---|---|---|
| A | `0001`-`0005`: new files only | `git am` |
| B | `0006`: two-line mount in `backend/src/routes/swap.ts`, plus a `test` script in `backend/package.json` | `git am`. It is a real diff against `73c354c` bytes (see `base-73c354c/`, blob shas checked in tests) |
| C | `INTEGRATION.md`: three hand edits (`.env.example`, swap-panel, Gold Curve panel) | By hand. Anchors verified against `73c354c` |

## Apply (on the Mac, in the XAUConnect repo)

```bash
git status                                   # must be clean
git log -1 --format=%H main                  # expect 73c354c0d567c00ffcf05d4d71fa6de0983baa22 (else re-check 0006 + anchors)
git tag pre-hackathon 73c354c0d567c00ffcf05d4d71fa6de0983baa22
git switch -c near-intents-hackathon
git am --3way /path/to/xauconnect-gold-router/patches/xauconnect/000*.patch
# then INTEGRATION.md §1-3, committing each one
pnpm install && pnpm typecheck && pnpm build # what CI runs
pnpm --filter @xauconnect/backend test       # 8 tests (5 venue + 3 XAU-shaped)
```

Undo: `git am --abort` while applying, or `git switch - && git branch -D near-intents-hackathon`.
Applying the patches doesn't deploy or push anything, and both env switches default to off.

## Files

| Patch | Target path | Tested where |
|---|---|---|
| 0001 | `backend/src/services/routing/near-intents.ts` | Same bytes as router `src/xauconnect/near-intents.ts` (15 tests in `test/near-intents.test.ts`, plus fund-curve and server tests) |
| 0001 | `backend/src/services/routing/near-intents.test.ts` | 5 tests; pass under `tsx --test` |
| 0002 | `apps/web/src/lib/near-intents/{solana-deposit-ix,status,deposit}.ts`, `components/swap/near-intents-status.tsx` | Shared libs are byte-identical to router `src/xauconnect/*` (tested). `deposit.ts` and the component are type-checked only |
| 0003 | `apps/web/src/lib/near-intents/fund-curve.ts`, `components/launchpad/fund-from-another-chain.tsx` | Lib tested in router `test/fund-curve.test.ts`. Component is type-checked only |
| 0004 | `docs/NEAR_INTENTS.md` | n/a |
| 0005 | `backend/src/services/routing/near-intents-xau.ts` | Router `src/xauconnect/near-intents-xau.ts` (7 tests) with only its import rewritten to `.js` |
| 0005 | `backend/src/services/routing/near-intents-xau.test.ts`, `backend/src/routes/near-intents.ts` | 3 tests under `tsx --test`. Express glue is type-checked against the real `middleware/error.ts` |
| 0006 | `backend/src/routes/swap.ts`, `backend/package.json` | `git am` onto byte-identical `73c354c` copies in `test/patches.test.ts` |

Type checking: `TC_NODE_MODULES=… scripts/typecheck-xau-mirror.sh` uses XAUConnect's real settings (backend NodeNext;
web Bundler; both strict with `noUncheckedIndexedAccess`). It does not run a full `pnpm typecheck` of the monorepo,
because the box has no full checkout and no install. That run happens on the Mac.

## Regenerate

`scripts/build-xau-patches.sh` copies the tested modules from `src/xauconnect/` into `tree/` and rebuilds all six
patches. `test/patches.test.ts` fails if `tree/` drifts, if a backend import lacks `.js`, if a base copy is no longer
byte-identical to `73c354c`, or if the patches stop applying.
