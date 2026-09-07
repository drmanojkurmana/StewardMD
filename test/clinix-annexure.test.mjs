/* CliniX annexures: reference material, and the calculators they link into.
 *
 * CliniX owns no calculators. An annexure that involves arithmetic deep-links into the app's own
 * Calculators module, and the renderer is fail-soft: an id the catalog does not have is silently
 * skipped. That silence is exactly how three dead calculator ids shipped in SURGX (asa, iss, tbsa),
 * so every id is resolved here against the real catalog parsed out of calculators.js.
 *
 * Also asserts the z-index lift, because a deep-linked calculator that opens BEHIND the CliniX
 * overlay looks broken while working perfectly - the same bug that made SURGX's Drug index and
 * antibiogram buttons appear dead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLINIX = join(ROOT, "clinix");
const load = (p) => JSON.parse(readFileSync(join(CLINIX, p), "utf8"));

/* Top-level catalog entries carry `cat:` right after `id:`. Nested INPUT fields also use `id:` but
 * never `cat:` - matching those too is what made "asa" look valid in SURGX. */
function catalogIds() {
  const src = readFileSync(join(ROOT, "calculators.js"), "utf8");
  return new Set([...src.matchAll(/\{ *id:"([a-z0-9_]+)", *cat:/g)].map((m) => m[1]));
}

function allSkills() {
  const out = {};
  for (const f of readdirSync(join(CLINIX, "skills"))) {
    if (!f.endsWith(".json")) continue;
    Object.assign(out, load(`skills/${f}`).skills);
  }
  return out;
}

test("the calculator catalog parses (guards every assertion below)", () => {
  const ids = catalogIds();
  assert.ok(ids.size > 300, `expected a few hundred calculators, parsed ${ids.size}`);
  for (const known of ["pack_years", "alcohol_units", "smoking_index", "auditc", "cage"]) {
    assert.ok(ids.has(known), `catalog is missing ${known}`);
  }
});

test("every calculator an annexure links to actually exists", () => {
  const ids = catalogIds();
  const broken = [];
  for (const [id, s] of Object.entries(allSkills())) {
    for (const c of s.calcs || []) if (!ids.has(c)) broken.push(`${id} -> "${c}"`);
  }
  assert.deepEqual(broken, [], "CliniX links to calculators that do not exist:\n  " + broken.join("\n  "));
});

test("the alcohol and tobacco annexures exist, and sit in the right systems", () => {
  const skills = allSkills();
  const alc = skills["skill.annex.alcohol"];
  const tob = skills["skill.annex.tobacco"];
  assert.ok(alc, "the alcohol annexure is missing");
  assert.ok(tob, "the tobacco annexure is missing");
  assert.equal(alc.system, "abdomen", "alcohol belongs with the GI system");
  assert.equal(tob.system, "respiratory", "tobacco belongs with the respiratory system");
  for (const s of [alc, tob]) {
    assert.equal(s.kind, "annexure");
    assert.ok((s.calcs || []).length, `${s.id} should link to its calculator`);
    assert.ok((s.teach || []).length >= 3, `${s.id} is reference material and needs real depth`);
    assert.equal(s.review?.status, "ai_drafted");
    assert.ok((s.sources || []).length >= 2, `${s.id} must cite its texts`);
  }
  assert.ok(alc.calcs.includes("alcohol_units"));
  assert.ok(tob.calcs.includes("smoking_index") && tob.calcs.includes("pack_years"));
});

test("both are reachable: an Annexures chapter references them", () => {
  for (const [system, id] of [["abdomen", "skill.annex.alcohol"], ["respiratory", "skill.annex.tobacco"]]) {
    const ch = load(`systems/${system}.json`).chapters.find((c) => c.id === "annexures");
    assert.ok(ch, `${system} has no annexures chapter, so the annexure is unreachable`);
    assert.ok((ch.skills || []).includes(id), `${system} annexures chapter does not reference ${id}`);
  }
});

test("the annexures chapter is registered in the model, or content will not validate", () => {
  const model = readFileSync(join(ROOT, "clinix-model.js"), "utf8");
  const chapters = model.slice(model.indexOf("var CHAPTERS"), model.indexOf("var SKILL_KINDS"));
  assert.match(chapters, /"annexures"/, "annexures is not a known chapter id");
  const kinds = model.slice(model.indexOf("var SKILL_KINDS"), model.indexOf("var SKILL_KINDS") + 700);
  assert.match(kinds, /"annexure"/, "annexure is not a known skill kind");
});

test("a deep-linked calculator is lifted ABOVE the CliniX overlay", () => {
  /* .mc-overlay is z-index 870; the CliniX overlay is 1250. Without the lift the calculator opens
   * behind it, fully working and invisible. Scoped to html.cx-lock so it reverts on close. */
  const css = readFileSync(join(ROOT, "clinix.css"), "utf8");
  const overlayZ = Number((css.match(/z-index:\s*(\d+)/) || [])[1]);
  assert.ok(overlayZ > 0, "could not read the CliniX overlay z-index");
  const lift = css.match(/html\.cx-lock\s+\.mc-overlay\s*\{[^}]*z-index:\s*(\d+)/);
  assert.ok(lift, "no lift rule: a deep-linked calculator will open behind CliniX");
  assert.ok(Number(lift[1]) > overlayZ, `lift (${lift[1]}) must exceed the CliniX overlay (${overlayZ})`);
  assert.ok(Number(lift[1]) < 16000, "the lift must stay below the prescription pad");
});

test("the tools turn is wired end to end", () => {
  // A turn the model emits but the renderer ignores would silently show nothing.
  const model = readFileSync(join(ROOT, "clinix-model.js"), "utf8");
  const screens = readFileSync(join(ROOT, "clinix-screens.js"), "utf8");
  assert.match(model, /turn\("tools"/, "the model never emits a tools turn");
  assert.match(model, /"tools",/, "tools is not a declared turn kind");
  assert.match(screens, /case "tools": return toolsTurn/, "the renderer ignores the tools turn");
  assert.match(screens, /data-act="cx-calc"/, "the chip does not use the cx-* act convention");
  assert.match(screens, /case "cx-calc":/, "nothing handles a tap on the chip");
});
