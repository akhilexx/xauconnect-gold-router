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

test("near-intents-xau.ts ships with only its import rewritten to .js (backend is NodeNext)", () => {
  const src = readFileSync(join(root, "src/xauconnect/near-intents-xau.ts"), "utf8");
  const dst = readFileSync(join(tree, "backend/src/services/routing/near-intents-xau.ts"), "utf8");
  assert.equal(dst, src.replace('from "./near-intents.ts";', 'from "./near-intents.js";'));
  assert.notEqual(dst, src);
});

test("backend files in the patch tree never use extensionless or .ts relative imports (NodeNext + tsc build)", () => {
  for (const f of ["services/routing/near-intents.test.ts", "services/routing/near-intents-xau.ts", "services/routing/near-intents-xau.test.ts", "routes/near-intents.ts"]) {
    const s = readFileSync(join(tree, "backend/src", f), "utf8");
    for (const m of s.matchAll(/from "(\.{1,2}\/[^"]+)"/g)) assert.match(m[1]!, /\.js$/, `${f}: ${m[1]}`);
  }
});

test("base-73c354c copies are byte-identical to public XAUConnect main (git blob shas)", () => {
  const want: Record<string, string> = {
    "backend/src/routes/swap.ts": "c3e4af17d80bed206ba1de5a185e6afd6b52a275",
    "backend/package.json": "d2e1427be76c207c2f0ade0393a95a86fdbaa732",
    "backend/src/middleware/error.ts": "058b11a191701b053e0a66f3f4ea38a84b259b88",
    "backend/src/lib/user-errors.ts": "bbe3ccff8f33df4878dcc386e396ec1090bfccb8",
    "packages/utils/src/schemas.ts": "cef4e3656e4e72a063839483c88a948621acfa8a",
    "packages/utils/src/chains.ts": "d740b7796d321ed9528c314760e89b71793f8710",
  };
  for (const [f, sha] of Object.entries(want))
    assert.equal(execFileSync("git", ["hash-object", join(root, "patches/xauconnect/base-73c354c", f)]).toString().trim(), sha, f);
});

test("patches apply with git am to a fresh repo and reproduce the tree", () => {
  const dir = mkdtempSync(join(tmpdir(), "xau-am-"));
  try {
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, stdio: "pipe" });
    git("init", "-q");
    for (const f of ["backend/src/routes/swap.ts", "backend/package.json"]) {
      execFileSync("mkdir", ["-p", join(dir, f, "..")]);
      execFileSync("cp", [join(root, "patches/xauconnect/base-73c354c", f), join(dir, f)]);
    }
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    const patches = readdirSync(join(root, "patches/xauconnect")).filter((f) => f.endsWith(".patch")).sort();
    assert.equal(patches.length, 6);
    git("am", "-q", ...patches.map((p) => join(root, "patches/xauconnect", p)));
    for (const [, dst] of shared) assert.equal(readFileSync(join(dir, dst), "utf8"), readFileSync(join(tree, dst), "utf8"));
    for (const extra of ["apps/web/src/lib/near-intents/deposit.ts", "apps/web/src/components/launchpad/fund-from-another-chain.tsx", "apps/web/src/components/swap/near-intents-status.tsx", "backend/src/services/routing/near-intents.test.ts", "docs/NEAR_INTENTS.md",
      "backend/src/services/routing/near-intents-xau.ts", "backend/src/services/routing/near-intents-xau.test.ts", "backend/src/routes/near-intents.ts",
      "backend/src/routes/swap.ts", "backend/package.json"])
      assert.equal(readFileSync(join(dir, extra), "utf8"), readFileSync(join(tree, extra), "utf8"), extra);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
