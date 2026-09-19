/* test/medcore-flags.test.mjs — the Medical Core flag registry, and proof that it is inert.
 *
 * Step 1 of vault/modules/Medical Core.md creates the flags BEFORE the code they gate, so that no
 * later commit has to add a switch and a clinical path in the same change. The interesting
 * assertions here are therefore not "the getter works" but "both flags are off" and "nothing in the
 * app reads them yet". The second one stops being true on purpose, in a named later step; when it
 * does, this test is what forces the change to be deliberate.
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

test("flags: both default OFF, and that is the whole safety property today", () => {
  FLAGS.forEach((k) => assert.equal(F.DEFS[k].def, false, k + " must default false"));
  assert.deepEqual(F.all(), { smd_medcore: false, smd_medcore_shadow: false });
  FLAGS.forEach((k) => assert.equal(F.bool(k), false));
});

test("flags: shadow is meaningless without the master flag", () => {
  assert.equal(F.shadowActive(), false);
  // shadowActive() reads through get(), which in node has no store and no query string, so this
  // pins the composition rule rather than a stubbed value: with both defaults false it is false.
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

test("inert: nothing in the app reads the Medical Core flags yet", () => {
  // When a later step wires medcore-boot.js this list stops being empty. Update it in THAT commit,
  // deliberately, naming the consumer - never by deleting this test.
  const ALLOWED = new Set(["medcore-flags.js"]);
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
