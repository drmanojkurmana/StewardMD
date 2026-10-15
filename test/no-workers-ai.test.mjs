import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
test("wrangler.toml has no Workers AI binding (owner 2026-10-15: bill reached 200 USD)", () => {
  const t = fs.readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.ok(!/^\s*\[(?:env\.\w+\.)?ai\]\s*$/m.test(t), "an [ai] binding is back");
  assert.ok(!/binding\s*=\s*"AI"/.test(t), "a binding named AI is back");
});

test("nothing in CI or the repo tools can spend Workers AI unless ALLOW_CF_AI=1 is set by hand", async () => {
  const wf = fs.readdirSync(new URL("../.github/workflows/", import.meta.url)).filter((f) => /\.ya?ml$/.test(f));
  for (const f of wf) {
    const t = fs.readFileSync(new URL("../.github/workflows/" + f, import.meta.url), "utf8");
    assert.ok(!/ai\/run|@cf\/baai|embed-upsert|build-disease-vectors/.test(t), f + " runs a Workers AI tool");
  }
  for (const p of ["kb/tools/embed-upsert.mjs", "kb/tools/build-disease-vectors.mjs"]) {
    const t = fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
    assert.match(t, /ALLOW_CF_AI !== "1"/, p + " lost its guard");
  }
});
