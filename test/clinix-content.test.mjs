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

// Every disease in the manifest, so a new one is covered by these tests the moment it is listed
// rather than needing its own copy of them.
const ALL_DISEASES = manifest.systems.flatMap((sys) => sys.diseases.map((d) => d.file));
// A system module is a disease-shaped pathway (the whole workup, no disease attached), so it gets
// exactly the same referential and safety checks.
const ALL_MODULES = manifest.systems.filter((s) => s.module).map((s) => s.module.file);
const ALL_PATHWAYS = ALL_DISEASES.concat(ALL_MODULES);

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

test("EVERY disease pack passes full referential validation", () => {
  const shared = loadAllSkills();
  for (const file of ALL_PATHWAYS) {
    const { disease, localSkills } = loadDisease(file);
    const skills = Object.assign({}, shared, localSkills);
    const v = M.validatePack({ skills, media: mediaManifest.media, diseases: [disease] });
    assert.deepEqual(v.errors, [], `${file} content errors:\n` + v.errors.join("\n"));
  }
});

test("EVERY disease: emphasis targets a skill that is actually in that chapter", () => {
  const shared = loadAllSkills();
  for (const file of ALL_DISEASES) {
  const { disease, localSkills } = loadDisease(file);
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
  }
});

test("EVERY pathway: OSCE stations and viva reference skills that exist", () => {
  const shared = loadAllSkills();
  for (const file of ALL_PATHWAYS) {
    const { disease, localSkills } = loadDisease(file);
    const skills = Object.assign({}, shared, localSkills);
    for (const st of (disease.osce && disease.osce.stations) || []) {
      for (const id of st.skills) assert.ok(skills[id], `${file} station ${st.id} references unknown skill ${id}`);
    }
    for (const id of (disease.viva && disease.viva.skills) || []) {
      assert.ok(skills[id], `${file} viva references unknown skill ${id}`);
    }
  }
});

test("SYSTEM MODULE: respiratory teaches the whole workup with no disease attached", () => {
  // The point of the module is that a student learns to examine a chest BEFORE choosing a disease.
  const shared = loadAllSkills();
  const mod = manifest.systems.find((s) => s.id === "respiratory").module;
  assert.ok(mod, "respiratory has a system module");
  const { disease, localSkills } = loadDisease(mod.file);
  assert.equal(Object.keys(localSkills).length, 0,
    "a system module owns NO skills of its own; it is pure references to the shared packs");

  const ids = disease.chapters.map((c) => c.id);
  for (const need of ["approach", "particulars", "history", "general_exam", "systemic_exam", "differential", "diagnosis"]) {
    assert.ok(ids.includes(need), `the system module is missing the '${need}' chapter`);
  }
  // and it walks the canonical spine in order, like every pathway
  const pos = ids.map((id) => M.CHAPTERS.indexOf(id));
  for (let i = 1; i < pos.length; i++) assert.ok(pos[i] > pos[i - 1], `chapters out of order at '${ids[i]}'`);

  for (const ch of disease.chapters) {
    for (const id of ch.skills || []) assert.ok(shared[id], `module references unknown skill ${id}`);
  }
});

test("SYSTEM MODULE: the pattern skill teaches the four discriminating findings", () => {
  const shared = loadAllSkills();
  const s = shared["skill.resp.patterns"];
  assert.ok(s && Array.isArray(s.teach), "the pattern skill is taught, not just asserted");
  const text = JSON.stringify(s.teach).toLowerCase();
  for (const need of ["trachea", "percussion", "breath sounds", "vocal resonance"]) {
    assert.ok(text.indexOf(need) >= 0, `the pattern teaching never mentions ${need}`);
  }
  // the two classic confusions must be named explicitly
  assert.ok(text.indexOf("collapse") >= 0 && text.indexOf("effusion") >= 0);
});

/* The architecture claim, measured ------------------------------------------ */

test("THE ONE-MODEL CLAIM: a second disease mostly REFERENCES shared skills, it does not copy them", () => {
  // The whole architecture rests on this. If a new disease had to author its own examination
  // skills, the model would be a filing convention rather than a design.
  const shared = loadAllSkills();
  const sharedIds = new Set(Object.keys(shared));

  const eff = loadDisease("diseases/pleural-effusion.json");
  const referenced = new Set();
  for (const ch of eff.disease.chapters) for (const id of (ch.skills || [])) referenced.add(id);

  const reused = [...referenced].filter((id) => sharedIds.has(id));
  const ownAuthored = [...referenced].filter((id) => !sharedIds.has(id));

  assert.ok(reused.length >= 15,
    `pleural effusion reuses only ${reused.length} shared skills; the sharing model is not paying off`);
  assert.ok(reused.length > ownAuthored.length,
    `more skills authored (${ownAuthored.length}) than reused (${reused.length})`);

  // And crucially it reuses the EXAMINATION skills rather than writing its own.
  for (const id of [
    "skill.exam.resp.percussion", "skill.exam.resp.auscultation",
    "skill.exam.resp.expansion", "skill.exam.resp.trachea", "skill.exam.resp.vocal_resonance"
  ]) {
    assert.ok(referenced.has(id), `pleural effusion does not reuse ${id}`);
  }
});

test("THE ONE-MODEL CLAIM: the same skill teaches OPPOSITE findings in the two diseases", () => {
  // This is what emphasis is for, and it is also the best way to teach both: one authored
  // percussion skill, hyperresonant in COPD and stony dull in an effusion.
  function emphasisFor(file, chapterId, skillId) {
    const { disease } = loadDisease(file);
    const ch = disease.chapters.find((c) => c.id === chapterId);
    return ((ch && ch.emphasis) || {})[skillId] || {};
  }
  const copdPerc = emphasisFor("diseases/copd.json", "systemic_exam", "skill.exam.resp.percussion");
  const effPerc = emphasisFor("diseases/pleural-effusion.json", "systemic_exam", "skill.exam.resp.percussion");

  assert.ok(/hyperresonan/i.test(copdPerc.expect), "COPD should expect hyperresonance");
  assert.ok(/stony/i.test(effPerc.expect), "an effusion should expect stony dullness");

  const copdTrachea = emphasisFor("diseases/copd.json", "systemic_exam", "skill.exam.resp.trachea");
  const effTrachea = emphasisFor("diseases/pleural-effusion.json", "systemic_exam", "skill.exam.resp.trachea");
  assert.ok(/central/i.test(copdTrachea.expect), "COPD: trachea central");
  assert.ok(/away/i.test(effTrachea.expect), "effusion: trachea pushed away");
});

test("ARCHITECTURE: a disease file never owns a skill that is not disease-specific", () => {
  // An examination manoeuvre, a history question, an approach step or a case presentation is the
  // same wherever you are: percussion does not change because the patient has COPD, only what you
  // EXPECT changes, and that is what emphasis is for. Those kinds belong in a shared pack so every
  // disease reuses one copy, and so the Examination Skills library can reach them at all.
  // This rule was learned twice: skill.present.copd and skill.copd.corpulmonale both started life
  // wrongly namespaced to a disease.
  const SHARED_ONLY = ["approach", "history", "general_exam", "exam", "presentation"];
  for (const file of ALL_DISEASES) {
    const { localSkills } = loadDisease(file);
    for (const id of Object.keys(localSkills)) {
      const kind = localSkills[id].kind;
      assert.ok(SHARED_ONLY.indexOf(kind) < 0,
        `${file} owns '${id}' of kind '${kind}'. That kind is never disease-specific - move it to ` +
        "a shared pack and use chapter emphasis for what differs.");
    }
  }
});

test("ARCHITECTURE: no skill id is defined in two places", () => {
  // A disease-local skill silently SHADOWS a shared one of the same id, so a stale copy can win
  // without anything failing. skill.present.case shadowed its own shared version this way.
  const shared = loadAllSkills();
  for (const file of ALL_DISEASES) {
    const { localSkills } = loadDisease(file);
    for (const id of Object.keys(localSkills)) {
      assert.ok(!shared[id],
        `'${id}' is defined BOTH in a shared pack and in ${file}. The disease copy shadows the ` +
        "shared one, so the two will drift and nobody will notice.");
    }
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
  const localAll = {};
  for (const file of ALL_DISEASES) Object.assign(localAll, loadDisease(file).localSkills);
  const { disease } = loadDisease("diseases/copd.json");
  const skills = Object.assign({}, shared, localAll);
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

test("SAFETY: every cleared asset is one of the three legally clean classes", () => {
  // Only three things may render: something we drew, something we generate at play time, or
  // something embedded through the rights holder's own player. Anything else cleared would mean
  // we had downloaded or re-hosted third-party media.
  const cleared = Object.keys(mediaManifest.media).filter((id) => M.mediaRenderable(mediaManifest.media[id]) || M.isEmbeddable(mediaManifest.media[id]));
  assert.ok(cleared.length >= 20, `expected a substantial cleared set, got ${cleared.length}`);
  for (const id of cleared) {
    const m = mediaManifest.media[id];
    const selfAuthored = m.inline === true && m.diagramId && m.attribution === "StewardMD";
    const synthesized = m.synth === true && m.audioKind && m.attribution === "StewardMD";
    const embedded = m.kind === "embed" && m.embeddable === true && m.videoId && m.sourceUrl && m.attribution;
    assert.ok(selfAuthored || synthesized || embedded,
      `${id} is cleared but is none of: self-authored diagram, synthesized audio, verified embed`);
  }
});

test("SAFETY: nothing embedded is ALSO re-hosted", () => {
  // An embed must point at the rights holder's player and nothing else. A src on an embed would
  // mean we had taken a copy of the file.
  for (const id of Object.keys(mediaManifest.media)) {
    const m = mediaManifest.media[id];
    if (m.kind !== "embed") continue;
    assert.ok(!m.src, `${id} is an embed but also carries a src, which implies a re-hosted copy`);
    assert.ok(/^https:\/\/www\.youtube\.com\/watch\?v=/.test(m.sourceUrl), `${id} sourceUrl is not a canonical YouTube watch URL`);
    assert.ok(m.attribution && m.attribution.length > 2, `${id} has no creator attribution`);
    assert.ok(m.title && m.title.length > 4, `${id} has no video title to credit`);
  }
});

test("SAFETY: an externally sourced FILE is never cleared without a verified licence", () => {
  // Hosted files are the class that needs real licence diligence. Any still uncleared must carry a
  // sourcing note saying what is needed.
  for (const id of Object.keys(mediaManifest.media)) {
    const m = mediaManifest.media[id];
    const isOurs = m.inline === true || m.synth === true || m.kind === "embed";
    if (isOurs) continue;
    assert.equal(M.mediaRenderable(m), false,
      `${id} is an externally sourced file and must not render until its licence is verified`);
    assert.ok(m.note && m.note.length > 10, `${id} has no sourcing note`);
  }
});

test("SAFETY: synthesized audio is labelled as a model, not a recording", () => {
  const A = mediaManifest.media;
  const synth = Object.keys(A).filter((id) => A[id].synth === true);
  assert.ok(synth.length >= 6, "expected the synthesized auscultation set");
  for (const id of synth) {
    assert.ok(/synthes/i.test(A[id].licence),
      `${id} must say in its licence that it is synthesized, so it is never mistaken for a patient recording`);
    assert.ok(A[id].audioKind, `${id} names no sound model`);
  }
});

test("every cleared inline diagram exists in the diagram registry", async () => {
  const D = (await import("../clinix-diagrams.js")).default;
  for (const id of Object.keys(mediaManifest.media)) {
    const m = mediaManifest.media[id];
    if (!m.inline) continue;
    assert.ok(D.has(m.diagramId), `${id} names diagram '${m.diagramId}', which is not in the registry`);
    const svg = D.render(m.diagramId, {});
    assert.ok(svg.indexOf("<svg") >= 0, `${m.diagramId} rendered nothing`);
  }
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

test("TEACHING: blocks are short and digestible, one idea per screen", () => {
  // The whole complaint about the first cut was that it read like a textbook. A teaching block that
  // arrives as a wall of prose on a phone is the same failure in a new place.
  const shared = loadAllSkills();
  const localAll = {};
  for (const file of ALL_DISEASES) Object.assign(localAll, loadDisease(file).localSkills);
  const all = Object.assign({}, shared, localAll);

  let taught = 0;
  for (const id of Object.keys(all)) {
    const blocks = all[id].teach;
    if (!Array.isArray(blocks)) continue;
    taught++;
    assert.ok(blocks.length >= 2, `${id} has only ${blocks.length} teaching block(s); split it up`);
    for (const b of blocks) {
      assert.ok(b.heading && b.heading.length > 3, `${id} has a teaching block with no real heading`);
      if (b.body) {
        for (const para of String(b.body).split(/\n\s*\n/)) {
          assert.ok(para.trim().length <= 460,
            `${id} block "${b.heading}" has a ${para.trim().length}-char paragraph. ` +
            "Break it with a blank line; this renders on a phone.");
        }
      }
      if (b.table) {
        assert.ok(b.table.cols.length <= 4, `${id} table "${b.heading}" has ${b.table.cols.length} columns; too wide for a phone`);
        for (const row of b.table.rows) {
          assert.equal(row.length, b.table.cols.length, `${id} table "${b.heading}" has a row with the wrong cell count`);
        }
      }
    }
  }
  assert.ok(taught >= 4, `only ${taught} skills have a teaching section`);
});

test("TEACHING: content drawn from the book cites the book", () => {
  // It is the owner's own book, used with permission and paraphrased, but provenance still gets
  // recorded like any other source.
  const shared = loadAllSkills();
  const BOOK = "An Insider's Guide to Clinical Medicine";
  const taughtIds = Object.keys(shared).filter((id) => Array.isArray(shared[id].teach));
  assert.ok(taughtIds.length > 0);
  for (const id of taughtIds) {
    const cited = (shared[id].sources || []).some((x) => String(x.source).indexOf(BOOK) >= 0);
    assert.ok(cited, `${id} has taught content but does not cite the book it came from`);
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
