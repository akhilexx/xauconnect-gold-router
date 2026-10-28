import { readFileSync, existsSync } from "node:fs";
import { OneClickClient } from "./oneclick.ts";
import { MockOneClick } from "./mock.ts";
import { TokenRegistry } from "./registry.ts";
import { policyFromEnv } from "./policy.ts";
import type { Token } from "./types.ts";

/** Load KEY=VALUE pairs from .env if present (no dependency on dotenv). */
export function loadEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

export async function buildDeps(env = process.env) {
  const mock = env.MOCK === "1";
  const policy = policyFromEnv(env);
  if (mock) {
    const tokens: Token[] = JSON.parse(readFileSync(new URL("../fixtures/tokens.json", import.meta.url), "utf8"));
    return { mock, policy, registry: new TokenRegistry(tokens), client: new MockOneClick(tokens) };
  }
  const client = new OneClickClient({ baseUrl: env.ONECLICK_BASE_URL, jwt: env.ONECLICK_JWT });
  const registry = new TokenRegistry(await client.tokens());
  return { mock, policy, registry, client };
}
