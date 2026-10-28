// Spending policy: guardrails an agent cannot override. Checked before any quote is requested.

import type { Source, Token } from "./types.ts";

export interface Policy {
  maxUsdPerLeg: number;
  maxUsdTotal: number;
  maxSlippageBps: number;
  maxCostBps: number; // reject quotes whose total cost (fees + impact) exceeds this
  allowedChains: string[] | "*";
  allowedOutputSymbols: string[] | "*";
}

export const defaultPolicy: Policy = {
  maxUsdPerLeg: 5000,
  maxUsdTotal: 10000,
  maxSlippageBps: 100,
  maxCostBps: 300,
  allowedChains: "*",
  allowedOutputSymbols: ["XAUT", "USDC", "USDT", "SOL"],
};

export function policyFromEnv(env: Record<string, string | undefined>): Policy {
  const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);
  const list = (v: string | undefined, d: string[] | "*") => (v ? (v === "*" ? "*" : v.split(",").map((s) => s.trim())) : d);
  return {
    maxUsdPerLeg: num(env.POLICY_MAX_USD_PER_LEG, defaultPolicy.maxUsdPerLeg),
    maxUsdTotal: num(env.POLICY_MAX_USD_TOTAL, defaultPolicy.maxUsdTotal),
    maxSlippageBps: num(env.POLICY_MAX_SLIPPAGE_BPS, defaultPolicy.maxSlippageBps),
    maxCostBps: num(env.POLICY_MAX_COST_BPS, defaultPolicy.maxCostBps),
    allowedChains: list(env.POLICY_ALLOWED_CHAINS, defaultPolicy.allowedChains),
    allowedOutputSymbols: list(env.POLICY_ALLOWED_OUTPUTS, defaultPolicy.allowedOutputSymbols),
  };
}

export function checkSource(p: Policy, s: Source, token: Token): string | null {
  if (p.allowedChains !== "*" && !p.allowedChains.includes(s.chain)) return `chain ${s.chain} not allowed by policy`;
  const usd = Number(s.amount) * token.price;
  if (usd > p.maxUsdPerLeg) return `leg value ~$${usd.toFixed(2)} exceeds policy max $${p.maxUsdPerLeg}`;
  return null;
}

export function checkOutput(p: Policy, symbol: string, chain: string): string | null {
  if (p.allowedOutputSymbols !== "*" && !p.allowedOutputSymbols.includes(symbol.toUpperCase())) return `output ${symbol} not allowed by policy`;
  if (p.allowedChains !== "*" && !p.allowedChains.includes(chain)) return `destination chain ${chain} not allowed by policy`;
  return null;
}
