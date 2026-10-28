// Remaining backlog stubs (docs/BACKLOG.md items 4 and 5). Items 1-3 are built and tested in
// near-intents.test.ts, execute.test.ts, fund-curve.test.ts, solana-ix.test.ts and server.test.ts.
import { test } from "node:test";

// 4. Compare against XAUConnect's own cross-chain quote (not built yet)
test.todo("XAUConnect /api/swap/quote fixture maps to RouteOption provider=xauconnect");
test.todo("router ranks mixed providers by cost, then ETA");
test.todo("XAUConnect timeout becomes a failure entry and does not block NEAR Intents legs");
// 5. Agent endpoint (not built yet)
test.todo("agent tool manifest validates against its JSON Schemas");
test.todo("per-agent daily budget blocks once exhausted");
test.todo("unknown or revoked agent key returns 401 without quoting");
test.todo("audit log records request, decision, reason");
