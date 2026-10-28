import { env } from "../config.js";

/** Safe messages returned to browsers — never env var names or ops instructions. */
export const USER_ERROR_MESSAGES: Record<string, string> = {
  NO_LIVE_QUOTES:
    "Swaps aren't available for this pair right now. Try a different token or chain.",
  ROUTER_NOT_CONFIGURED: "Swaps on this network aren't live yet. Check back soon.",
  SWAP_BUILD_FAILED: "Couldn't prepare this swap. Try again or choose another route.",
  INVALID_TAKER_ADDRESS:
    "Invalid wallet address — use a 0x address with 40 hex characters (checksum optional).",
  TAKER_REQUIRED: "A taker wallet address is required to build an unsigned transaction.",
  DB_REQUIRED: "This feature is temporarily unavailable.",
  INTERNAL: "Something went wrong. Please try again.",
};

const INTERNAL_MARKERS =
  /RPC_|API_KEY|ROUTER_ADDRESS|\.env|configure|deploy|aggregator|ONEINCH|ZEROX|JUPITER|HELIUS|nssm|FeeCollector|AggregatorRouter|eth_call|hardhat/i;

export function looksLikeInternalError(message: string): boolean {
  return INTERNAL_MARKERS.test(message);
}

/** Map error codes to user copy; strip ops detail in production. */
export function publicErrorMessage(code: string, internalMessage: string): string {
  if (USER_ERROR_MESSAGES[code]) return USER_ERROR_MESSAGES[code];
  if (env.NODE_ENV === "production" && looksLikeInternalError(internalMessage)) {
    return USER_ERROR_MESSAGES.INTERNAL!;
  }
  return internalMessage;
}
