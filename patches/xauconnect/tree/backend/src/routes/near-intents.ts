/**
 * NEAR Intents venue routes, mounted by routes/swap.ts at /swap/cross-chain/near-intents.
 *
 *   POST /quote           dry quote; body = CrossChainQuoteRequest (or the venue shape used by the launchpad panel)
 *   POST /build           { quoteRef, confirm: true } -> unsigned deposit (403 unless NEAR_INTENTS_EXECUTION_ENABLED=1)
 *   POST /submit-deposit  { quoteId, txHash, confirm: true } optional speed-up (same gates)
 *   GET  /status/:quoteId read-only status
 *
 * Off unless NEAR_INTENTS_ENABLED=true (503 otherwise). The server never holds keys or signs.
 * Separate from /cross-chain/quote on purpose: existing 0x / Fusion+ behaviour is untouched.
 */
import { Router } from "express";
import { asyncHandler } from "../middleware/error.js";
import { quoteLimiter, standardLimiter } from "../middleware/rate-limit.js";
import { NearIntentsVenue, nearIntentsConfigFromEnv } from "../services/routing/near-intents.js";
import { createXauNearIntentsHandlers, type XauResult } from "../services/routing/near-intents-xau.js";

const handlers = createXauNearIntentsHandlers(new NearIntentsVenue(nearIntentsConfigFromEnv(process.env)));

function send(res: import("express").Response, r: XauResult): void {
  res.status(r.status).json(r.json);
}

export const nearIntentsRouter = Router();

nearIntentsRouter.post("/quote", quoteLimiter, asyncHandler(async (req, res) => send(res, await handlers.quote(req.body))));
nearIntentsRouter.post("/build", quoteLimiter, asyncHandler(async (req, res) => send(res, await handlers.build(req.body))));
nearIntentsRouter.post(
  "/submit-deposit",
  quoteLimiter,
  asyncHandler(async (req, res) => send(res, await handlers.submitDeposit(req.body))),
);
nearIntentsRouter.get(
  "/status/:quoteId",
  standardLimiter,
  asyncHandler(async (req, res) => send(res, await handlers.status(req.params.quoteId ?? ""))),
);
