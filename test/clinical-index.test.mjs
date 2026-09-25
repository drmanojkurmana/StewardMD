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
import { readFileSync, readdirSync } from "node:fs";
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

test("the index exposes the exact lookup api.js compClass() needs", () => {
  // api.js goldFor() used to read a window global sourced from a file that never existed, so a
  // molecule's class came back empty. It now reads this.
  assert.equal(typeof I.get, "function");
  assert.equal(I.get("Cefiderocol").n, "Cefiderocol");
  assert.ok(/cephalosporin/i.test(I.get("Cefiderocol").c));
  assert.equal(I.get("Ceftriaxone (1000mg)").n, "Ceftriaxone", "a strength-suffixed composition resolves to its molecule");
  assert.equal(I.get("zzznotadrug"), null);
});

test("the authored monographs the bundle never contained are shipped and listed", () => {
  // Finished records in worker/data/gold/ that were in NO bundle: the app could not show them
  // however the doctor searched. These are the ones that are a genuinely new molecule, not a salt
  // form of one the bundle already had.
  ["Human Albumin", "Caspofungin", "Enoxaparin", "Clopidogrel"]
    .forEach((n) => assert.ok(I.has(n), n + " is not reachable"));
  assert.ok(Object.keys(supplement.struct).length >= 45, "the supplement lost records");
});

test("a salt form is one molecule, not two rows", () => {
  // "Atropine sulfate" IS atropine. Shipping both put two rows for one drug in every search, so the
  // supplement no longer adds a salt form of a molecule the bundle already carries.
  ["Atropine sulfate", "Enoxaparin sodium", "Clopidogrel bisulfate", "Metformin hydrochloride"]
    .forEach((n) => assert.equal(supplement.struct[n], undefined, n + " is a duplicate of the plain molecule"));
  // and the plain molecule is still there, exactly once
  ["Atropine", "Enoxaparin", "Clopidogrel", "Metformin"].forEach((n) => {
    assert.ok(I.has(n), n + " went missing");
    assert.equal(I.all().filter((r) => r.n === n).length, 1, n + " is listed more than once");
  });
});

test("a doctor who types the salt still finds the drug", () => {
  // Dropping the row must not make the name unfindable: the query is retried without the
  // counter-ion. This is the regression that dropping the rows would otherwise have introduced.
  [["Atropine sulfate", "Atropine"], ["Enoxaparin sodium", "Enoxaparin"],
   ["Clopidogrel bisulfate", "Clopidogrel"], ["Metformin hydrochloride", "Metformin"]]
    .forEach(([typed, want]) => {
      assert.equal(I.search(typed, 3)[0] && I.search(typed, 3)[0].n, want, typed + " should reach " + want);
      assert.equal(I.get(typed) && I.get(typed).n, want, "get(" + typed + ") should reach " + want);
    });
});

test("salt stripping never merges two products that genuinely differ by salt", () => {
  // Calcium Acetate is a phosphate binder; Calcium is a supplement. Fluticasone Furoate and
  // Propionate are different products. Stripping happens on the QUERY as a last resort, never on
  // the stored names, so an exact name still wins and both rows survive.
  ["Calcium Acetate", "Calcium Chloride", "Calcium Gluconate"].forEach((n) => {
    if (!I.has(n)) return;                       // not every one is in the corpus
    assert.equal(I.search(n, 3)[0].n, n, n + " must resolve to itself, not to Calcium");
  });
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

test("a drug is findable under every name it is known by", () => {
  // The corpus writes alternates into `generic` in parentheses. They were not indexed, so a drug was
  // findable under one spelling and invisible under the others.
  [["Aciclovir", "Acyclovir"], ["Prostaglandin E1", "Alprostadil"], ["SAMe", "Ademetionine"]]
    .forEach(([typed, want]) => {
      const hit = I.search(typed, 3)[0];
      assert.ok(hit, typed + " finds nothing");
      assert.equal(hit.n, want, typed + " should reach " + want);
      assert.equal(I.get(typed) && I.get(typed).n, want, "get(" + typed + ") should reach " + want);
    });
});

test("an exact synonym never loses to a partial match on a DIFFERENT drug", () => {
  // The one that matters clinically: "Epinephrine" is adrenaline. Before aliases were indexed the
  // only thing that matched was a substring of "Norepinephrine" -- a different drug, different
  // indications -- and it came back as the top hit. An exact alias must outrank any partial match.
  const hit = I.search("Epinephrine", 5)[0];
  assert.equal(hit.n, "Adrenaline", "Epinephrine must reach Adrenaline, not " + hit.n);
  assert.notEqual(hit.n, "Norepinephrine", "returning the wrong catecholamine is a safety defect");
});

test("every authored monograph is reachable by a name a clinician would type", () => {
  // Not the full "Abacavir (Abacavir Sulfate)" string, which nobody types: the base name or one of
  // its parenthetical alternates.
  const aliasesOf = (name) => {
    const m = /^([^(]+)\(([^)]*)\)\s*$/.exec(String(name || "").trim());
    if (!m) return [];
    return m[2].split(/,|\bor\b/).map((x) => x.replace(/\s+/g, " ").trim())
      .filter((x) => x && x.split(" ").length <= 4);
  };
  const goldDir = join(ROOT, "worker", "data", "gold");
  const files = readdirSync(goldDir).filter((f) => f.endsWith(".json"));
  const unreachable = [];
  for (const f of files) {
    let g;
    try { g = JSON.parse(readFileSync(join(goldDir, f), "utf8")); } catch { continue; }
    const full = String(g.generic || "").trim();
    if (!full) continue;
    const names = [full.replace(/\s*\(.*$/, "").trim(), ...aliasesOf(full)].filter(Boolean);
    if (!names.some((n) => I.get(n) || I.search(n, 3).length)) unreachable.push(full);
  }
  assert.ok(files.length > 1500, "only " + files.length + " gold files scanned");
  assert.deepEqual(unreachable.slice(0, 5), [], unreachable.length + " monographs cannot be found");
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
