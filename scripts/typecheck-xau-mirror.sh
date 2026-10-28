#!/usr/bin/env bash
# Type-check the XAUConnect patch tree under XAUConnect's real compiler settings (public main 73c354c):
#   backend: tsconfig.base.json + backend/tsconfig.json -> NodeNext, strict, noUncheckedIndexedAccess, isolatedModules
#   web:     tsconfig.base.json + apps/web/tsconfig.json -> Bundler, strict, noUncheckedIndexedAccess, jsx preserve, DOM
# Real neighbours come from patches/xauconnect/base-73c354c (byte-identical, blob shas in test/patches.test.ts);
# logger/config/rate-limit are tiny stubs (their real versions pull pino/redis). Also asserts our quote/build
# shapes are assignable to the real @xauconnect/utils CrossChainQuote/CrossChainBuild schemas.
# Usage: TC_NODE_MODULES=/path/with/typescript,express,@types/express,@types/node,@types/react,zod,@solana/web3.js scripts/typecheck-xau-mirror.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; NM="${TC_NODE_MODULES:?set TC_NODE_MODULES}"
T="$ROOT/patches/xauconnect/tree"; B="$ROOT/patches/xauconnect/base-73c354c"; S="$ROOT/scripts/xau-mirror"
M="$(mktemp -d)"; trap 'rm -rf "$M"' EXIT
mkdir -p "$M/backend/src/routes" "$M/backend/src/services/routing" "$M/backend/src/middleware" "$M/backend/src/lib" "$M/packages/utils/src" "$M/apps/web"
cp "$T"/backend/src/services/routing/*.ts "$M/backend/src/services/routing/"
cp "$T/backend/src/routes/near-intents.ts" "$M/backend/src/routes/"
cp "$B/backend/src/middleware/error.ts" "$M/backend/src/middleware/"; cp "$B/backend/src/lib/user-errors.ts" "$M/backend/src/lib/"
cp "$B/packages/utils/src/schemas.ts" "$B/packages/utils/src/chains.ts" "$M/packages/utils/src/"
cp "$S/schema-compat.check.ts" "$M/backend/src/services/routing/"
echo 'export const logger = { warn: (..._a: unknown[]) => {}, error: (..._a: unknown[]) => {} };' > "$M/backend/src/logger.ts"
echo 'export const env = { NODE_ENV: process.env.NODE_ENV };' > "$M/backend/src/config.ts"
printf 'import type { RequestHandler } from "express";\nexport declare const quoteLimiter: RequestHandler;\nexport declare const standardLimiter: RequestHandler;\n' > "$M/backend/src/middleware/rate-limit.ts"
echo '{"type":"module"}' > "$M/backend/package.json"; echo '{"type":"module"}' > "$M/packages/utils/package.json"
cp -r "$T/apps/web/src" "$M/apps/web/"
cp "$S/tsconfig.backend.json" "$M/backend/tsconfig.json"; cp "$S/tsconfig.web.json" "$M/apps/web/tsconfig.json"
ln -s "$NM" "$M/node_modules"
TSC="$NM/.bin/tsc"
"$TSC" -p "$M/backend/tsconfig.json" && echo "backend: ok"
"$TSC" -p "$M/apps/web/tsconfig.json" && echo "web: ok"
