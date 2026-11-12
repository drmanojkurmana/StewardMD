// Owner rule (2026-11-11): no coloured side-accent bars anywhere in the app UI.
// A thick left border, an inset left box-shadow, or a colour-only left border on a card reads as AI slop.
// Glyphs drawn with borders (chevrons, ticks, triangles: rotated or zero-size boxes) are allowed,
// as is the reply-quote marker in outgoing email HTML (mail.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIRS = ["", "medcore", "wardsynq", "clinix", "surgx", "tokos", "narke", "ophthalmos", "clinical-pathways", "atlas"];
const SKIP_FILE = /(^|\/)(vendor-[^/]*|.*\.min\.js|capacitor\.config\.js)$/;
const ALLOW_FILE = new Set(["mail.js"]);
const PAGES = new Set(["index.html", "privacy.html", "terms.html", "disclaimer.html", "support.html", "copyright.html"]);

function walk(dir, top) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = dir ? dir + "/" + name : name;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) { if (!top && name !== "node_modules") out.push(...walk(rel, false)); continue; }
    if (!/\.(css|js|mjs|html)$/.test(name) || SKIP_FILE.test(rel) || /\.test\.mjs$/.test(name)) continue;
    if (top && name.endsWith(".html") && !PAGES.has(name)) continue;
    out.push(rel);
  }
  return out;
}

const GLYPH = /rotate|width:\s*0[;\s}]|height:\s*0[;\s}]|transparent/;
const BAD = [
  /(?:border-left|border-inline-start)\s*:\s*(\d*\.?\d+)px\s+solid/g,
  /(?:border-left-width|border-inline-start-width)\s*:\s*(\d*\.?\d+)px/g,
  /border-left-color\s*:/g,
  /box-shadow\s*:\s*inset\s+[2-6]px\s+0\s+0/g,
  /\.style\.borderLeft(?:Color)?\s*=/g,
];

test("no side-accent stripes in shipping UI source", () => {
  const files = DIRS.flatMap((d) => { try { return walk(d, d === ""); } catch { return []; } });
  assert.ok(files.length > 100, "scanned the app source");
  const hits = [];
  for (const f of files) {
    if (ALLOW_FILE.has(f)) continue;
    const src = readFileSync(join(ROOT, f), "utf8");
    const glyphSpans = [];
    for (const m of src.matchAll(/\{[^{}]*\}/g)) if (GLYPH.test(m[0])) glyphSpans.push([m.index, m.index + m[0].length]);
    const inGlyph = (i) => glyphSpans.some(([a, b]) => i >= a && i < b);
    for (const rx of BAD) {
      for (const m of src.matchAll(rx)) {
        if (inGlyph(m.index)) continue;
        if (m[1] !== undefined && parseFloat(m[1]) < 1) continue;
        if (rx === BAD[0] && parseFloat(m[1]) < 2 && !/rgba\(63,199,179|var\(--(teal|red|primary|accent|green|amber|orange)/.test(src.slice(m.index, m.index + 80))) continue;
        if (rx === BAD[1] && parseFloat(m[1]) < 2) continue;
        // a neutral hairline colour (low-alpha rgba or a line/hair token) recolours a divider, not a stripe
        if (rx === BAD[2] && /^border-left-color\s*:\s*(rgba\([^)]*,\s*0?\.[0-3]\d*\s*\)|var\(--[\w-]*(line|hair|bd|outline-variant)[\w-]*)/.test(src.slice(m.index, m.index + 80))) continue;
        hits.push(f + ":" + (src.slice(0, m.index).split("\n").length) + "  " + src.slice(m.index, m.index + 60).split("\n")[0]);
      }
    }
  }
  assert.deepEqual(hits, [], "side-accent stripes found:\n" + hits.join("\n"));
});
