/* test/medcore-flags.test.mjs — the Medical Core flag registry, and what each default is for.
 *
 * Step 1 of vault/modules/Medical Core.md created the flags BEFORE the code they gate, so that no
 * commit had to add a switch and a clinical path in the same change. Both defaulted off while
 * there was nothing to enable. The master flag now defaults ON (owner decision, BETA label, see
 * vault/decisions/Decisions.md) because the DETERMINISTIC layer is built.
 *
 * The safety property this file pins is therefore no longer "both flags are off". It is the split:
 * the deterministic layer is on, and the MODEL half is off and cannot be reached, because no
 * artifact passed the admission gates. A change that turns smd_medcore_shadow on by default, or
 * that lets a probability reach a clinician, has to come through this test on purpose.
 */
import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import F from "../medcore-flags.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FLAGS = ["smd_medcore", "smd_medcore_shadow"];

test("flags: the registry defines exactly the two pre-integration flags", () => {
  assert.deepEqual(Object.keys(F.DEFS).sort(), FLAGS.slice().sort());
  FLAGS.forEach((k) => {
    assert.equal(F.DEFS[k].type, "bool", k + " must be a bool");
    assert.ok(F.DEFS[k].query, k + " needs a query alias");
    assert.ok(F.DEFS[k].desc && F.DEFS[k].desc.length > 40, k + " needs a real description");
  });
});

test("flags: the master flag defaults ON, the model half defaults OFF", () => {
  // The deterministic layer ships to everyone, labelled BETA. Changing this line is an owner
  // decision, not a refactor.
  assert.equal(F.DEFS.smd_medcore.def, true, "smd_medcore must default true");
  // The model half stays off. No artifact passed the admission gates on the available data, so
  // there is nothing to shadow; turning this on by default would be shadowing nothing.
  assert.equal(F.DEFS.smd_medcore_shadow.def, false, "smd_medcore_shadow must default false");
  assert.deepEqual(F.all(), { smd_medcore: true, smd_medcore_shadow: false });
  assert.equal(F.bool("smd_medcore"), true);
  assert.equal(F.bool("smd_medcore_shadow"), false);
});

test("flags: default ON is still overridable to a complete no-op", () => {
  // `?medcore=0` is the whole escape hatch, and medcore-boot.js reads it before its first import
  // and its first fetch. Pin that the registry defines the alias that makes that possible.
  assert.equal(F.DEFS.smd_medcore.query, "medcore");
  assert.equal(typeof F.set, "function");
});

test("flags: shadow is meaningless without an admitted model", () => {
  // shadowActive() reads through get(), which in node has no store and no query string, so this
  // pins the composition rule rather than a stubbed value: the master flag is now true, so the
  // false here comes entirely from the shadow flag. That is the property that matters.
  assert.equal(F.bool("smd_medcore"), true);
  assert.equal(F.shadowActive(), false);
  assert.equal(typeof F.shadowActive, "function");
});

test("flags: an unknown flag is null, not a silent false", () => {
  assert.equal(F.get("smd_medcore_typo"), null);
  assert.equal(F.set("smd_medcore_typo", true), false);
});

test("flags: the registry has no side effects beyond its own export", () => {
  const src = readFileSync(join(ROOT, "medcore-flags.js"), "utf8");
  assert.ok(!/addEventListener|setTimeout|setInterval|fetch\(|XMLHttpRequest|document\./.test(src),
    "the registry must not touch the DOM, the network or a timer");
  assert.ok(!/require\(|^import /m.test(src), "the registry must not depend on any other module");
});

test("inert: only the named consumers read the Medical Core flags", () => {
  // This list was empty when the registry was created; it grows only in the commit that wires a
  // consumer, deliberately, naming it - never by deleting this test.
  //   medcore-boot.js  reads smd_medcore and returns immediately when it is off (Phase 1, step 6)
  //   icu.js           renders the deterministic panel only when the flag is on AND the boot module
  //                    installed window.SMD_MEDCORE (Phase 1, step 6)
  //   index.html       loads the two files; the boot module is inert with the flag off
  const ALLOWED = new Set(["medcore-flags.js", "medcore-boot.js", "icu.js", "index.html"]);
  const SKIP_DIRS = new Set([
    "node_modules", ".git", "ios", "android", "www", "_site", "archive", "vault", "test",
    "docs", "qa-report", "Packages", "patches", "vendor", "licenses", "store-assets"
  ]);
  const hits = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const rel = relative(ROOT, p);
      if (SKIP_DIRS.has(name)) continue;
      const st = statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      if (!/\.(js|mjs|html)$/.test(name)) continue;
      if (ALLOWED.has(rel)) continue;
      const src = readFileSync(p, "utf8");
      if (/SMD_MEDCORE_FLAGS|smd_medcore/.test(src)) hits.push(rel);
    }
  })(ROOT);
  assert.deepEqual(hits, [], "unexpected Medical Core flag consumers: " + hits.join(", "));
});

test("inert: every named consumer checks the flag before it does anything", () => {
  const boot = readFileSync(join(ROOT, "medcore-boot.js"), "utf8");
  // The flag test must come before the first fetch and the first dynamic import, or "off" is only
  // off after the network has already been used.
  const flagAt = boot.indexOf("flagOn()");
  const guardAt = boot.indexOf("if (!flagOn()) return;");
  assert.ok(flagAt > -1 && guardAt > -1, "medcore-boot must have a flag guard");
  assert.ok(guardAt < boot.indexOf("import("), "the guard must precede the first dynamic import");
  assert.ok(guardAt < boot.indexOf("await loadPacks"), "the guard must precede the first fetch");
  assert.ok(/window\.SMD_MEDCORE\s*=/.test(boot), "it installs exactly one global");
  assert.equal((boot.match(/window\.SMD_MEDCORE\s*=/g) || []).length, 1);

  const icu = readFileSync(join(ROOT, "icu.js"), "utf8");
  assert.ok(/function medCoreOn\(\)/.test(icu), "icu.js guards on its own helper");
  assert.ok(/if \(!medCoreOn\(\)\) return null;/.test(icu), "the guard returns before any work");
  // The panel must never be able to write to the chart or raise anything.
  const panel = icu.slice(icu.indexOf("function medCorePanel()"), icu.indexOf("function fmtMins("));
  assert.ok(!/ingest|save|alerts\.push|notify|escalat/i.test(panel), "the panel only renders");
});
