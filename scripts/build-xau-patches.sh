#!/usr/bin/env bash
# Rebuild patches/xauconnect/*.patch from patches/xauconnect/tree.
# Shared modules are copied from src/xauconnect first so the patch ships exactly the tested bytes
# (near-intents-xau.ts gets its one import rewritten to ".js" for the backend's NodeNext resolution).
# 0001-0005 add new files. 0006 edits two existing files; its base is patches/xauconnect/base-73c354c,
# byte-identical copies of public XAUConnect main 73c354c (git blob shas checked in test/patches.test.ts),
# so 0006 applies with plain `git am` on that commit.
# Usage: scripts/build-xau-patches.sh   (needs git; touches nothing outside a temp dir and patches/)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$ROOT/patches/xauconnect/tree"
B="$ROOT/patches/xauconnect/base-73c354c"
cp "$ROOT/src/xauconnect/near-intents.ts" "$T/backend/src/services/routing/near-intents.ts"
sed 's#from "./near-intents.ts";#from "./near-intents.js";#' "$ROOT/src/xauconnect/near-intents-xau.ts" > "$T/backend/src/services/routing/near-intents-xau.ts"
for f in fund-curve.ts solana-deposit-ix.ts status.ts; do cp "$ROOT/src/xauconnect/$f" "$T/apps/web/src/lib/near-intents/$f"; done
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
cd "$W"; git init -q; git config user.name "Akhilesh Patil"; git config user.email "70477748+akhilexx@users.noreply.github.com"
mkdir -p backend/src/routes
cp "$B/backend/src/routes/swap.ts" backend/src/routes/swap.ts; cp "$B/backend/package.json" backend/package.json
git add -A; git commit -q -m "base: two files from public main 73c354c"
add() { msg="$1"; shift; for p in "$@"; do mkdir -p "$(dirname "$p")"; cp "$T/$p" "$p"; git add "$p"; done; git commit -q -m "$msg"; }
add "routing: NEAR Intents venue for cross-chain XAU Routes (off by default)

Self-contained adapter + framework-agnostic handlers. Dry quotes only unless
NEAR_INTENTS_EXECUTION_ENABLED=1 and the request carries confirm:true; then
returns unsigned deposit instructions. No keys, no signing." \
  backend/src/services/routing/near-intents.ts backend/src/services/routing/near-intents.test.ts
add "web: wallet-signed deposit helpers and status timeline for NEAR Intents routes" \
  apps/web/src/lib/near-intents/solana-deposit-ix.ts apps/web/src/lib/near-intents/status.ts apps/web/src/lib/near-intents/deposit.ts \
  apps/web/src/components/swap/near-intents-status.tsx
add "launchpad: Fund from another chain for Gold Curve pools" \
  apps/web/src/lib/near-intents/fund-curve.ts apps/web/src/components/launchpad/fund-from-another-chain.tsx
add "docs: NEAR Intents hackathon branch" docs/NEAR_INTENTS.md
add "routing: XAUConnect-shaped NEAR Intents handlers and Express sub-router

CrossChainQuoteRequest in, CrossChainQuote-shaped out (provider near-intents,
bridgeName XAU Route, 0 bps protocol fee), CrossChainBuild-shaped build with
evm {to,data,value,chainId}, statuses normalized to pending/completed/failed.
Errors use the backend {error:{code,message}} envelope." \
  backend/src/services/routing/near-intents-xau.ts backend/src/services/routing/near-intents-xau.test.ts backend/src/routes/near-intents.ts
add "swap: mount NEAR Intents routes at /swap/cross-chain/near-intents; backend test script

Two-line mount; existing /cross-chain/quote, /build and /status are untouched." \
  backend/src/routes/swap.ts backend/package.json
rm -f "$ROOT"/patches/xauconnect/*.patch
git format-patch -q --no-signature --zero-commit -o "$ROOT/patches/xauconnect" HEAD~6
ls "$ROOT/patches/xauconnect"/*.patch
