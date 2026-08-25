/* test/clinix-media-placement.test.mjs — the right video on the right step.
 *
 * Reported: a Chronic liver disease case opened "Chief complaints" and played "Respiratory History -
 * OSCE Tips". Cause: clinix/skills/core.json attached media.vid.resphistory to skill.hx.chief_complaints,
 * a SYSTEM-AGNOSTIC skill every case reuses — so one system's video played on every case in the app.
 * The same video was already correctly attached to skill.hx.resp.dyspnea, so it was a stray duplicate.
 *
 * Three invariants, checked across every skill file, so the next mis-placement fails here and not on
 * a doctor's phone:
 *   1. Every media id a skill references exists in the manifest.
 *   2. A manifest entry's `forSkill` matches a skill that actually uses it (the metadata that made
 *      this mistake look correct said "chief_complaints").
 *   3. System-specific media may sit on a system-agnostic skill ONLY if that skill's own teaching text
 *      mentions the sign. (Stridor on "General appearance" is legitimate — the text says "audible
 *      wheeze or stridor". A respiratory history video on "Chief complaints" is not.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../clinix/", import.meta.url);
const MEDIA = JSON.parse(readFileSync(new URL("media/manifest.json", root), "utf8")).media;
const SKILL_FILES = readdirSync(new URL("skills/", root)).filter((f) => f.endsWith(".json"));

// Every skill node that carries media, with the file it came from and its full text.
const skills = [];
for (const f of SKILL_FILES) {
  const json = JSON.parse(readFileSync(new URL("skills/" + f, root), "utf8"));
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (o.id && Array.isArray(o.media)) skills.push({ file: f, id: o.id, media: o.media, text: JSON.stringify(o) });
    Object.values(o).forEach(walk);
  })(json);
}

// A skill reused by every case regardless of system: approach, general exam, and the generic history
// blocks. These are the ones where a system-specific asset leaks into unrelated cases.
const isSystemAgnostic = (id) =>
  /^skill\.(approach|gen)\./.test(id) ||
  /^skill\.hx\.(chief_complaints|systemic|past|drug|family|social|personal)/.test(id);

// Individual terms, not one regex per system. The exemption below compares the SAME term, because a
// coarser check excused the original bug: "Chief complaints" happens to say "breath sounds" in a
// pitfall, which is not permission to play a respiratory HISTORY video on a liver case.
const SYSTEM_TERMS = [
  ["respiratory", /respirator/i], ["respiratory", /pulmonar/i], ["respiratory", /stridor/i],
  ["respiratory", /wheez/i], ["respiratory", /spirometr/i], ["respiratory", /breath sounds?/i],
  ["cardiac", /cardiac/i], ["cardiac", /\bjvp\b/i], ["cardiac", /murmur/i], ["cardiac", /precordi/i],
  ["neurological", /cranial nerve/i], ["neurological", /\bgait\b/i], ["neurological", /stroke/i],
  ["neurological", /\bgcs\b/i], ["neurological", /pupil/i],
  ["abdominal", /ascites/i], ["abdominal", /hepat/i], ["abdominal", /splenic/i],
];

test("every media id a skill references exists in the manifest", () => {
  for (const s of skills) {
    for (const id of s.media) {
      assert.ok(MEDIA[id], `${s.file} → ${s.id} references ${id}, which is not in media/manifest.json`);
    }
  }
});

test("a manifest entry's forSkill matches a skill that actually uses it", () => {
  const usedBy = new Map();
  for (const s of skills) for (const id of s.media) usedBy.set(id, [...(usedBy.get(id) || []), s.id]);
  for (const [id, m] of Object.entries(MEDIA)) {
    if (!m.forSkill || !usedBy.has(id)) continue;
    assert.ok(usedBy.get(id).includes(m.forSkill),
      `${id} declares forSkill "${m.forSkill}" but is attached to ${usedBy.get(id).join(", ")} — this drift is what made the liver/respiratory mix-up look correct`);
  }
});

test("system-specific media never plays on a step every case reuses", () => {
  const offenders = [];
  for (const s of skills) {
    if (!isSystemAgnostic(s.id)) continue;
    for (const id of s.media) {
      const m = MEDIA[id] || {};
      const label = (m.title || "") + " " + (m.caption || "");
      for (const [system, re] of SYSTEM_TERMS) {
        if (!re.test(label)) continue;
        // Allowed only when the skill teaches THAT SAME sign — stridor on "General appearance" passes
        // because its steps say "audible wheeze or stridor".
        if (re.test(s.text)) continue;
        offenders.push(`${s.file} → ${s.id} plays ${system} media "${label.trim()}" (${id}) on a step every case reuses`);
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("REGRESSION: the generic Chief complaints step carries no system-specific video", () => {
  const cc = skills.find((s) => s.id === "skill.hx.chief_complaints");
  assert.ok(cc, "skill.hx.chief_complaints exists");
  assert.ok(!cc.media.includes("media.vid.resphistory"),
    "a respiratory history video here plays on liver, cardiac and every other case");
});

test("the respiratory history video still has a correct home", () => {
  const home = skills.filter((s) => s.media.includes("media.vid.resphistory")).map((s) => s.id);
  assert.deepEqual(home, ["skill.hx.resp.dyspnea"], "it belongs on the breathlessness skill, and nowhere else");
});
