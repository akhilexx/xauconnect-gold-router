// Token registry backed by the live 1Click /v0/tokens list (or a fixture in mock mode).

import type { Token } from "./types.ts";

export class TokenRegistry {
  private bySymbolChain = new Map<string, Token>();
  readonly tokens: Token[];
  constructor(tokens: Token[]) {
    this.tokens = tokens;
    for (const t of tokens) {
      const k = key(t.symbol, t.blockchain);
      // Keep the first entry per symbol+chain; 1Click occasionally lists bridged duplicates.
      if (!this.bySymbolChain.has(k)) this.bySymbolChain.set(k, t);
    }
  }
  resolve(symbol: string, chain: string): Token {
    const t = this.bySymbolChain.get(key(symbol, chain));
    if (!t) throw new Error(`token ${symbol} on ${chain} is not supported by NEAR Intents 1Click`);
    return t;
  }
  has(symbol: string, chain: string): boolean {
    return this.bySymbolChain.has(key(symbol, chain));
  }
  chainsFor(symbol: string): string[] {
    return this.tokens.filter((t) => t.symbol.toUpperCase() === symbol.toUpperCase()).map((t) => t.blockchain);
  }
}

const key = (symbol: string, chain: string) => `${symbol.toUpperCase()}@${chain.toLowerCase()}`;
