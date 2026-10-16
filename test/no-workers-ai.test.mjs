import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
test("wrangler.toml has no Workers AI binding (owner 2026-10-15: bill reached 200 USD); the capped CF_AI_FREE binding is the one exception", () => {
  const t = fs.readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.ok(!/binding\s*=\s*"AI"/.test(t), "a binding named AI is back");
  // the ONLY allowed Workers AI binding is the capped free-quota one (owner 2026-10-16), named CF_AI_FREE
  const ai = [...t.matchAll(/^\s*\[(?:env\.\w+\.)?ai\]\s*\n\s*binding\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
  assert.ok(ai.every((b) => b === "CF_AI_FREE"), "an [ai] binding other than CF_AI_FREE");
  assert.equal((t.match(/^\s*\[(?:env\.\w+\.)?ai\]/gm) || []).length, ai.length, "an [ai] table without a binding name");
  const users = fs.readdirSync(new URL("../functions/api/", import.meta.url), { recursive: true }).filter((f) => /\.js$/.test(f))
    .filter((f) => /CF_AI_FREE/.test(fs.readFileSync(new URL("../functions/api/" + f, import.meta.url), "utf8")));
  assert.deepEqual(users, ["retrieve/[[path]].js"], "only retrieve may use the free-quota binding");
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
