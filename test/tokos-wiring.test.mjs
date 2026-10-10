import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("app boot loads only tokos-loader.js; the loader lists the engine and Tokós files at one version token", () => {
  const html = readFileSync("index.html", "utf8");
  const eng = /(specialty(-(core|data|stage|shell|learn|bank|explore|tools|notes))?|tokos[-.\w]*)\.(js|css)\?v=\w+/g;
  assert.deepEqual(html.match(eng), ["tokos-loader.js?v=tok10"], "boot requests no engine or Tokós file but the loader");
  const L = readFileSync("tokos-loader.js", "utf8"), v = /var V = "(\w+)"/.exec(L)[1];
  assert.equal(v, "tok10", "the loader injects at the same token as its own tag");
  for (const f of ["specialty.css", "tokos.css", "specialty-core.js", "specialty-shell.js", "tokos.js", "tokos-calipers.js", "tokos-ctg.js", "tokos-clinic-us.js", "tokos-clinic-us.css", "tokos-sim-labour.js", "tokos-sim-labour.css", "tokos-explore-ui.js", "tokos-explore-ui.css"]) assert.ok(L.includes('"' + f + '"'), f);
  assert.ok(L.indexOf('"tokos.js"') < L.indexOf('"tokos-ctg.js"') && L.indexOf('"specialty-notes.js"') < L.indexOf('"tokos.js"'), "engine, then the host, then its clinic");
});

test("build-www.sh ships the tokos data directory and the models directory", () => {
  const b = readFileSync("scripts/build-www.sh", "utf8");
  assert.ok(/cp -R tokos\/\./.test(b));
  assert.ok(/cp -R tokos-models\/\./.test(b), "tokos-models/ is a subdirectory: the root *.js glob does not reach it");
});

test("home tile is ON by default (owner 2026-09-29): only smd_tokos=\"0\" or ?tokos=0 hides it, like Ophthalmós", () => {
  const h = readFileSync("home.js", "utf8");
  const i = h.indexOf('act: "tokos"');
  assert.ok(i > 0);
  const tile = h.slice(i, i + 500);
  assert.ok(/smd_tokos"\) !== "0"/.test(tile) && /\[\?&\]tokos=/.test(tile) && /catch \(e\) \{ return true; \}/.test(tile));
  assert.ok(!/defOn: false/.test(tile.slice(0, tile.indexOf("eligible"))), "no defOn:false, so the tile shows on Home by default");
  // TOKOS.open / TOKOS.openCase (Review Desk) honour the same kill switch, before and after Tokós loads
  const t = readFileSync("tokos-loader.js", "utf8");
  assert.ok(/smd_tokos"\) !== "0"/.test(t) && /\[\?&\]tokos=/.test(t));
  assert.ok(/flag: "smd_tokos"/.test(readFileSync("tokos.js", "utf8")), "the host's own kill switch (engine enabled())");
});

test("swipe-back wires TOKOS like OPHTHALMOS", () => {
  const s = readFileSync("swipe-back.js", "utf8");
  assert.ok(/TOKOS\.isOpen\(\)\) return true/.test(s));
  assert.ok(/TOKOS\.back\(\) !== false/.test(s));
});
