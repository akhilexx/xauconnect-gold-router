// The XAUConnect patches must ship exactly the modules tested here, and must apply with git am.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const tree = join(root, "patches/xauconnect/tree");
const shared: [string, string][] = [
  ["src/xauconnect/near-intents.ts", "backend/src/services/routing/near-intents.ts"],
  ["src/xauconnect/fund-curve.ts", "apps/web/src/lib/near-intents/fund-curve.ts"],
  ["src/xauconnect/solana-deposit-ix.ts", "apps/web/src/lib/near-intents/solana-deposit-ix.ts"],
  ["src/xauconnect/status.ts", "apps/web/src/lib/near-intents/status.ts"],
];

test("patch tree ships the tested modules byte for byte", () => {
  for (const [src, dst] of shared) assert.equal(readFileSync(join(tree, dst), "utf8"), readFileSync(join(root, src), "utf8"), dst);
});

test("patches apply with git am to a fresh repo and reproduce the tree", () => {
  const dir = mkdtempSync(join(tmpdir(), "xau-am-"));
  try {
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, stdio: "pipe" });
    git("init", "-q");
    git("commit", "-q", "--allow-empty", "-m", "base");
    const patches = readdirSync(join(root, "patches/xauconnect")).filter((f) => f.endsWith(".patch")).sort();
    assert.equal(patches.length, 4);
    git("am", "-q", ...patches.map((p) => join(root, "patches/xauconnect", p)));
    for (const [, dst] of shared) assert.equal(readFileSync(join(dir, dst), "utf8"), readFileSync(join(tree, dst), "utf8"));
    for (const extra of ["apps/web/src/lib/near-intents/deposit.ts", "apps/web/src/components/launchpad/fund-from-another-chain.tsx", "apps/web/src/components/swap/near-intents-status.tsx", "backend/src/services/routing/near-intents.test.ts", "docs/NEAR_INTENTS.md"])
      assert.equal(readFileSync(join(dir, extra), "utf8"), readFileSync(join(tree, extra), "utf8"), extra);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
