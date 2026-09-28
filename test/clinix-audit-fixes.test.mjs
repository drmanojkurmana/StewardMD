/* Regressions for the 2026-09-27 CliniX audit. Each test names the defect it pins. */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import M from "../clinix-model.js";
import S from "../clinix-store.js";
import T from "../clinix-tutor.js";
import F from "../clinix-flags.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));

/* ── mastery ───────────────────────────────────────────────────────────── */

test("mastery: a day with no CORRECT answer is not a second day of success", () => {
  let day = "2026-09-01";
  const st = S.__testStore({ today: () => day });
  for (let i = 0; i < 4; i++) st.record("skill.x", true);
  day = "2026-09-02";
  st.record("skill.x", null);   // seen in a Case, or a revealed answer
  assert.notEqual(st.mastery("skill.x").level, "mastered");
  st.record("skill.x", true);
  assert.equal(st.mastery("skill.x").level, "mastered");
});

test("store: a corrupt stored record or miss log is repaired, not thrown on", () => {
  const kv = { m: {}, get(k) { return this.m[k] ?? null; }, set(k, v) { this.m[k] = String(v); return true; }, del(k) { delete this.m[k]; return true; } };
  const st = S.__testStore({ kv, today: () => "2026-09-01" });
  // Write something shaped wrongly under the real keys, then use the store normally.
  for (const k of Object.keys(kv.m)) delete kv.m[k];
  st.record("skill.y", true);
  const keys = Object.keys(kv.m);
  const skillsKey = keys.find((k) => /skill/i.test(k)) || keys[0];
  const all = JSON.parse(kv.m[skillsKey]);
  for (const k of Object.keys(all)) all[k] = { seen: 1 };   // no `days`
  kv.m[skillsKey] = JSON.stringify(all);
  assert.doesNotThrow(() => st.record("skill.y", false));
  const logKey = Object.keys(kv.m).find((k) => k !== skillsKey && /log|miss/i.test(k));
  if (logKey) {
    kv.m[logKey] = JSON.stringify({ items: "garbage" });
    assert.doesNotThrow(() => st.record("skill.y", false));
  }
});

/* ── licence gate ──────────────────────────────────────────────────────── */

test("licence gate: a hosted image cannot ride in on inline:true", () => {
  const m = { id: "x", kind: "image", caption: "c", cleared: true, licence: "l", attribution: "a",
    inline: true, diagramId: "nope", src: "https://any.host/x.jpg" };
  assert.equal(M.mediaRenderable(m, {}), false);
  assert.equal(M.validateMedia(m).ok, false);
  const synth = { id: "y", kind: "image", caption: "c", cleared: true, licence: "l", attribution: "a",
    synth: true, audioKind: "wheeze", src: "https://any.host/y.jpg" };
  assert.equal(M.mediaRenderable(synth, {}), false);
});

test("licence gate: every shipped media entry still validates", () => {
  const media = json("clinix/media/manifest.json").media;
  for (const k of Object.keys(media)) assert.equal(M.validateMedia(media[k]).ok, true, k);
});

test("licence gate: atlas photos are not rendered without a licence record", () => {
  const src = read("clinix-screens.js");
  assert.match(src, /function atlasCleared\(/);
  assert.match(src, /if \(atlas && !atlasCleared\(atlas\)\) atlas = null;/);
  const D = read("clinix-diagrams.js");
  assert.equal((D.match(/ownerProduced: true/g) || []).length, 18, "all 18 owner-produced photos are recorded as such");
  assert.doesNotMatch(src, /Verified Bedside Photo/);
});

/* ── review gate ───────────────────────────────────────────────────────── */

test("review gate: no screen builds a pathway or lesson with a hard-coded allowDraft:true", () => {
  const src = read("clinix-screens.js");
  assert.doesNotMatch(src, /allowDraft:\s*true/);
  assert.doesNotMatch(src, /Draft, pending clinician review/, "owner 2026-09-28: no draft line on lessons");
});

test("review gate: draft content is never locked (owner 2026-09-27)", () => {
  const src = read("clinix-content.js");
  assert.match(src, /allowDraft: true,/);
  assert.equal(F.DEFS.smd_clinix_draft.def, true);
});

test("review gate: nothing claims clinician approval that was never given", () => {
  const cat = json("clinix/manifest.json");
  for (const p of cat.presentations || []) {
    assert.notEqual(M.reviewStatus(p), "approved", "catalog " + p.id);
    const file = json("clinix/" + p.file);
    assert.notEqual(M.reviewStatus(file), "approved", "file " + p.id);
    assert.equal(JSON.stringify(file).indexOf("Clinical Review Team"), -1);
  }
});

/* ── screens: the three crashes ────────────────────────────────────────── */

test("screens: flag() is defined in clinix-screens.js (six call sites use it)", () => {
  const src = read("clinix-screens.js");
  assert.match(src, /\n  function flag\(k\) \{/);
});

test("screens: M is never shadowed by a local var (M().pathwaySkillIds threw)", () => {
  assert.doesNotMatch(read("clinix-screens.js"), /var M = SMD_CLINIX_MODEL/);
});

test("screens: the pathway rail declares `done` before using it", () => {
  const src = read("clinix-screens.js");
  const i = src.indexOf("function renderDisease(");
  const body = src.slice(i, src.indexOf("\n  function ", i + 10));
  assert.ok(body.indexOf("var done = ") > 0 && body.indexOf("var done = ") < body.indexOf("(done ?"));
});

test("screens: the real-sound button reads the clicked element, not an undeclared one", () => {
  const src = read("clinix-screens.js");
  const i = src.indexOf('case "cx-watch-sound"');
  assert.match(src.slice(i, i + 300), /t\.getAttribute\("data-vid"\)/);
});

/* ── dose guard ────────────────────────────────────────────────────────── */

test("dose guard: catches shapes that used to slip through", () => {
  const doses = ["give 1g ceftriaxone", "magnesium 2g", "MgSO4 2g IV", "40 milligrams", "5 mgs", "10 mmol",
    "40 mEq", "2 L/min", "doxy 100 twice a day", "azithromycin 500 once daily for 3 days",
    "two puffs twice daily", "paracetamol q 4 h", "Clopidogrel 300-600 mg", "two tablets"];
  for (const d of doses) assert.equal(T.looksLikeDose(d), true, d);
});

test("dose guard: lab values and ordinary English are not doses", () => {
  const safe = ["Hb below 7 g/dL", "bilirubin 2.5 mg/dL", "sodium 130 mmol/L", "a gram-negative organism",
    "exacerbations twice a year", "an FEV1 of 1.2 L", "the 6 minute walk test", "a 2 cm liver"];
  for (const s of safe) assert.equal(T.looksLikeDose(s), false, s);
});

/* ── flags ─────────────────────────────────────────────────────────────── */

test("flags: a malformed query escape does not throw", () => {
  const prev = globalThis.location;
  try {
    Object.defineProperty(globalThis, "location", { value: { search: "?clinix=%E0" }, configurable: true });
    assert.doesNotThrow(() => F.bool("smd_clinix"));
  } finally {
    Object.defineProperty(globalThis, "location", { value: prev, configurable: true });
  }
});

test("flags: the generated case patient runs on its own endpoint (owner turned it on 2026-09-27)", () => {
  assert.equal(F.DEFS.smd_clinix_ai_patient.def, true);
  assert.match(read("clinix-tutor.js"), /SMD_AI.clinixPatient/);
  const srv = read("functions/api/ai/[[path]].js");
  assert.match(srv, /seg === "clinix-patient"/);
  assert.match(srv, /"clinix-patient": "clinix"/, "metered in the student bucket");
  assert.match(srv, /NEVER invent a symptom/);
  assert.match(read("clinix-screens.js"), /flag\("smd_clinix_ai_patient"\)/);
});

/* ── content wiring ────────────────────────────────────────────────────── */

test("content: every skill a presentation references exists in a pack", () => {
  const cat = json("clinix/manifest.json");
  const all = {};
  for (const p of cat.skillPacks) Object.assign(all, json("clinix/" + p.file).skills);
  for (const p of cat.presentations || []) {
    const ids = [...new Set(read("clinix/" + p.file).match(/skill\.[a-z0-9_.]+/g) || [])];
    for (const id of ids) assert.ok(all[id], p.id + " references missing " + id);
  }
});

test("content: every skill a disease pathway references is loadable from its system's packs", () => {
  const cat = json("clinix/manifest.json");
  for (const sys of cat.systems) {
    const av = {};
    for (const pid of sys.skillPacks) Object.assign(av, json("clinix/" + cat.skillPacks.find((x) => x.id === pid).file).skills);
    for (const d of sys.diseases) {
      const j = json("clinix/" + d.file);
      const local = Object.assign({}, av, j.skills || {});
      const ids = [...new Set(JSON.stringify(j.chapters || []).match(/skill\.[a-z0-9_.]+/g) || [])];
      for (const id of ids) assert.ok(local[id], d.id + " misses " + id);
    }
  }
});

test("content: no em-dash in presentation text", () => {
  const cat = json("clinix/manifest.json");
  for (const p of cat.presentations || []) assert.equal(read("clinix/" + p.file).indexOf("—"), -1, p.id);
});
