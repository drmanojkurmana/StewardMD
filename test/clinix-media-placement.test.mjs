/* CliniX: a video must appear ONLY on the skill it was chosen for.
 *
 * MERGE NOTE (2026-08-25): another session found and fixed this same bug independently, from a
 * Chronic liver disease case that opened "Chief complaints" and played "Respiratory History - OSCE
 * Tips". Both test files landed with this name. This is the union of the two: the checks below are
 * the broader set (audio as well as video, orphans, licence, one whole-exam video per system), plus
 * the three assertions that only their version made, kept at the end with their reasoning.
 *
 * Every media record carries `forSkill` — the one skill it was picked to illustrate. Nothing
 * enforced it, so "Respiratory History - OSCE Tips" was declared for the GENERIC
 * skill.hx.chief_complaints and therefore played inside every system's history section: a student
 * opening Abdomen was shown a respiratory history (owner report, 2026-08-25).
 *
 * That class of error is invisible in review — the video plays, it is a real video, it is simply
 * about the wrong thing. So it is asserted here instead:
 *   - every video is used on its declared forSkill and nowhere else;
 *   - every video declares one;
 *   - no video is orphaned (paid for in the licence audit, shown to nobody);
 *   - the system-agnostic core skills carry no system-specific media at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLINIX = join(ROOT, "clinix");

function jsonFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) jsonFiles(p, out);
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

const manifest = JSON.parse(readFileSync(join(CLINIX, "media/manifest.json"), "utf8")).media;
const videos = Object.fromEntries(Object.entries(manifest).filter(([k]) => k.startsWith("media.vid.")));
/* AUDIO TOO. The original version of this file only checked media.vid.*, which is exactly how a
 * stridor sound came to be attached to skill.gen.appearance - a CORE skill, so it played inside
 * every system's general examination (owner report, 2026-08-25). Placement is placement whatever
 * the medium. */
const sounds = Object.fromEntries(Object.entries(manifest).filter(([k]) => k.startsWith("media.snd.")));
const placeable = { ...videos, ...sounds };

/* skill id -> the video ids attached to it, across every content file. */
function skillMedia() {
  const map = new Map();
  for (const f of jsonFiles(CLINIX)) {
    if (f.includes(join("media", "manifest.json"))) continue;
    let data;
    try { data = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
    (function walk(o) {
      if (Array.isArray(o)) return o.forEach(walk);
      if (!o || typeof o !== "object") return;
      if (o.id && Array.isArray(o.media)) {
        const items = o.media.filter((m) => /^media\.(vid|snd)\./.test(String(m)));
        if (items.length) map.set(o.id, [...(map.get(o.id) || []), ...items]);
      }
      Object.values(o).forEach(walk);
    })(data);
  }
  return map;
}

test("the manifest actually contains videos (guards the whole file)", () => {
  assert.ok(Object.keys(videos).length > 20, `expected the video library, found ${Object.keys(videos).length}`);
});

test("every video AND every sound declares the ONE skill it was chosen for", () => {
  const missing = Object.entries(placeable).filter(([, v]) => !v.forSkill).map(([k]) => k);
  assert.deepEqual(missing, [], "media with no forSkill:\n  " + missing.join("\n  "));
});

test("a video is never shown on a skill other than its declared one", () => {
  // The actual bug: a respiratory history video declared for the generic chief-complaints skill.
  const used = skillMedia();
  const wrong = [];
  for (const [vid, rec] of Object.entries(placeable)) {
    for (const [skillId, list] of used) {
      if (list.includes(vid) && rec.forSkill !== skillId) {
        wrong.push(`${vid} is for ${rec.forSkill} but is shown on ${skillId}`);
      }
    }
  }
  assert.deepEqual(wrong, [], "misplaced videos:\n  " + wrong.join("\n  "));
});

test("no video is licensed and then shown to nobody", () => {
  const used = new Set([...skillMedia().values()].flat());
  const orphans = Object.keys(placeable).filter((v) => !used.has(v));
  assert.deepEqual(orphans, [], "orphaned videos:\n  " + orphans.join("\n  "));
});

test("the system-agnostic core skills carry no system-specific video", () => {
  /* core.json is rendered inside EVERY system, so anything system-specific there is wrong for at
   * least three of the four systems. This is the rule the respiratory-history video broke. */
  const core = JSON.parse(readFileSync(join(CLINIX, "skills/core.json"), "utf8"));
  const SYSTEM_WORDS = /respirat|lung|chest|cardiac|cardiovasc|heart|abdom|liver|spleen|neuro|cranial|cerebell/i;
  const offenders = [];
  (function walk(o) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== "object") return;
    if (o.id && Array.isArray(o.media)) {
      for (const m of o.media) {
        const rec = placeable[m];
        if (!rec) continue;
        // A sound has no title; its id and hint carry the meaning.
        const label = `${rec.title || ""} ${rec.caption || ""} ${m}`;
        if (SYSTEM_WORDS.test(label)) offenders.push(`${o.id} shows "${rec.title}"`);
      }
    }
    Object.values(o).forEach(walk);
  })(core);
  assert.deepEqual(offenders, [], "system-specific media on a core skill:\n  " + offenders.join("\n  "));
});

test("EVERY system demonstrates the whole examination, not just fragments", () => {
  /* Owner requirement, 2026-08-25: each system must carry one video showing how to examine the
   * patient end to end. Respiratory and abdomen had one; cardiovascular and neurology had only
   * component clips (JVP, a heave, a reflex), which teaches the pieces and never the sequence. */
  const WHOLE_EXAM = {
    "skills/respiratory.json": /examination/i,
    "skills/cardiovascular.json": /examination/i,
    "skills/abdomen.json": /examination/i,
    "skills/neurology.json": /examination/i
  };
  const missing = [];
  for (const [file, wants] of Object.entries(WHOLE_EXAM)) {
    const src = readFileSync(join(CLINIX, file), "utf8");
    const used = Object.entries(videos).filter(([id]) => src.includes(id));
    const hasWhole = used.some(([, v]) =>
      wants.test(String(v.title || "")) && /end to end|whole|full/i.test(String(v.caption || "")));
    if (!hasWhole) missing.push(`${basename(file)} has no end-to-end examination video (has: ${used.map(([, v]) => v.title).join("; ")})`);
  }
  assert.deepEqual(missing, [], "systems teaching only fragments:\n  " + missing.join("\n  "));
});

test("every video is embeddable and licence-cleared", () => {
  const bad = Object.entries(videos)
    .filter(([, v]) => v.cleared !== true || v.embeddable !== true || !v.attribution)
    .map(([k]) => k);
  assert.deepEqual(bad, [], "videos not cleared/embeddable/attributed:\n  " + bad.join("\n  "));
});

/* ── from the other session's version of this file, kept because they are not duplicates ────────
 * Their case was a Chronic liver disease pathway playing a respiratory history video on "Chief
 * complaints". Same root cause, found from the other end. */

test("every media id a skill references exists in the manifest", () => {
  /* A DANGLING reference is worse than a wrong one: the renderer is fail-soft, so a typo in a media
   * id shows the student nothing at all and logs no error. */
  const known = new Set(Object.keys(manifest));
  const dangling = [];
  for (const [skillId, ids] of skillMedia()) {
    for (const id of ids) if (!known.has(id)) dangling.push(`${skillId} -> ${id}`);
  }
  assert.deepEqual(dangling, [], "skills referencing media that is not in the manifest:\n  " + dangling.join("\n  "));
});

test("REGRESSION: the generic Chief complaints step carries no system-specific video", () => {
  // The exact skill the bug was found on, named so it cannot silently reappear.
  const core = JSON.parse(readFileSync(join(CLINIX, "skills/core.json"), "utf8")).skills;
  const cc = core["skill.hx.chief_complaints"];
  assert.ok(cc, "skill.hx.chief_complaints is missing");
  const vids = (cc.media || []).filter((m) => String(m).startsWith("media."));
  assert.deepEqual(vids, [],
    "Chief complaints is reused by every case; it must carry no media of its own");
});

test("the respiratory history video still has a correct home", () => {
  // Removing it from the generic step must not orphan it.
  const rec = manifest["media.vid.resphistory"];
  assert.ok(rec, "media.vid.resphistory vanished from the manifest");
  assert.equal(rec.forSkill, "skill.hx.resp.dyspnea",
    "its home is the respiratory history skill");
  const used = skillMedia();
  assert.ok([...used].some(([id, ids]) => id === "skill.hx.resp.dyspnea" && ids.includes("media.vid.resphistory")),
    "it must actually be shown on that skill");
});
