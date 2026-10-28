// Backlog test stubs for hackathon work in THIS repo (see docs/BACKLOG.md). XAUConnect-branch tests live in that repo.
import { test } from "node:test";

// 2 (R mirror). Deposit instructions
test.todo("execute refuses without confirm:true and without EXECUTION_ENABLED=1");
test.todo("execute requests dry:false once per leg, never above the plan amount");
test.todo("stale plan (>60s) is re-quoted; minAmountOut worse than slippage aborts");
test.todo("ERC-20 transfer calldata (a9059cbb, padded address, amount)");
test.todo("policy limits re-checked at execute time");
test.todo("status poller stops on SUCCESS/REFUNDED/FAILED");
// 3. Gold Curve
test.todo("funding amount above remaining graduation distance produces a warning");
test.todo("pool config -> recipe -> quote token for all six configs");
// 4. XAUConnect comparison
test.todo("chain key map round-trips 1Click <-> XAUConnect (7 chains)");
test.todo("XAUConnect /api/swap/quote fixture maps to RouteOption provider=xauconnect");
test.todo("router ranks mixed providers by cost, then ETA");
test.todo("XAUConnect timeout becomes a failure entry and does not block NEAR Intents legs");
// 5. Agent endpoint
test.todo("agent tool manifest validates against its JSON Schemas");
test.todo("per-agent daily budget blocks once exhausted");
test.todo("unknown or revoked agent key returns 401 without quoting");
test.todo("audit log records request, decision, reason");
