/* Bundle slimming (build-www): one page per figure and minified JSON. Both must be lossless.
 *   node --test test/build-slim.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { slim, equivalent, inject, SNIPPET } from "../scripts/slim-figures.mjs";
import { minifyText, minifyDir } from "../scripts/minify-json.mjs";

const page = (theme, alt) => `<!doctype html><html><head><style>.iso[data-theme="light"]{--x:#fff}</style></head><body class="iso" data-theme="${theme}">` + (alt ? `<button id="altview" data-href="${alt}">Alt</button>` : "") + "<p>x</p></body></html>";

test("equivalent: only the theme attribute and the alternate-view suffix may differ", () => {
  assert.ok(equivalent(page("dark"), page("light")));
  assert.ok(equivalent(page("dark", "a-simple.html"), page("light", "a-simple-light.html")));
  assert.ok(!equivalent(page("dark"), page("light").replace("<p>x</p>", "<p>y</p>")));
});

test("inject: the theme switch sits right after the body tag, once", () => {
  const s = inject(page("dark"));
  assert.ok(s.includes('data-theme="dark">' + SNIPPET + "<p>"));
  assert.equal(inject(s), s);
  assert.equal(inject("<body>"), null);
});

test("slim: twins folded, a real difference is reported and both pages kept", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "slim-"));
  fs.writeFileSync(path.join(d, "a.html"), page("dark")); fs.writeFileSync(path.join(d, "a-light.html"), page("light"));
  fs.writeFileSync(path.join(d, "b.html"), page("dark")); fs.writeFileSync(path.join(d, "b-light.html"), page("light").replace("x", "y"));
  fs.writeFileSync(path.join(d, "c.html"), page("dark"));
  const r = slim(d);
  assert.equal(r.removed, 1);
  assert.deepEqual(r.problems, ["b.html: light build differs beyond the theme"]);
  assert.ok(!fs.existsSync(path.join(d, "a-light.html")) && fs.existsSync(path.join(d, "b-light.html")));
  assert.ok(fs.readFileSync(path.join(d, "a.html"), "utf8").includes(SNIPPET));
  assert.ok(!fs.readFileSync(path.join(d, "c.html"), "utf8").includes(SNIPPET), "a page with no twin is left alone");
});

test("every committed figure pair folds (else the build would fail)", () => {
  const dir = new URL("../prep/figures/", import.meta.url).pathname;
  const bad = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith("-light.html")) continue;
    const dark = path.join(dir, f.replace(/-light\.html$/, ".html"));
    if (!fs.existsSync(dark)) continue;
    const a = fs.readFileSync(dark, "utf8"), b = fs.readFileSync(path.join(dir, f), "utf8");
    if (!equivalent(a, b) || inject(a) == null) bad.push(f);
  }
  assert.deepEqual(bad, []);
});

test("minify: whitespace only, parse-equal, unparseable and -0 left alone", () => {
  assert.equal(minifyText('{\n "a": [1, 2.5, "x y"],\n "b": {"c": null}\n}'), '{"a":[1,2.5,"x y"],"b":{"c":null}}');
  assert.equal(minifyText("{not json"), null);
  assert.equal(minifyText('{"a": -0}'), null);
  assert.equal(minifyText('{"a":1}'), null, "already minimal");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "minj-"));
  fs.writeFileSync(path.join(d, "x.json"), '{ "k" : 1 }'); fs.writeFileSync(path.join(d, "y.txt"), '{ "k" : 1 }');
  assert.equal(minifyDir(d).files, 1);
  assert.equal(fs.readFileSync(path.join(d, "y.txt"), "utf8"), '{ "k" : 1 }');
});
