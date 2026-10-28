// Compile-time only: our XAU shapes vs the real @xauconnect/utils schemas at 73c354c.
import type { CrossChainQuote, CrossChainQuoteRequest, CrossChainBuild } from "../../../../packages/utils/src/schemas.js";
import type { XauCrossChainQuoteRequest, XauNearIntentsQuote, XauNearIntentsBuild } from "./near-intents-xau.js";
type Is<T extends true> = T;
type Assignable<A, B> = [A] extends [B] ? true : false;
export type C1 = Is<Assignable<CrossChainQuoteRequest, XauCrossChainQuoteRequest>>;
export type C2 = Is<Assignable<Omit<XauNearIntentsQuote, "provider" | "raw">, Omit<CrossChainQuote, "provider" | "raw">>>;
export type C3 = Is<Assignable<Omit<XauNearIntentsBuild, "provider" | "deposit">, Omit<CrossChainBuild, "provider" | "executionSteps">>>;
// The real provider enum does not include "near-intents"; that is why the venue has its own routes (INTEGRATION.md).
export type C4 = Is<Assignable<"near-intents", CrossChainQuote["provider"]> extends false ? true : false>;
