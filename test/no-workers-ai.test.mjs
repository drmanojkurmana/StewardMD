import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
test("wrangler.toml has no Workers AI binding (owner 2026-10-15: bill reached 200 USD)", () => {
  const t = fs.readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.ok(!/^\s*\[(?:env\.\w+\.)?ai\]\s*$/m.test(t), "an [ai] binding is back");
  assert.ok(!/binding\s*=\s*"AI"/.test(t), "a binding named AI is back");
});
