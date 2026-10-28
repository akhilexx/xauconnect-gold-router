// Offline mock of the 1Click quote endpoint for tests and demos without network.
// Prices come from the fixture token list; fees are a deterministic model, NOT real quotes.

import type { QuoteRequest, QuoteResponse, Token } from "./types.ts";
import { fromBaseUnits } from "./units.ts";

export class MockOneClick {
  private tokens: Token[];
  private feeBps: (req: QuoteRequest) => number;
  constructor(tokens: Token[], feeBps: (req: QuoteRequest) => number = (req) => (req.recipientType === "INTENTS" ? 25 : 60)) {
    this.tokens = tokens;
    this.feeBps = feeBps;
  }

  async quote(req: QuoteRequest): Promise<QuoteResponse> {
    const tin = this.tokens.find((t) => t.assetId === req.originAsset);
    const tout = this.tokens.find((t) => t.assetId === req.destinationAsset);
    if (!tin || !tout) throw new Error("tokenIn or tokenOut is not supported");
    if (!req.recipient) throw new Error("recipient is not valid");
    const fee = this.feeBps(req);
    let inRaw: string, outRaw: string;
    if (req.swapType === "EXACT_OUTPUT") {
      outRaw = req.amount;
      const outUsd = Number(fromBaseUnits(outRaw, tout.decimals)) * tout.price;
      const inHuman = outUsd / (1 - fee / 10_000) / tin.price;
      inRaw = BigInt(Math.ceil(inHuman * (1 + req.slippageTolerance / 10_000) * 10 ** tin.decimals)).toString();
    } else {
      inRaw = req.amount;
      const outUsd = Number(fromBaseUnits(inRaw, tin.decimals)) * tin.price * (1 - fee / 10_000);
      outRaw = BigInt(Math.floor((outUsd / tout.price) * 10 ** tout.decimals)).toString();
    }
    const inHuman = Number(fromBaseUnits(inRaw, tin.decimals));
    const inUsd = inHuman * tin.price;
    const outUsd = Number(fromBaseUnits(outRaw, tout.decimals)) * tout.price;
    const minRaw = req.swapType === "EXACT_OUTPUT" ? outRaw : ((BigInt(outRaw) * BigInt(10_000 - req.slippageTolerance)) / 10_000n).toString();
    return {
      quote: {
        amountIn: inRaw, amountInFormatted: String(inHuman), amountInUsd: inUsd.toFixed(6),
        amountOut: outRaw, amountOutFormatted: fromBaseUnits(outRaw, tout.decimals), amountOutUsd: outUsd.toFixed(6),
        minAmountOut: minRaw, timeEstimate: tin.blockchain === tout.blockchain ? 10 : 30 + (tin.blockchain === "btc" ? 600 : 0),
        // The mock never hands out a real deposit address. dry:false gets an obviously fake one.
        ...(req.dry ? {} : { depositAddress: tin.blockchain === "sol" ? "MockDeposit1111111111111111111111111111111" : "0x000000000000000000000000000000000000dEaD", deadline: req.deadline }),
      },
      quoteRequest: req,
      signature: "mock:unsigned",
      timestamp: new Date().toISOString(),
    };
  }
}

/** fetch() stand-in that serves /v0/tokens and /v0/quote from the mock (for the XAUConnect venue adapter). */
export function mockFetch(tokens: Token[], mock = new MockOneClick(tokens)) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const path = new URL(url).pathname;
    if (path === "/v0/tokens") return new Response(JSON.stringify(tokens));
    if (path === "/v0/quote") {
      try {
        return new Response(JSON.stringify(await mock.quote(JSON.parse(String(init?.body)))));
      } catch (e) {
        return new Response(JSON.stringify({ message: (e as Error).message }), { status: 400 });
      }
    }
    return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
  };
}
