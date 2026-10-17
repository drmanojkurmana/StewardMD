// native-feel.css: app-wide native behaviour (owner 2026-10-16: "it should feel like a mobile app, not a webpage").
//   node --test test/native-feel.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const CSS = readFileSync(new URL("../native-feel.css", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("loaded early, after the design system and before any module stylesheet, with a kill switch", () => {
  const nf = HTML.indexOf("/native-feel.css?v="), ds = HTML.indexOf("/redesign-system.css?v=");
  assert.ok(nf > 0 && ds > 0 && nf > ds, "after redesign-system.css");
  assert.ok(nf < HTML.indexOf("/clinix.css?v="), "before module stylesheets");
  assert.match(HTML, /localStorage\.getItem\("smd_native_feel"\)==="0"\)document\.documentElement\.classList\.add\("no-native-feel"\)/);
});

test("every rule is scoped to html:not(.no-native-feel), so the switch turns all of it off", () => {
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.trim()).filter(Boolean);
  for (const r of rules) assert.match(r, /^html:not\(\.no-native-feel\)/, "unscoped rule: " + r.slice(0, 60));
});

test("controls: no double-tap zoom, no selection, no callout; inputs stay selectable", () => {
  assert.match(CSS, /:is\(button,[^)]*\[data-act\][^)]*\)\s*\{[^}]*touch-action: manipulation;[^}]*user-select: none;[^}]*-webkit-touch-callout: none;/);
  assert.match(CSS, /:is\(input, textarea, \[contenteditable\][^)]*\)\s*\{[^}]*user-select: text;/);
});

test("behaviour only: no colours, sizes or layout, so no module's look changes", () => {
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/(color|background|width|height|margin|padding|font|display|position)\s*:/.test(body.replace(/-webkit-tap-highlight-color/g, "")), "only behaviour properties");
});
