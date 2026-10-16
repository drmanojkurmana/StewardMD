/* prep-watermark.test.mjs - the PrepNucleus home brand watermark (owner 2026-10-16): the mark + "Powered by StewardMD" in the
 * empty right side of the home header on wide screens. Decorative and inert; both home render paths carry it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const js = fs.readFileSync(path.join(ROOT, "prep-plan.js"), "utf8"), css = fs.readFileSync(path.join(ROOT, "prep-plan.css"), "utf8");

test("both home render paths include the watermark ahead of the readiness card", () => {
  assert.match(js, /id="pnPlanTop" class="pl-top">' \+ wmHtml\(\) \+ heroHtml\(/);
  assert.match(js, /box\.innerHTML = wmHtml\(\) \+ heroHtml\(/);
});

test("the watermark is decorative: aria-hidden, empty alts, explicit image sizes, the brand words", () => {
  const m = /function wmHtml\(\) \{([\s\S]*?)\n  \}/.exec(js)[1];
  assert.match(m, /class="pl-wm" aria-hidden="true"/);
  assert.equal((m.match(/alt=""/g) || []).length, 2);
  assert.match(m, /width="84" height="84"/); assert.match(m, /width="20" height="20"/);
  assert.match(m, /Powered by/); assert.match(m, /StewardMD/);
});

test("css: hidden by default, only from 760 px, inert to touch, not selectable, dark variant", () => {
  assert.match(css, /\.pn-root \.pl-wm \{ display: none; \}/);
  const wide = /@media \(min-width: 760px\) \{([\s\S]*?)\n\}/.exec(css.slice(css.indexOf(".pl-wm"))) [1];
  assert.match(wide, /pointer-events: none/); assert.match(wide, /user-select: none/);
  assert.match(wide, /body\.dark \.pn-root \.pl-wm/);
});

test("the two small images exist at the repo root (build-www copies root png files), under 40 KB each", () => {
  for (const f of ["prepnucleus-wm.png", "stewardmd-wm.png"]) {
    const p = path.join(ROOT, f); assert.ok(fs.existsSync(p), f); assert.ok(fs.statSync(p).size < 40 * 1024, f + " size");
  }
  assert.equal(fs.readFileSync(path.join(ROOT, "prepnucleus-wm.png"))[25], 6, "RGBA, so the mark has no background box");
});
