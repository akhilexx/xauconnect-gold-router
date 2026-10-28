#!/usr/bin/env node
// CLI: plan a multi-chain route into gold (or any 1Click asset) on NEAR Intents. Dry run only.
//
//   node src/cli.ts tokens XAUT
//   node src/cli.ts plan --from 100:USDC:arb --from 50:USDT:sol --to XAUT:eth:DESTINATION_CHAIN --to XAUT:eth:INTENTS
//   node src/cli.ts status <depositAddress>

import { buildDeps, loadEnv } from "./config.ts";
import { formatPlan } from "./format.ts";
import { OneClickClient } from "./oneclick.ts";
import { planRoute } from "./router.ts";
import { goldCurveIntent, RECIPES, type RecipeId } from "./goldcurve.ts";
import type { Delivery, RecipientType, Source } from "./types.ts";

const EVM = new Set(["eth", "arb", "base", "op", "pol", "bsc", "avax", "gnosis", "bera", "scroll", "monad", "xlayer", "abs", "plasma"]);

export function refundFor(chain: string, env = process.env): string {
  const specific = env[`REFUND_${chain.toUpperCase()}`];
  if (specific) return specific;
  if (EVM.has(chain) && env.REFUND_EVM) return env.REFUND_EVM;
  throw new Error(`no refund address for ${chain}: set REFUND_${chain.toUpperCase()}${EVM.has(chain) ? " or REFUND_EVM" : ""} in .env`);
}

export function recipientFor(chain: string, mode: RecipientType, env = process.env): string {
  if (mode === "INTENTS") {
    if (!env.NEAR_ACCOUNT) throw new Error("set NEAR_ACCOUNT in .env to receive into a NEAR Intents balance");
    return env.NEAR_ACCOUNT;
  }
  const specific = env[`RECIPIENT_${chain.toUpperCase()}`];
  if (specific) return specific;
  if (EVM.has(chain) && env.RECIPIENT_EVM) return env.RECIPIENT_EVM;
  throw new Error(`no recipient for ${chain}: set RECIPIENT_${chain.toUpperCase()}${EVM.has(chain) ? " or RECIPIENT_EVM" : ""} in .env`);
}

export function parseArgs(argv: string[], env = process.env) {
  const sources: Source[] = [];
  const deliveries: Delivery[] = [];
  let slippageBps: number | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") {
      const [amount, symbol, chain, refund] = argv[++i].split(":");
      sources.push({ amount, symbol, chain, refundTo: refund ?? refundFor(chain, env) });
    } else if (a === "--to") {
      const [symbol, chain, modeRaw = "DESTINATION_CHAIN", recipient] = argv[++i].split(":");
      const mode = modeRaw.toUpperCase() as RecipientType;
      deliveries.push({ symbol, chain, mode, recipient: recipient ?? recipientFor(chain, mode, env) });
    } else if (a === "--slippage") slippageBps = Number(argv[++i]);
    else if (a === "--json") json = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!sources.length || !deliveries.length) throw new Error("need at least one --from and one --to");
  return { intent: { sources, deliveries, slippageBps }, json };
}

async function main() {
  loadEnv();
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "tokens") {
    const { registry } = await buildDeps();
    const sym = rest[0];
    const list = sym ? registry.tokens.filter((t) => t.symbol.toUpperCase() === sym.toUpperCase()) : registry.tokens;
    for (const t of list) console.log(`${t.symbol.padEnd(8)} ${t.blockchain.padEnd(10)} $${t.price}  ${t.assetId}`);
    return;
  }
  if (cmd === "plan") {
    const { intent, json } = parseArgs(rest);
    const deps = await buildDeps();
    const plan = await planRoute(intent, { ...deps, referral: process.env.REFERRAL });
    console.log(json ? JSON.stringify(plan, null, 2) : `${deps.mock ? "[MOCK MODE: simulated quotes]\n" : ""}${formatPlan(plan)}`);
    return;
  }
  if (cmd === "goldcurve") {
    // goldcurve --mint MINT --recipe fair-sol --wallet SOLANA_ADDR --from AMT:SYM:CHAIN[:REFUND] ...
    const get = (k: string) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
    const mint = get("--mint"), recipe = (get("--recipe") ?? "fair-sol") as RecipeId, wallet = get("--wallet") ?? process.env.RECIPIENT_SOL;
    if (!mint || !wallet) throw new Error(`usage: goldcurve --mint MINT --recipe ${Object.keys(RECIPES).join("|")} --wallet SOLANA_ADDR --from AMT:SYM:CHAIN[:REFUND] ...`);
    const fromArgs: string[] = [];
    rest.forEach((a, i) => { if (a === "--from") fromArgs.push("--from", rest[i + 1]); });
    const { intent: base } = parseArgs([...fromArgs, "--to", `SOL:sol:DESTINATION_CHAIN:${wallet}`]);
    const { intent, quote, handoffUrl } = goldCurveIntent({ mint, recipe, solanaWallet: wallet, sources: base.sources });
    const deps = await buildDeps();
    const plan = await planRoute(intent, { ...deps, referral: process.env.REFERRAL });
    console.log(`${deps.mock ? "[MOCK MODE: simulated quotes]\n" : ""}Gold Curve funding (${recipe}, quote ${quote}) for mint ${mint}\n${formatPlan(plan)}`);
    console.log(`Next: buy on the existing XAUConnect token page with your Solana wallet: ${handoffUrl}`);
    return;
  }
  if (cmd === "status") {
    const c = new OneClickClient({ baseUrl: process.env.ONECLICK_BASE_URL, jwt: process.env.ONECLICK_JWT });
    console.log(JSON.stringify(await c.status(rest[0], rest[1]), null, 2));
    return;
  }
  console.log("usage: cli.ts tokens [SYMBOL] | goldcurve --mint MINT --recipe RECIPE --wallet SOL_ADDR --from ... | plan --from AMT:SYM:CHAIN[:REFUND] ... --to SYM:CHAIN[:DESTINATION_CHAIN|INTENTS[:RECIPIENT]] ... [--slippage BPS] [--json] | status DEPOSIT_ADDRESS");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
}
