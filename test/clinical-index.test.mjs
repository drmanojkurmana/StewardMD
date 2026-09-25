/* The bundled monograph library must be FINDABLE, not just present.
 *
 * QA reported "No drugs match" for a molecule we ship a complete monograph for. The monograph was
 * never missing: data/offline-clinical.json.gz held it, and offline-clinical.js would have rendered
 * it. Nothing could search it. api.js asked the server (which indexes the Indian BRAND catalogue,
 * so a drug nobody sells here has no row) and then fell through to the 109-molecule formulary in
 * drugs.js. A reserve antibiotic is in neither.
 *
 * So these tests assert reachability, not shape: that the index lists what the bundle can open,
 * that the 104 authored monographs the SQL-derived bundle never had are in both, and that a doctor
 * typing a real drug name gets that drug back. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const require = createRequire(import.meta.url);
const I = require("../data/clinical-index.js");

const readGz = (p) => JSON.parse(gunzipSync(readFileSync(join(ROOT, "data", p))).toString("utf8"));
const bundle = readGz("offline-clinical.json.gz");
const supplement = readGz("clinical-supplement.json.gz");

/* ─────────────────────────── coverage ─────────────────────────── */

test("the index covers every molecule the app can open, and invents none", () => {
  // offline-clinical.js merges the supplement over the bundle, so the openable set is the union.
  const openable = new Set([...Object.keys(bundle.struct), ...Object.keys(supplement.struct)]);
  const listed = new Set(I.all().map((r) => r.n));
  assert.equal(listed.size, openable.size, "index lists " + listed.size + " of " + openable.size);
  const phantom = [...listed].filter((n) => !openable.has(n));
  assert.deepEqual(phantom, [], "the index must never offer a molecule that cannot then be opened");
  const unreachable = [...openable].filter((n) => !listed.has(n));
  assert.deepEqual(unreachable.slice(0, 5), [], unreachable.length + " molecules are shipped but unsearchable");
});

test("it is the whole library, not the 109-drug formulary that used to be the only fallback", () => {
  assert.ok(I.count() > 1500, "only " + I.count() + " molecules");
});

test("the authored monographs the bundle never contained are shipped and listed", () => {
  // These exist as finished records in worker/data/gold/ and were in NO bundle before the
  // supplement: the app could not show them however the doctor searched.
  ["Atropine sulfate", "Enoxaparin sodium", "Clopidogrel bisulfate", "Caspofungin acetate", "Fludrocortisone Acetate"]
    .forEach((n) => {
      assert.ok(supplement.struct[n], n + " missing from the supplement");
      assert.ok(I.has(n), n + " missing from the index");
    });
  assert.ok(Object.keys(supplement.struct).length >= 100, "the supplement lost records");
});

test("the supplement only adds, never shadows a bundled record", () => {
  const clash = Object.keys(supplement.struct).filter((k) => bundle.struct[k]);
  assert.deepEqual(clash, [], "these would be merged over the bundle's own rows: " + clash.join(", "));
});

test("every supplemented record carries parseable gold in the shape the renderer expects", () => {
  // api.js goldHTML() reads these keys directly; a record missing them renders an empty card.
  Object.keys(supplement.struct).forEach((k) => {
    const g = JSON.parse(supplement.struct[k].gold);
    assert.equal(typeof g.generic, "string", k + " has no generic");
    assert.ok(g.summary || g.quick, k + " has neither a summary nor quick facts");
  });
});

/* ─────────────────────────── searching ─────────────────────────── */

test("the molecule QA could not find comes back first", () => {
  const hit = I.search("Cefiderocol", 5);
  assert.equal(hit[0] && hit[0].n, "Cefiderocol");
  assert.ok(/cephalosporin/i.test(hit[0].c), "and carries its class: " + hit[0].c);
});

test("a partial name is enough, as it is when typing on a phone", () => {
  assert.ok(I.search("cefider", 5).some((r) => r.n === "Cefiderocol"));
  assert.ok(I.search("caspo", 5).some((r) => /Caspofungin/.test(r.n)));
  assert.ok(I.search("enoxa", 5).some((r) => /Enoxaparin/.test(r.n)));
});

test("an exact name outranks a longer one that merely contains it", () => {
  const r = I.search("Atropine", 5);
  assert.equal(r[0].n, "Atropine", "got " + r.map((x) => x.n).join(", "));
});

test("a class or a tag finds the molecule, so 'echinocandin' is a usable query", () => {
  assert.ok(I.search("echinocandin", 10).some((r) => /Caspofungin/.test(r.n)));
  assert.ok(I.search("siderophore", 20).some((r) => r.n === "Cefiderocol"));
  // "reserve" is the NINTH tag on Cefiderocol. An earlier cap of 8 dropped it, so this asserts the
  // whole tag list is indexed. A wide limit, because a common word legitimately ranks class matches
  // above tag matches and ranking is not what this test is about.
  assert.ok(I.search("reserve", 400).some((r) => r.n === "Cefiderocol"), "tags past the eighth are not indexed");
});

test("nonsense returns nothing rather than a loose match", () => {
  assert.deepEqual(I.search("zzzznotadrug", 5), []);
  assert.deepEqual(I.search("", 5), []);
});

test("the limit is honoured", () => {
  assert.ok(I.search("a", 3).length <= 3);
});

/* ─────────────────────────── the wiring that was missing ─────────────────────────── */

test("offline-clinical.js merges the supplement and exposes the search api.js calls", () => {
  const src = readFileSync(join(ROOT, "offline-clinical.js"), "utf8");
  assert.ok(src.includes("clinical-supplement.json.gz"), "the supplement is never fetched");
  assert.ok(src.includes("clinical-index.js"), "the index is never loaded");
  assert.ok(/search: searchLocal/.test(src), "SMD_OFFLINE_CLINICAL.search is not exported");
});

test("a missing supplement degrades to the bundle instead of breaking every lookup", () => {
  const src = readFileSync(join(ROOT, "offline-clinical.js"), "utf8");
  assert.ok(/fetchGz\(URL_SUP\)\.catch/.test(src), "the optional fetch is not guarded");
});

test("the Drugs Database search asks the monograph library when the server has nothing", () => {
  const src = readFileSync(join(ROOT, "api.js"), "utf8");
  assert.ok(src.includes("function goldSearch"), "api.js never searches the bundled library");
  assert.ok(/goldSearch\(q\)\.then/.test(src), "the empty-result path does not use it");
  assert.ok(src.includes("Clinical monographs"), "there is no section to render the hits in");
});

test("build-www ships both new payloads, or the app 404s them on the phone", () => {
  const sh = readFileSync(join(ROOT, "scripts", "build-www.sh"), "utf8");
  assert.ok(sh.includes("data/clinical-supplement.json.gz"), "supplement not copied into www/");
  assert.ok(sh.includes("data/clinical-index.js"), "index not copied into www/");
});
