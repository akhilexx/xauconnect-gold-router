// Agent tool endpoint (backlog item 5).
//
//   GET  /.well-known/agent-tools.json   public manifest: 4 tools, each with a JSON Schema for its input
//   POST /v1/agent/tools/:name           Authorization: Bearer <agent key>; body = tool arguments
//   GET  /v1/agent/audit                 the calling agent's own audit entries
//
// Every tool is read-only: dry quotes, status and the asset list. No tool can execute, deposit or sign.
// Per-agent keys come from AGENT_KEYS (JSON array; only SHA-256 hashes of keys are stored). Each key has
// a daily USD planning budget (UTC day) and an optional allow-list of output symbols, applied on top of
// the server policy. Order of checks, all before any quote: key (401) -> tool (404) -> schema (400) ->
// allowed outputs (403) -> budget (429). Every decision, allow or deny, goes to the audit log.
// Budgets and the in-memory audit log reset on restart; set AGENT_AUDIT_LOG=path to also append JSONL.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFileSync } from "node:fs";
import type { Policy } from "./policy.ts";
import type { TokenRegistry } from "./registry.ts";
import type { RouteIntent, RoutePlan } from "./types.ts";
import { validate, type Schema } from "./jsonschema.ts";
import { planFunding, type FundingInput } from "./xauconnect/fund-curve.ts";
import { toOneClickChain } from "./xauconnect/near-intents.ts";
import { fromBaseUnits } from "./units.ts";

// ---------- manifest ----------

const decimal: Schema = { type: "string", pattern: "^[0-9]+(\\.[0-9]+)?$", maxLength: 40 };
const chain: Schema = { type: "string", pattern: "^[a-z0-9]{2,12}$", description: "1Click blockchain key, e.g. eth, arb, base, sol" };
const symbol: Schema = { type: "string", pattern: "^[A-Za-z0-9.]{1,16}$" };
const address: Schema = { type: "string", minLength: 3, maxLength: 128 };
const xauChain: Schema = { type: "string", enum: ["ethereum", "bsc", "polygon", "arbitrum", "base", "avalanche", "solana"] };

export const TOOL_SCHEMAS: Record<string, Schema> = {
  plan_gold_route: {
    type: "object", additionalProperties: false, required: ["sources", "deliveries"],
    properties: {
      sources: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", additionalProperties: false, required: ["symbol", "chain", "amount", "refundTo"], properties: { symbol, chain, amount: decimal, refundTo: address } } },
      deliveries: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["symbol", "chain", "recipient", "mode"], properties: { symbol, chain, recipient: address, mode: { type: "string", enum: ["DESTINATION_CHAIN", "INTENTS"] } } } },
      slippageBps: { type: "integer", minimum: 0, maximum: 1000 },
    },
  },
  plan_gold_curve_funding: {
    type: "object", additionalProperties: false, required: ["mint", "connectedWallet", "from"],
    properties: {
      mint: address, poolConfig: address,
      recipe: { type: "string", enum: ["fair-sol", "fair-usdc", "shield-sol", "shield-usdc", "distribute-sol", "distribute-usdc"] },
      connectedWallet: address,
      from: { type: "object", additionalProperties: false, required: ["chain", "token", "sender"], properties: { chain: xauChain, token: address, sender: address } },
      want: decimal, spend: { type: "string", pattern: "^[0-9]+$", maxLength: 40 },
      slippageBps: { type: "integer", minimum: 0, maximum: 1000 }, raisedSoFar: { type: "number", minimum: 0 },
    },
  },
  get_route_status: {
    type: "object", additionalProperties: false, required: ["depositAddress"],
    properties: { depositAddress: address, depositMemo: { type: "string", maxLength: 128 } },
  },
  list_supported_assets: {
    type: "object", additionalProperties: false,
    properties: { symbol, chain },
  },
};

const DESCRIPTIONS: Record<string, string> = {
  plan_gold_route: "Dry-run plan: turn balances on several chains into gold (XAUT) or another allowed output via NEAR Intents, ranked by cost then ETA. Nothing is sent or signed.",
  plan_gold_curve_funding: "Dry-run quote to fund a Gold Curve pool buy on Solana from another chain. Delivery goes only to the connected Solana wallet; returns a hand-off URL where the user signs.",
  get_route_status: "Status of a NEAR Intents deposit (PENDING_DEPOSIT ... SUCCESS / REFUNDED / FAILED).",
  list_supported_assets: "Assets the router can quote, optionally filtered by symbol and/or chain.",
};

export const TOOL_NAMES = Object.keys(TOOL_SCHEMAS);

export function agentToolsManifest() {
  return {
    schemaVersion: "1",
    name: "xauconnect-gold-router",
    description: "Read-only route planning into tokenized gold, settled on NEAR Intents. Every tool is a dry run; no tool executes, deposits or signs.",
    auth: { type: "bearer", header: "Authorization", note: "Per-agent key issued by the operator. Unknown or revoked keys get 401 before any quote." },
    limits: { budget: "daily USD planning budget per agent key (UTC day)", outputs: "optional per-key allow-list of output symbols, on top of the server policy" },
    tools: TOOL_NAMES.map((name) => ({
      name, description: DESCRIPTIONS[name], method: "POST", path: `/v1/agent/tools/${name}`, readOnly: true, inputSchema: TOOL_SCHEMAS[name],
    })),
  };
}

/** Schema the manifest itself must satisfy (checked in tests). */
export const MANIFEST_SCHEMA: Schema = {
  type: "object", required: ["schemaVersion", "name", "description", "auth", "tools"],
  properties: {
    schemaVersion: { type: "string", const: "1" }, name: { type: "string", minLength: 1 }, description: { type: "string", minLength: 1 },
    auth: { type: "object", required: ["type", "header"], properties: { type: { type: "string", const: "bearer" }, header: { type: "string" } } },
    tools: { type: "array", minItems: 4, items: { type: "object", additionalProperties: false, required: ["name", "description", "method", "path", "readOnly", "inputSchema"], properties: {
      name: { type: "string", pattern: "^[a-z_]+$" }, description: { type: "string", minLength: 10 }, method: { type: "string", enum: ["POST"] },
      path: { type: "string", pattern: "^/v1/agent/tools/[a-z_]+$" }, readOnly: { type: "boolean", const: true }, inputSchema: { type: "object", required: ["type"] },
    } } },
  },
};

// ---------- keys ----------

export interface AgentKey {
  id: string;
  /** hex SHA-256 of the bearer key; the key itself is never stored */
  sha256: string;
  dailyUsd: number;
  allowedOutputs?: string[];
  revoked?: boolean;
}

export const hashKey = (key: string) => createHash("sha256").update(key, "utf8").digest("hex");

/** New random key plus the AGENT_KEYS entry to configure for it. Print once; store only the entry. */
export function newAgentKey(id: string, dailyUsd: number, allowedOutputs?: string[]): { key: string; entry: AgentKey } {
  const key = `xgr_${randomBytes(24).toString("base64url")}`;
  return { key, entry: { id, sha256: hashKey(key), dailyUsd, ...(allowedOutputs?.length ? { allowedOutputs } : {}) } };
}

export function agentKeysFromEnv(env: Record<string, string | undefined>): AgentKey[] {
  if (!env.AGENT_KEYS) return [];
  const raw = JSON.parse(env.AGENT_KEYS) as AgentKey[];
  if (!Array.isArray(raw)) throw new Error("AGENT_KEYS must be a JSON array");
  for (const k of raw) {
    if (!k.id || !/^[0-9a-f]{64}$/.test(k.sha256) || !(k.dailyUsd >= 0)) throw new Error(`AGENT_KEYS entry ${k.id ?? "?"} needs id, sha256 (64 hex) and dailyUsd >= 0`);
  }
  return raw;
}

function findKey(keys: AgentKey[], header: string | undefined): AgentKey | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  if (!m) return null;
  const h = Buffer.from(hashKey(m[1]!), "hex");
  let hit: AgentKey | null = null;
  for (const k of keys) if (timingSafeEqual(h, Buffer.from(k.sha256, "hex"))) hit = k; // same work for every key
  return hit && !hit.revoked ? hit : null;
}

// ---------- audit ----------

export interface AuditEntry {
  ts: string;
  agent: string | null;
  tool: string;
  decision: "allow" | "deny" | "error";
  reason: string;
  usd?: number;
  request?: unknown;
}

export class AuditLog {
  readonly entries: AuditEntry[] = [];
  private file?: string;
  private max: number;
  constructor(file?: string, max = 2000) { this.file = file; this.max = max; }
  record(e: AuditEntry): void {
    this.entries.push(e);
    if (this.entries.length > this.max) this.entries.shift();
    if (this.file) appendFileSync(this.file, JSON.stringify(e) + "\n");
  }
  forAgent(id: string): AuditEntry[] {
    return this.entries.filter((e) => e.agent === id);
  }
}

/** What goes in the audit log for a request: its shape only, never the key. */
function summarize(tool: string, args: Record<string, unknown>): unknown {
  if (tool === "plan_gold_route") {
    const i = args as unknown as RouteIntent;
    return {
      sources: (i.sources ?? []).map((s) => `${s.amount} ${s.symbol}@${s.chain}`),
      deliveries: (i.deliveries ?? []).map((d) => `${d.symbol}@${d.chain}:${d.mode}`),
    };
  }
  if (tool === "plan_gold_curve_funding") {
    const f = args as unknown as FundingInput;
    return { mint: f.mint, recipe: f.recipe ?? f.poolConfig, from: f.from?.chain, want: f.want, spend: f.spend };
  }
  return args;
}

// ---------- tools ----------

type FundingBody = ReturnType<typeof planFunding>["body"];

export interface AgentDeps {
  registry: TokenRegistry;
  policy: Policy;
  planRoute: (intent: RouteIntent, policy: Policy) => Promise<RoutePlan>;
  fundQuote: (body: FundingBody) => Promise<unknown>;
  status: (depositAddress: string, depositMemo?: string) => Promise<unknown>;
  keys: AgentKey[];
  audit: AuditLog;
  now?: () => Date;
}

export interface ToolResult { status: number; json: unknown }

const r2 = (n: number) => Math.round(n * 100) / 100;

export function createAgentTools(d: AgentDeps) {
  const spent = new Map<string, number>(); // `${agentId}|${utcDay}` -> USD planned today
  const now = d.now ?? (() => new Date());
  const dayKey = (id: string) => `${id}|${now().toISOString().slice(0, 10)}`;

  function priceSources(i: RouteIntent): number {
    let usd = 0;
    for (const s of i.sources) {
      if (!d.registry.has(s.symbol, s.chain)) continue; // the router rejects it; nothing to charge
      usd += Number(s.amount) * d.registry.resolve(s.symbol, s.chain).price;
    }
    return usd;
  }

  function priceFunding(body: FundingBody, quoteToken: string): number | null {
    if (body.swapType === "EXACT_OUTPUT") {
      const t = d.registry.has(quoteToken, "sol") ? d.registry.resolve(quoteToken, "sol") : null;
      return t ? Number(fromBaseUnits(body.amount, t.decimals)) * t.price : null;
    }
    const c = toOneClickChain(body.fromChain);
    const t = d.registry.tokens.find((x) => x.blockchain === c && (x.contractAddress ?? "").toLowerCase() === body.tokenIn.toLowerCase());
    return t ? Number(fromBaseUnits(body.amount, t.decimals)) * t.price : null;
  }

  function listAssets(a: Record<string, unknown>) {
    const sym = a.symbol ? String(a.symbol).toUpperCase() : null;
    const ch = a.chain ? String(a.chain).toLowerCase() : null;
    return d.registry.tokens
      .filter((t) => (!sym || t.symbol.toUpperCase() === sym) && (!ch || t.blockchain === ch))
      .map((t) => ({ symbol: t.symbol, chain: t.blockchain, decimals: t.decimals, contractAddress: t.contractAddress ?? null, priceUsd: t.price }));
  }

  async function call(tool: string, authHeader: string | undefined, args: unknown): Promise<ToolResult> {
    const ts = now().toISOString();
    const key = findKey(d.keys, authHeader);
    if (!key) {
      d.audit.record({ ts, agent: null, tool, decision: "deny", reason: "unknown or revoked agent key" });
      return { status: 401, json: { error: "unknown or revoked agent key", code: "UNAUTHORIZED" } };
    }
    const deny = (status: number, code: string, reason: string, request?: unknown, usd?: number): ToolResult => {
      d.audit.record({ ts, agent: key.id, tool, decision: "deny", reason, request, ...(usd !== undefined ? { usd: r2(usd) } : {}) });
      return { status, json: { error: reason, code } };
    };
    const schema = TOOL_SCHEMAS[tool];
    if (!schema) return deny(404, "UNKNOWN_TOOL", `unknown tool ${tool}`);
    const errs = validate(schema, args);
    if (errs.length) return deny(400, "INVALID_ARGUMENTS", errs.slice(0, 5).join("; "));
    const a = args as Record<string, unknown>;
    const request = summarize(tool, a);
    const allowed = key.allowedOutputs?.map((s) => s.toUpperCase());
    const remaining = key.dailyUsd - (spent.get(dayKey(key.id)) ?? 0);
    const charge = (usd: number) => spent.set(dayKey(key.id), (spent.get(dayKey(key.id)) ?? 0) + usd);
    const overBudget = (est: number) =>
      deny(429, "BUDGET_EXHAUSTED", `daily budget: ~$${r2(est)} requested, $${r2(Math.max(0, remaining))} of $${key.dailyUsd} left today (UTC)`, request, est);
    try {
      if (tool === "plan_gold_route") {
        const intent = a as unknown as RouteIntent;
        const bad = allowed ? intent.deliveries.find((x) => !allowed.includes(x.symbol.toUpperCase())) : undefined;
        if (bad) return deny(403, "OUTPUT_NOT_ALLOWED", `output ${bad.symbol} is not allowed for agent ${key.id}`, request);
        const est = priceSources(intent);
        if (est > remaining) return overBudget(est);
        const policy: Policy = allowed
          ? { ...d.policy, allowedOutputSymbols: d.policy.allowedOutputSymbols === "*" ? allowed : d.policy.allowedOutputSymbols.filter((s) => allowed.includes(s.toUpperCase())) }
          : d.policy;
        charge(est); // reserve first, so parallel calls cannot overspend
        let plan: RoutePlan;
        try { plan = await d.planRoute(intent, policy); } catch (e) { charge(-est); throw e; }
        const used = plan.totals.amountInUsd; // only legs that got a quote count
        charge(used - est);
        d.audit.record({ ts, agent: key.id, tool, decision: "allow", reason: `${plan.legs.length} leg(s), ${plan.rejected.length} blocked by policy, ${plan.failures.length} without quote`, usd: r2(used), request });
        return { status: 200, json: plan };
      }
      if (tool === "plan_gold_curve_funding") {
        let plan;
        try { plan = planFunding(a as unknown as FundingInput); } catch (e) { return deny(400, "INVALID_ARGUMENTS", (e as Error).message, request); }
        if (allowed && !allowed.includes(plan.quoteToken)) return deny(403, "OUTPUT_NOT_ALLOWED", `output ${plan.quoteToken} is not allowed for agent ${key.id}`, request);
        const est = priceFunding(plan.body, plan.quoteToken);
        if (est === null) return deny(400, "UNPRICEABLE", "cannot price this request for the agent budget; use a listed token", request);
        if (est > remaining) return overBudget(est);
        charge(est);
        let quote: unknown;
        try { quote = await d.fundQuote(plan.body); } catch (e) { charge(-est); throw e; }
        d.audit.record({ ts, agent: key.id, tool, decision: "allow", reason: `recipe ${plan.recipe}, dry quote`, usd: r2(est), request });
        return { status: 200, json: { ...plan, quote, handoffUrl: `https://xauconnect.com${plan.handoffPath}` } };
      }
      if (tool === "get_route_status") {
        const st = await d.status(String(a.depositAddress), a.depositMemo ? String(a.depositMemo) : undefined);
        d.audit.record({ ts, agent: key.id, tool, decision: "allow", reason: "status read", request });
        return { status: 200, json: st };
      }
      const assets = listAssets(a);
      d.audit.record({ ts, agent: key.id, tool, decision: "allow", reason: `${assets.length} asset(s)`, request });
      return { status: 200, json: { assets } };
    } catch (e) {
      d.audit.record({ ts, agent: key.id, tool, decision: "error", reason: (e as Error).message, request });
      throw e;
    }
  }

  function audit(authHeader: string | undefined): ToolResult {
    const key = findKey(d.keys, authHeader);
    if (!key) return { status: 401, json: { error: "unknown or revoked agent key", code: "UNAUTHORIZED" } };
    return { status: 200, json: { agent: key.id, spentTodayUsd: r2(spent.get(dayKey(key.id)) ?? 0), dailyUsd: key.dailyUsd, entries: d.audit.forAgent(key.id) } };
  }

  return { call, audit };
}
