#!/usr/bin/env bash
# Rebuild patches/xauconnect/*.patch from patches/xauconnect/tree (new files only).
# Shared modules are copied from src/xauconnect first so the patch ships exactly the tested bytes.
# Usage: scripts/build-xau-patches.sh   (needs git; touches nothing outside a temp dir and patches/)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$ROOT/patches/xauconnect/tree"
cp "$ROOT/src/xauconnect/near-intents.ts" "$T/backend/src/services/routing/near-intents.ts"
for f in fund-curve.ts solana-deposit-ix.ts status.ts; do cp "$ROOT/src/xauconnect/$f" "$T/apps/web/src/lib/near-intents/$f"; done
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
cd "$W"; git init -q; git config user.name "Akhilesh Patil"; git config user.email "70477748+akhilexx@users.noreply.github.com"
git commit -q --allow-empty -m base
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
rm -f "$ROOT"/patches/xauconnect/*.patch
git format-patch -q --no-signature --zero-commit -o "$ROOT/patches/xauconnect" HEAD~4
ls "$ROOT/patches/xauconnect"/*.patch
