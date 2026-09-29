import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("index.html loads the tokos css and five JS files at one version token", () => {
  const html = readFileSync("index.html", "utf8");
  const tags = html.match(/tokos[-.\w]*\?v=(\w+)/g) || [];
  assert.ok(tags.length >= 6, "expected >= 6 tokos tags, found " + tags.length);
  assert.equal(new Set(tags.map((t) => t.split("v=")[1])).size, 1, "one shared version token");
});

test("build-www.sh ships the tokos data directory", () => {
  assert.ok(/cp -R tokos\/\./.test(readFileSync("scripts/build-www.sh", "utf8")));
});

test("home tile is ON by default (owner 2026-09-29): only smd_tokos=\"0\" or ?tokos=0 hides it, like Ophthalmós", () => {
  const h = readFileSync("home.js", "utf8");
  const i = h.indexOf('act: "tokos"');
  assert.ok(i > 0);
  const tile = h.slice(i, i + 500);
  assert.ok(/smd_tokos"\) !== "0"/.test(tile) && /\[\?&\]tokos=/.test(tile) && /catch \(e\) \{ return true; \}/.test(tile));
  assert.ok(!/defOn: false/.test(tile.slice(0, tile.indexOf("eligible"))), "no defOn:false, so the tile shows on Home by default");
  // TOKOS.openCase (Review Desk) honours the same kill switch
  const t = readFileSync("tokos.js", "utf8");
  assert.ok(/smd_tokos"\) !== "0"/.test(t) && /\[\?&\]tokos=/.test(t));
});

test("swipe-back wires TOKOS like OPHTHALMOS", () => {
  const s = readFileSync("swipe-back.js", "utf8");
  assert.ok(/TOKOS\.isOpen\(\)\) return true/.test(s));
  assert.ok(/TOKOS\.back\(\) !== false/.test(s));
});
