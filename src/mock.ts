// Offline mock of the 1Click quote endpoint for tests and demos without network.
// Prices come from the fixture token list; fees are a deterministic model, NOT real quotes.

import type { QuoteRequest, QuoteResponse, Token } from "./types.ts";
import { fromBaseUnits } from "./units.ts";

export class MockOneClick {
  private tokens: Token[];
  private feeBps: (req: QuoteRequest) => number;
  constructor(tokens: Token[], feeBps = (req: QuoteRequest) => (req.recipientType === "INTENTS" ? 25 : 60)) {
    this.tokens = tokens;
    this.feeBps = feeBps;
  }

  async quote(req: QuoteRequest): Promise<QuoteResponse> {
    const tin = this.tokens.find((t) => t.assetId === req.originAsset);
    const tout = this.tokens.find((t) => t.assetId === req.destinationAsset);
    if (!tin || !tout) throw new Error("tokenIn or tokenOut is not supported");
    if (!req.recipient) throw new Error("recipient is not valid");
    const inHuman = Number(fromBaseUnits(req.amount, tin.decimals));
    const inUsd = inHuman * tin.price;
    const fee = this.feeBps(req);
    const outUsd = inUsd * (1 - fee / 10_000);
    const outHuman = outUsd / tout.price;
    const outRaw = BigInt(Math.floor(outHuman * 10 ** tout.decimals)).toString();
    const minRaw = ((BigInt(outRaw) * BigInt(10_000 - req.slippageTolerance)) / 10_000n).toString();
    return {
      quote: {
        amountIn: req.amount, amountInFormatted: String(inHuman), amountInUsd: inUsd.toFixed(6),
        amountOut: outRaw, amountOutFormatted: fromBaseUnits(outRaw, tout.decimals), amountOutUsd: outUsd.toFixed(6),
        minAmountOut: minRaw, timeEstimate: tin.blockchain === tout.blockchain ? 10 : 30 + (tin.blockchain === "btc" ? 600 : 0),
      },
      quoteRequest: req,
      signature: "mock:unsigned",
      timestamp: new Date().toISOString(),
    };
  }
}
