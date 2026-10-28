// Remaining backlog stubs (docs/BACKLOG.md item 5). Item 4 (R side) is in xauconnect-quote.test.ts. Items 1-3 are built and tested in
// near-intents.test.ts, execute.test.ts, fund-curve.test.ts, solana-ix.test.ts and server.test.ts.
import { test } from "node:test";

// 5. Agent endpoint (not built yet)
test.todo("agent tool manifest validates against its JSON Schemas");
test.todo("per-agent daily budget blocks once exhausted");
test.todo("unknown or revoked agent key returns 401 without quoting");
test.todo("audit log records request, decision, reason");
