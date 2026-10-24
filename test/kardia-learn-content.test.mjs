import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LESSONS_DIR = join(ROOT, "kardia", "learn", "lessons");
const viewsDoc = JSON.parse(readFileSync(join(ROOT, "kardia", "views.json"), "utf8"));
const viewIds = new Set(viewsDoc.views.map(function (v) { return v.id; }));
const tteIds = viewsDoc.views.filter(function (v) { return v.id.indexOf("tte_") === 0; }).map(function (v) { return v.id; });

const files = readdirSync(LESSONS_DIR).filter(function (f) { return f.endsWith(".json"); });
const lessons = files.map(function (f) {
  return { file: f, doc: JSON.parse(readFileSync(join(LESSONS_DIR, f), "utf8")) };
});

const VALID_LEVELS = ["mbbs", "resident", "fellow", "sonographer"];
const ID_RE = /^(view|tte|pocus|tee|meas|dop|knob|path)_[a-z0-9_]+$/;
// Em dash, en dash, other unicode dashes, curly quotes. The hyphen minus is
// checked separately on prose fields only, since lesson ids carry hyphens.
const UNICODE_BAD = /[‐-―‘’“”]/;
const HYPHEN = /-/;
// Common American spellings that must use British forms in content.
const AMERICAN = ["color", "flavor", "behavior", "center", "optimize", "minimize",
  "maximize", "standardize", "normalize", "familiarize", "hemoglobin", "hemorrhage",
  "hematoma", "edema", "esophagus", "esophageal", "anesthesia", "fetus", "fetal",
  "diarrhea", "ischemia", "ischemic", "pediatric", "gynecology", "estrogen", "tumor",
  "utilize", "modeling", "labeling", "traveling", "checkup"]; // checkup must read follow up

function en(v) { return v && typeof v === "object" ? v.en : v; }
function proseOf(lesson, out) {
  // Engine schema prose: bilingual {en} fields. Ids and view refs are exempt.
  out.push(en(lesson.title)); out.push(en(lesson.idea)); out.push(en(lesson.remember));
  (lesson.objectives || []).forEach(function (s) { out.push(s); });
  if (lesson.why) (lesson.why.steps || []).forEach(function (x) { out.push(en(x)); });
  (lesson.spot || []).forEach(function (x) { out.push(en(x)); });
  (lesson.todo || []).forEach(function (x) { out.push(en(x)); });
  if (lesson.see) { out.push(en(lesson.see.alt)); out.push(en(lesson.see.caption)); }
  (lesson.check || []).forEach(function (q) {
    out.push(en(q.q));
    (q.o || []).forEach(function (x) { out.push(en(x)); });
    out.push(en(q.why));
  });
  (lesson.sources || []).forEach(function (s) { out.push(s); });
}

test("every lesson parses: 88 lessons covering every TTE view", function () {
  assert.equal(lessons.length, 88, "expected 88 lessons, found " + lessons.length);
  const covered = new Set(lessons.filter(function (l) { return l.doc.view; }).map(function (l) { return l.doc.view; }));
  const missing = tteIds.filter(function (id) { return !covered.has(id); });
  assert.deepEqual(missing, [], "TTE views without a lesson: " + missing.join(", "));
});

test("lesson ids are unique and carry an area prefix", function () {
  const ids = lessons.map(function (l) { return l.doc.id; });
  assert.equal(new Set(ids).size, ids.length, "duplicate lesson id found");
  for (const l of lessons) {
    assert.ok(ID_RE.test(l.doc.id), l.file + " bad id " + l.doc.id);
    assert.equal(l.doc.id + ".json", l.file, l.file + " id does not match file name");
  }
});

test("schema keys present with the engine Learn shape", function () {
  // The engine renderer (specialty-learn.js and specialty-data.js validateLesson)
  // uses title/idea/remember/see/why/spot/todo/check/test, a single engine level
  // and minutes. The old Tokos style body/questions shape is not rendered by it,
  // so this test follows the engine, and Kardia keeps its four level array in
  // levels alongside the engine level.
  for (const l of lessons) {
    const d = l.doc;
    assert.equal(typeof d.id, "string", l.file + " id");
    assert.ok(d.title && typeof d.title.en === "string" && d.title.en.trim(), l.file + " title");
    assert.ok(Array.isArray(d.levels) && d.levels.length > 0, l.file + " levels");
    assert.ok(d.level === "mbbs" || d.level === "resident", l.file + " engine level");
    assert.ok(typeof d.unit === "string" && d.unit, l.file + " unit");
    assert.ok(d.minutes > 0, l.file + " minutes");
    assert.ok(d.idea && d.idea.en && d.remember && d.remember.en, l.file + " idea and remember");
    assert.ok(d.see && (d.see.img || d.see.diagram), l.file + " see");
    assert.ok(d.why && Array.isArray(d.why.steps) && d.why.steps.length >= 1, l.file + " why");
    assert.ok(Array.isArray(d.spot) && d.spot.length >= 1, l.file + " spot");
    assert.ok(Array.isArray(d.todo) && d.todo.length >= 1, l.file + " todo");
    assert.ok(Array.isArray(d.check), l.file + " check");
    assert.ok(!("questions" in d), l.file + " questions must be converted to check");
    assert.ok(!("body" in d), l.file + " body must be converted to engine steps");
    assert.ok(d.test && d.test.mcqTopic, l.file + " test mcqTopic");
    assert.ok(Array.isArray(d.sources) && d.sources.length > 0, l.file + " sources");
    assert.ok(d.review && typeof d.review === "object", l.file + " review");
  }
});

test("levels valid and sources non empty with review ai drafted", function () {
  for (const l of lessons) {
    for (const lv of l.doc.levels) {
      assert.ok(VALID_LEVELS.indexOf(lv) >= 0, l.file + " bad level " + lv);
    }
    for (const s of l.doc.sources) {
      assert.ok(typeof s === "string" && s.trim(), l.file + " empty source");
    }
    assert.equal(l.doc.review.status, "ai_drafted", l.file + " review must be ai_drafted");
  }
});

test("self check questions: 3 to 5 per lesson under check with a valid answer", function () {
  for (const l of lessons) {
    const qs = l.doc.check;
    assert.ok(qs.length >= 3 && qs.length <= 5, l.file + " needs 3 to 5 questions");
    for (const q of qs) {
      assert.ok(q.q && typeof q.q.en === "string" && q.q.en.trim(), l.file + " question text");
      // Engine check options are a list of at least two; pathology lessons
      // were authored with three options, so three or four are accepted here.
      assert.ok(Array.isArray(q.o) && (q.o.length === 3 || q.o.length === 4), l.file + " needs 3 or 4 options");
      assert.ok(q.a === (q.a | 0) && q.a >= 0 && q.a < q.o.length, l.file + " bad answer index");
      assert.ok(q.why && typeof q.why.en === "string" && q.why.en.trim(), l.file + " explanation");
    }
  }
});

test("figure view ids exist in kardia views.json", function () {
  for (const l of lessons) {
    if (l.doc.see && l.doc.see.view) {
      assert.ok(viewIds.has(l.doc.see.view), l.file + " see view " + l.doc.see.view + " missing from views.json");
    }
    if (l.doc.view) {
      assert.ok(viewIds.has(l.doc.view), l.file + " lesson view " + l.doc.view + " missing from views.json");
    }
  }
});

test("no em or en dashes, no curly quotes, no hyphen minus in prose", function () {
  const bad = [];
  for (const l of lessons) {
    const strings = [];
    proseOf(l.doc, strings);
    strings.forEach(function (s) {
      if (typeof s !== "string") return;
      if (UNICODE_BAD.test(s) || HYPHEN.test(s)) bad.push(l.file + ": " + s.slice(0, 60));
    });
  }
  assert.deepEqual(bad.slice(0, 5), [], "banned character found: " + bad.slice(0, 5).join(" | "));
});

test("British spelling in lesson prose", function () {
  const bad = [];
  for (const l of lessons) {
    const strings = [];
    proseOf(l.doc, strings);
    const text = strings.join(" ").toLowerCase();
    for (const w of AMERICAN) {
      if (new RegExp("\\b" + w + "\\b").test(text)) bad.push(l.file + ": " + w);
    }
  }
  assert.deepEqual(bad, [], "American spelling found: " + bad.join(", "));
});

test("teaching order covers every lesson exactly once and the index follows it", function () {
  const order = JSON.parse(readFileSync(join(ROOT, "kardia", "learn", "order.json"), "utf8"));
  const index = JSON.parse(readFileSync(join(ROOT, "kardia", "learn", "index.json"), "utf8"));
  const files = lessons.map(function (l) { return l.doc.id; }).sort();
  const ordered = [];
  for (const u of index.units) {
    assert.ok(Array.isArray(order[u.id]), "order.json needs area " + u.id);
    ordered.push.apply(ordered, order[u.id]);
  }
  assert.equal(ordered.length, files.length, "order.json must list every lesson once");
  assert.equal(new Set(ordered).size, ordered.length, "order.json must not repeat a lesson");
  assert.deepEqual(ordered.slice().sort(), files, "order.json must cover every lesson file");
  for (const u of index.units) {
    assert.deepEqual(u.lessons, order[u.id], "index unit " + u.id + " must follow order.json");
  }
});

test("learn index lists every lesson under its area unit", function () {
  const index = JSON.parse(readFileSync(join(ROOT, "kardia", "learn", "index.json"), "utf8"));
  assert.equal(index.review, "ai_drafted", "index review must be ai_drafted");
  const indexed = Object.keys(index.lessons).sort();
  const files = lessons.map(function (l) { return l.doc.id; }).sort();
  assert.deepEqual(indexed, files, "index lessons do not match lesson files");
  const inUnits = [];
  for (const u of index.units) for (const lid of u.lessons) inUnits.push(lid);
  assert.deepEqual(inUnits.sort(), files, "unit lists do not cover all lessons");
});
