import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import M from "../clinix-model.js";

/* This is the test the 1,041-lesson kardiox content pack never got. It loads the REAL shipped
 * JSON and validates it against the same model the app renders with, so an authoring mistake
 * fails here rather than rendering an empty chapter on someone's phone. */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(ROOT, "clinix", p), "utf8"));

const manifest = read("manifest.json");
const mediaManifest = read("media/manifest.json");

function loadAllSkills() {
  const skills = {};
  for (const pack of manifest.skillPacks) {
    const p = read(pack.file);
    Object.assign(skills, p.skills);
  }
  return skills;
}

function loadDisease(file) {
  const d = read(file);
  return { disease: d, localSkills: d.skills || {} };
}

/* Manifest ------------------------------------------------------------------ */

test("manifest: every declared skill pack file exists and parses", () => {
  for (const pack of manifest.skillPacks) {
    assert.ok(existsSync(join(ROOT, "clinix", pack.file)), `missing ${pack.file}`);
    const p = read(pack.file);
    assert.ok(p.skills && typeof p.skills === "object", `${pack.file} has no skills map`);
  }
});

test("manifest: every declared disease file exists and parses", () => {
  for (const sys of manifest.systems) {
    for (const d of sys.diseases) {
      assert.ok(existsSync(join(ROOT, "clinix", d.file)), `missing ${d.file}`);
      const parsed = read(d.file);
      assert.equal(parsed.id, d.id, `${d.file}: id does not match the manifest entry`);
      assert.equal(parsed.system, sys.id, `${d.file}: system does not match its manifest system`);
    }
  }
});

test("manifest: a system's skillPacks all exist in skillPacks", () => {
  const known = new Set(manifest.skillPacks.map((p) => p.id));
  for (const sys of manifest.systems) {
    for (const id of sys.skillPacks) {
      assert.ok(known.has(id), `system ${sys.id} references unknown skill pack '${id}'`);
    }
  }
});

test("manifest: the advertised chapter count matches the disease file", () => {
  for (const sys of manifest.systems) {
    for (const d of sys.diseases) {
      const parsed = read(d.file);
      assert.equal(
        parsed.chapters.length, d.chapters,
        `${d.id}: manifest says ${d.chapters} chapters, file has ${parsed.chapters.length}. ` +
        "A count that drifts from the content is how KardiQ ended up advertising 100 lessons over 1,141."
      );
    }
  }
});

/* Whole-pack integrity ------------------------------------------------------ */

test("COPD pack: passes full referential validation", () => {
  const shared = loadAllSkills();
  const { disease, localSkills } = loadDisease("diseases/copd.json");
  const skills = Object.assign({}, shared, localSkills);
  const v = M.validatePack({ skills, media: mediaManifest.media, diseases: [disease] });
  assert.deepEqual(v.errors, [], "content errors:\n" + v.errors.join("\n"));
});

test("COPD pack: every emphasis targets a skill that is actually in that chapter", () => {
  const shared = loadAllSkills();
  const { disease, localSkills } = loadDisease("diseases/copd.json");
  const skills = Object.assign({}, shared, localSkills);
  for (const ch of disease.chapters) {
    const inChapter = new Set(ch.skills || []);
    for (const id of Object.keys(ch.emphasis || {})) {
      assert.ok(skills[id], `chapter ${ch.id} emphasises unknown skill ${id}`);
      assert.ok(inChapter.has(id),
        `chapter ${ch.id} emphasises ${id}, which is not listed in that chapter's skills. ` +
        "The emphasis would never be shown.");
    }
  }
});

test("COPD pack: OSCE stations and viva reference skills that exist", () => {
  const shared = loadAllSkills();
  const { disease, localSkills } = loadDisease("diseases/copd.json");
  const skills = Object.assign({}, shared, localSkills);
  for (const st of (disease.osce && disease.osce.stations) || []) {
    for (const id of st.skills) assert.ok(skills[id], `station ${st.id} references unknown skill ${id}`);
  }
  for (const id of (disease.viva && disease.viva.skills) || []) {
    assert.ok(skills[id], `viva references unknown skill ${id}`);
  }
});

/* The projections must actually work on the real content -------------------- */

test("every real skill compiles into a lesson with a why and a closing check", () => {
  const shared = loadAllSkills();
  const { localSkills } = loadDisease("diseases/copd.json");
  const skills = Object.assign({}, shared, localSkills);
  for (const id of Object.keys(skills)) {
    const turns = M.compileLesson(skills[id]);
    assert.ok(turns.length >= 3, `${id} compiled to only ${turns.length} turns`);
    assert.ok(
      turns.some((t) => t.kind === "tell" && t.heading === "Why we do it"),
      `${id} produced no 'why' turn`
    );
    assert.ok(
      turns.some((t) => t.kind === "ask" || t.kind === "check"),
      `${id} produced no question at all, so it can never write competency`
    );
  }
});

test("the OSCE station generated from real skills has critical items and a sane clock", () => {
  const shared = loadAllSkills();
  const { disease, localSkills } = loadDisease("diseases/copd.json");
  const skills = Object.assign({}, shared, localSkills);
  const def = disease.osce.stations[0];
  const st = M.compileStation(def.skills.map((id) => skills[id]), def);

  assert.ok(st.items.length >= 10, "a full respiratory station should have a substantial checklist");
  assert.ok(st.criticalCount >= 1, "a station with no critical item cannot fail anyone on safety");
  assert.ok(st.seconds >= 180 && st.seconds <= 900, "station time should be realistic");

  // Consent is critical, so a perfect-except-consent run must fail.
  const allButConsent = st.items.filter((i) => i.id.indexOf("consent") < 0).map((i) => i.id);
  const r = M.scoreStation(st, allButConsent);
  assert.equal(r.failedOnCritical, true, "missing consent must fail the station");
  assert.equal(r.passed, false);
});

test("the viva pool spans more than one difficulty level", () => {
  const shared = loadAllSkills();
  const { disease, localSkills } = loadDisease("diseases/copd.json");
  const skills = Object.assign({}, shared, localSkills);
  const v = M.compileViva(disease.viva.skills.map((id) => skills[id]));
  const levels = new Set(v.pool.map((q) => q.level));
  assert.ok(levels.size >= 3, "a viva that cannot escalate is not adaptive; got levels " + [...levels]);
  assert.ok(v.pool.length >= 15, "viva pool too small to sustain a session");
});

/* Safety invariants --------------------------------------------------------- */

test("SAFETY: nothing in the shipped pack is student-visible until it is reviewed", () => {
  const shared = loadAllSkills();
  const { disease, localSkills } = loadDisease("diseases/copd.json");
  const skills = Object.assign({}, shared, localSkills);
  const visible = Object.keys(skills).filter((id) => M.isRenderable(skills[id]));
  assert.deepEqual(
    visible, [],
    "These skills would reach a student without clinical sign-off: " + visible.join(", ") +
    ". Content is authored as ai_drafted and the owner flips it to approved after review."
  );
  assert.equal(M.isRenderable(disease), false, "the disease itself is also unreviewed");
});

test("SAFETY: with the author flag on, the same content is fully visible", () => {
  const shared = loadAllSkills();
  const { disease, localSkills } = loadDisease("diseases/copd.json");
  const skills = Object.assign({}, shared, localSkills);
  const pathway = M.buildPathway(disease, skills, { allowDraft: true });
  assert.ok(pathway.length >= 10, "author mode should show the whole pathway");
  assert.equal(pathway.filter((c) => c.empty).length, 0,
    "no chapter should be empty in author mode: " +
    pathway.filter((c) => c.empty).map((c) => c.id).join(", "));
});

test("SAFETY: no media is cleared, so the licence gate currently blocks every asset", () => {
  const cleared = Object.keys(mediaManifest.media).filter((id) => M.mediaRenderable(mediaManifest.media[id]));
  assert.deepEqual(
    cleared, [],
    "Media marked cleared without a verified licence: " + cleared.join(", ")
  );
});

test("SAFETY: every media entry still carries a caption, so a gated asset degrades to something useful", () => {
  for (const id of Object.keys(mediaManifest.media)) {
    const m = mediaManifest.media[id];
    assert.ok(m.caption && m.caption.length > 10,
      `${id} has no usable caption; a gated asset would render as a blank space`);
    assert.ok(m.note && m.note.length > 10, `${id} has no sourcing note, so nobody knows what to obtain`);
  }
});

test("SAFETY: treatment skills carry an explicit dosing disclaimer", () => {
  const { localSkills } = loadDisease("diseases/copd.json");
  const tx = Object.keys(localSkills).filter((id) => localSkills[id].kind === "treatment");
  assert.ok(tx.length >= 2, "expected treatment skills in the COPD pack");
  for (const id of tx) {
    assert.ok(localSkills[id].dosingNote && localSkills[id].dosingNote.indexOf("does not prescribe") > 0,
      `${id} must carry a dosing note stating CliniX does not prescribe`);
  }
});

test("SAFETY: every skill cites at least one real source with a locator", () => {
  const shared = loadAllSkills();
  const { localSkills } = loadDisease("diseases/copd.json");
  const skills = Object.assign({}, shared, localSkills);
  for (const id of Object.keys(skills)) {
    const src = skills[id].sources;
    assert.ok(Array.isArray(src) && src.length > 0, `${id} has no source`);
    for (const s of src) {
      assert.ok(s.source && s.source.length > 3, `${id} has a source with no name`);
      assert.ok(s.locator && s.locator.length > 2,
        `${id} cites '${s.source}' with no locator. An unlocatable citation is not a citation.`);
    }
  }
});

/* Content quality ----------------------------------------------------------- */

test("no em-dash in student-facing content", () => {
  // CLAUDE.md: no em-dash in app-facing text. Content JSON is app-facing text.
  for (const f of ["skills/core.json", "skills/respiratory.json", "diseases/copd.json", "manifest.json", "media/manifest.json"]) {
    const raw = readFileSync(join(ROOT, "clinix", f), "utf8");
    const idx = raw.indexOf("—");
    assert.equal(idx, -1, `${f} contains an em-dash at offset ${idx}: ` +
      (idx >= 0 ? JSON.stringify(raw.slice(Math.max(0, idx - 60), idx + 60)) : ""));
  }
});

test("every exam skill teaches at least one named common mistake", () => {
  const shared = loadAllSkills();
  const { localSkills } = loadDisease("diseases/copd.json");
  const skills = Object.assign({}, shared, localSkills);
  for (const id of Object.keys(skills)) {
    const s = skills[id];
    if (s.kind !== "exam" && s.kind !== "general_exam" && s.kind !== "approach") continue;
    assert.ok(Array.isArray(s.pitfalls) && s.pitfalls.length >= 1,
      `${id} teaches no pitfalls; "what students get wrong" is half the value of a bedside lesson`);
  }
});

test("the COPD pathway covers the full clinical journey the product promises", () => {
  const { disease } = loadDisease("diseases/copd.json");
  const ids = disease.chapters.map((c) => c.id);
  for (const required of [
    "approach", "history", "general_exam", "systemic_exam",
    "differential", "investigations", "diagnosis", "treatment"
  ]) {
    assert.ok(ids.includes(required), `COPD pathway is missing the '${required}' chapter`);
  }
  // The order must follow the model's canonical spine, so every disease reads the same way.
  const spine = M.CHAPTERS;
  const positions = ids.map((id) => spine.indexOf(id));
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i] > positions[i - 1],
      `chapters are out of canonical order at '${ids[i]}'`);
  }
});
