/* test/kardia-cases.test.mjs - Kardia WP11 whole patient cases (kardia/cases/*.json).
 *
 * Each case runs history, examination with heart sounds, ECG, echo
 * acquisition and measurement, a structured report, then diagnosis and
 * management, with lessons and sources and ai_drafted review status.
 * Truth values in echo measures must match the KARDIA_HEART model output
 * for that pathology preset wherever the model computes the metric; only
 * metrics outside the model (defect size, effusion depth, flap anatomy,
 * vegetation size) may carry non computed truths with a unit and tolerance.
 * British spelling, no dash characters in any case string.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const H = require("../kardia-sim-heart.js");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CASE_DIR = join(ROOT, "kardia", "cases");
const PATH_DIR = join(ROOT, "kardia", "pathology");
const viewsDoc = JSON.parse(readFileSync(join(ROOT, "kardia", "views.json"), "utf8"));
const learnIndex = JSON.parse(readFileSync(join(ROOT, "kardia", "learn", "index.json"), "utf8"));
const catalogue = JSON.parse(readFileSync(join(PATH_DIR, "catalogue.json"), "utf8"));

const viewIds = new Set(viewsDoc.views.map(function (v) { return v.id; }));
const lessonIds = new Set(Object.keys(learnIndex.lessons));
const conditionIds = new Set(catalogue.conditions.map(function (c) { return c.id; }));
const EXPECTED_LEVELS = { mbbs: 8, resident: 10, fellow: 7, sonographer: 5 };
const VALID_LEVELS = Object.keys(EXPECTED_LEVELS);

const pathDocs = {};
for (const f of readdirSync(PATH_DIR)) {
  if (!f.endsWith(".json") || f === "catalogue.json") continue;
  const doc = JSON.parse(readFileSync(join(PATH_DIR, f), "utf8"));
  pathDocs[doc.id] = doc;
}

/* Model computable metrics: case measure.what -> summary field. */
const METRICS = {
  lvef: "EF",
  edv: "LVEDV",
  esv: "LVESV",
  forward_sv: "forwardSV",
  lvot_vti: "LVOTVTI",
  regurgitant_volume: "regurgitantVolumeMl",
  peak_velocity: "peakAorticVelocity",
  peak_gradient: "peakAorticGradient",
  rv_systolic: "peakRVPressure",
  mean_la: "meanLAPressure"
};

const DASH = /[-\u2013\u2014]/;
const AMERICAN = ["edema", "hemoglobin", "hemorrhage", "ischemic", "ischemia",
  "anemia", "pediatric", "fetus", "fetal", "esophagus", "diarrhea", "tumor",
  "tumors", "behavior", "center", "customize", "maximize", "minimize",
  "optimize", "organize", "counseling", "fulfill", "enrollment",
  "aging", "traveled", "program", "checkup", "labored"];

function stringsOf(value, out) {
  if (typeof value === "string") { out.push(value); return; }
  if (Array.isArray(value)) { value.forEach(function (v) { stringsOf(v, out); }); return; }
  if (value && typeof value === "object") { Object.keys(value).forEach(function (k) { stringsOf(value[k], out); }); }
}

function loadCases() {
  return readdirSync(CASE_DIR).filter(function (f) { return f.endsWith(".json") && f !== "index.json"; }).map(function (f) {
    const doc = JSON.parse(readFileSync(join(CASE_DIR, f), "utf8"));
    return { file: f, doc: doc };
  });
}

function runModel(heart) {
  const h = H.create(heart);
  const hr = heart.heartRateBpm || 70;
  const totalMs = Math.round(12 * (60000 / hr));
  for (let t = 0; t < totalMs; t += 1) h.step(1);
  return h.summary();
}

const cases = loadCases();
const byLevel = {};
const byPathology = {};
for (const c of cases) {
  byLevel[c.doc.level] = (byLevel[c.doc.level] || 0) + 1;
  const p = c.doc.pathology && c.doc.pathology.id;
  byPathology[p] = (byPathology[p] || 0) + 1;
}

test("thirty cases parse with unique ids matching file names", function () {
  assert.equal(cases.length, 30, "expected 30 cases, found " + cases.length);
  const ids = cases.map(function (c) { return c.doc.id; });
  assert.equal(new Set(ids).size, ids.length, "duplicate case id found");
  for (const c of cases) {
    assert.equal(c.doc.id + ".json", c.file, c.file + " id must match file name");
  }
});

test("level mix is 8 MBBS, 10 resident, 7 fellow, 5 sonographer", function () {
  for (const level of VALID_LEVELS) {
    assert.equal(byLevel[level] || 0, EXPECTED_LEVELS[level],
      level + " needs " + EXPECTED_LEVELS[level] + " cases");
  }
});

test("every case reviews ai_drafted with valid pathology and severity", function () {
  for (const c of cases) {
    assert.equal(c.doc.review && c.doc.review.status, "ai_drafted", c.file + " review must be ai_drafted");
    const p = c.doc.pathology;
    assert.ok(p && conditionIds.has(p.id), c.file + " unknown pathology id");
    assert.ok(pathDocs[p.id], c.file + " pathology file missing for " + p.id);
    assert.ok(pathDocs[p.id].severities[p.severity], c.file + " unknown severity " + p.severity);
  }
});

test("all twenty pathologies appear across the thirty cases", function () {
  assert.equal(Object.keys(byPathology).length, 20,
    "expected 20 pathologies, found " + Object.keys(byPathology).join(", "));
});

test("echo views and lessons exist", function () {
  for (const c of cases) {
    assert.ok(Array.isArray(c.doc.echoTasks) && c.doc.echoTasks.length > 0, c.file + " needs echo tasks");
    for (const t of c.doc.echoTasks) {
      assert.ok(viewIds.has(t.view), c.file + " unknown view " + t.view);
      assert.ok(typeof t.find === "string" && t.find.length > 0, c.file + " task needs a find string");
      if (t.measure !== null && t.measure !== undefined) {
        assert.ok(typeof t.measure.truth === "number" && typeof t.measure.tolerance === "number",
          c.file + " measure needs numeric truth and tolerance");
        assert.ok(typeof t.measure.unit === "string" && typeof t.measure.what === "string",
          c.file + " measure needs what and unit strings");
      }
    }
    assert.ok(Array.isArray(c.doc.lessons) && c.doc.lessons.length > 0, c.file + " needs lessons");
    for (const l of c.doc.lessons) {
      assert.ok(lessonIds.has(l), c.file + " unknown lesson " + l);
    }
  }
});

test("vitals and ECG numbers are numeric and plausible", function () {
  for (const c of cases) {
    const v = c.doc.vitals;
    for (const k of ["hr", "sbp", "dbp", "rr", "spo2", "tempC"]) {
      assert.ok(typeof v[k] === "number" && isFinite(v[k]), c.file + " vitals." + k + " must be numeric");
    }
    assert.ok(v.hb === undefined, c.file + " unexpected vitals key");
    assert.ok(v.hr >= 20 && v.hr <= 250, c.file + " hr out of range");
    assert.ok(v.sbp >= 40 && v.sbp <= 300, c.file + " sbp out of range");
    assert.ok(v.dbp >= 20 && v.dbp <= 200, c.file + " dbp out of range");
    assert.ok(v.rr >= 8 && v.rr <= 80, c.file + " rr out of range");
    assert.ok(v.spo2 >= 50 && v.spo2 <= 100, c.file + " spo2 out of range");
    assert.ok(v.tempC >= 30 && v.tempC <= 43, c.file + " tempC out of range");
    assert.ok(v.sbp > v.dbp, c.file + " sbp must exceed dbp");
    const e = c.doc.ecg;
    assert.ok(typeof e.rate === "number" && isFinite(e.rate), c.file + " ecg.rate must be numeric");
    assert.ok(typeof e.rhythm === "string" && e.rhythm.length > 0, c.file + " needs ecg rhythm");
    assert.ok(typeof e.axis === "string" && e.axis.length > 0, c.file + " needs ecg axis");
    assert.ok(Array.isArray(e.findings) && e.findings.length > 0, c.file + " needs ecg findings");
  }
});

test("measure truths match the model output wherever computable", function () {
  const checked = [];
  for (const c of cases) {
    const heart = pathDocs[c.doc.pathology.id].severities[c.doc.pathology.severity].heart;
    const s = runModel(heart);
    for (const t of c.doc.echoTasks) {
      const m = t.measure;
      if (m === null || m === undefined) continue;
      const field = METRICS[m.what];
      if (!field) continue;
      const actual = s[field];
      assert.ok(typeof actual === "number" && isFinite(actual), c.file + " model gives no " + m.what);
      assert.ok(Math.abs(m.truth - actual) <= m.tolerance,
        c.file + " " + m.what + ": truth " + m.truth + " vs model " + actual.toFixed(2));
      checked.push(c.file + " " + m.what);
    }
  }
  assert.ok(checked.length >= 20, "expected at least 20 model checked truths, got " + checked.length);
});

test("case shape is complete with report, diagnosis and management", function () {
  for (const c of cases) {
    const d = c.doc;
    assert.ok(typeof d.title === "string" && d.title.length > 0, c.file + " needs title");
    assert.ok(typeof d.stem === "string" && d.stem.length > 0, c.file + " needs stem");
    assert.ok(Array.isArray(d.history) && d.history.length >= 4, c.file + " needs history pairs");
    for (const h of d.history) {
      assert.ok(h.q && h.a, c.file + " history pair needs q and a");
    }
    assert.ok(d.exam && d.exam.general && d.exam.pulse && d.exam.jvp && d.exam.precordium, c.file + " needs exam blocks");
    assert.ok(d.exam.auscultation && d.exam.auscultation.s1 && d.exam.auscultation.s2, c.file + " needs heart sounds");
    assert.ok(d.report && Array.isArray(d.report.required) && d.report.required.length >= 2, c.file + " needs report fields");
    for (const r of d.report.required) {
      assert.ok(r.field && r.answer && Array.isArray(r.accept) && r.accept.length > 0, c.file + " bad report field");
    }
    assert.ok(d.diagnosis && d.diagnosis.answer && Array.isArray(d.diagnosis.accept) && d.diagnosis.accept.length > 0,
      c.file + " needs diagnosis with accept list");
    assert.ok(d.management && d.management.model && Array.isArray(d.management.keyPoints) && d.management.keyPoints.length >= 3,
      c.file + " needs management model and key points");
    assert.ok(Array.isArray(d.teaching) && d.teaching.length >= 2, c.file + " needs teaching points");
    assert.ok(Array.isArray(d.sources) && d.sources.length > 0, c.file + " needs sources");
  }
});

test("accept lists hold full synonyms, never substrings of other diagnoses", function () {
  const answers = cases.map(function (c) { return c.doc.diagnosis.answer.toLowerCase(); });
  for (const c of cases) {
    for (const a of c.doc.diagnosis.accept) {
      assert.ok(a.length > 6, c.file + " accept entry too short: " + a);
      for (let i = 0; i < answers.length; i += 1) {
        if (answers[i] === c.doc.diagnosis.answer.toLowerCase()) continue;
        assert.ok(answers[i].indexOf(a.toLowerCase()) < 0,
          c.file + " accept '" + a + "' is a substring of another diagnosis");
      }
    }
  }
});

test("no dash characters and British spelling in every case string", function () {
  const bad = [];
  const spell = [];
  for (const c of cases) {
    const out = [];
    stringsOf(c.doc, out);
    for (const s of out) {
      if (DASH.test(s)) bad.push(c.file + ": " + s.slice(0, 60));
      const low = s.toLowerCase();
      for (const w of AMERICAN) {
        if (new RegExp("\\b" + w + "\\b").test(low)) spell.push(c.file + ": " + w);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], "dash found: " + bad.slice(0, 5).join(" | "));
  assert.deepEqual(spell.slice(0, 5), [], "American spelling found: " + spell.slice(0, 5).join(", "));
});

/* Allowed echo view per measured quantity: a measurement must sit in a
view where that measurement is actually taken. LVEF by Simpson lives in
the apical four and two chamber views, MVA planimetry in PSAX MV, LVOT
diameter in PLAX, LVOT VTI and aortic continuous wave in apical five
chamber, TAPSE in apical four, and IVC in subcostal views. */
const MEASURE_VIEWS = {
  lvef: ["tte_a4c", "tte_a2c"],
  edv: ["tte_a4c", "tte_a2c"],
  esv: ["tte_a4c", "tte_a2c"],
  forward_sv: ["tte_a4c", "tte_a2c", "tte_a5c", "tte_plax"],
  lvot_vti: ["tte_a5c"],
  peak_velocity: ["tte_a5c"],
  peak_gradient: ["tte_a5c"],
  regurgitant_volume: ["tte_a4c", "tte_a5c"],
  rv_systolic: ["tte_a4c_rv_focus"],
  mean_la: ["tte_a4c", "tte_a5c"]
};

function diagnosisWords(answer) {
  const stop = {
    with: 1, without: 1, after: 1, from: 1, before: 1,
    under: 1, over: 1, needing: 1, rheumatic: 1
  };
  return String(answer).toLowerCase().split(/[^a-z]+/).filter(function (w) {
    return w.length >= 4 && !stop[w];
  });
}

function alphaTokens(s) {
  return String(s).toLowerCase().split(/[^a-z]+/).filter(function (w) { return w.length > 0; });
}

test("stems and history answers hide measurements and diagnosis words", function () {
  const NUM_UNIT = /\d[^.]*?\b(sq\s*cm|cm|mmhg|mm|m\s*per\s*s|m\/s|ml|percent|%)\b/i;
  for (const c of cases) {
    const words = diagnosisWords(c.doc.diagnosis.answer);
    const texts = [c.doc.stem].concat(c.doc.history.map(function (h) { return h.a; }));
    texts.forEach(function (t, i) {
      const where = i === 0 ? "stem" : "history answer " + i;
      assert.ok(!NUM_UNIT.test(String(t)),
        c.file + " " + where + " leaks a measurement: " + String(t).slice(0, 80));
      const low = " " + String(t).toLowerCase().replace(/[^a-z]+/g, " ") + " ";
      for (const w of words) {
        assert.ok(low.indexOf(" " + w + " ") < 0,
          c.file + " " + where + " leaks diagnosis word '" + w + "'");
      }
    });
  }
});

test("every diagnosis accept list contains a short core phrase", function () {
  for (const c of cases) {
    const ok = c.doc.diagnosis.accept.some(function (a) {
      return String(a).trim().split(/\s+/).length <= 3;
    });
    assert.ok(ok, c.file + " diagnosis needs an accept phrase of at most 3 words");
  }
});

test("measured quantity matches an allowed view list per quantity", function () {
  for (const c of cases) {
    for (const t of c.doc.echoTasks) {
      if (t.measure === null || t.measure === undefined) continue;
      const allowed = MEASURE_VIEWS[t.measure.what];
      assert.ok(allowed, c.file + " unknown measured quantity " + t.measure.what);
      assert.ok(allowed.indexOf(t.view) >= 0,
        c.file + " " + t.measure.what + " is not measured in " + t.view);
    }
  }
});

test("diagnosis carries no grade word and severity lives in the report", function () {
  const GRADE = /\b(mild|moderate|severe)\b/i;
  for (const c of cases) {
    const dx = c.doc.diagnosis;
    const texts = [dx.answer].concat(dx.accept);
    for (const t of texts) {
      assert.ok(!GRADE.test(String(t)), c.file + " grade word in diagnosis: " + t);
    }
    const sev = (c.doc.report.required || []).filter(function (r) {
      return String(r.field).toLowerCase().indexOf("severity") >= 0;
    });
    assert.ok(sev.length === 1, c.file + " needs exactly one Severity report field");
    const grade = String(c.doc.pathology.severity).toLowerCase();
    const covered = sev.some(function (r) {
      return ([r.answer].concat(r.accept || [])).join(" ").toLowerCase().indexOf(grade) >= 0;
    });
    assert.ok(covered, c.file + " Severity field must carry grade " + grade);
  }
});

test("no accept phrase is a token subset of another pathology diagnosis", function () {
  for (const c of cases) {
    const pid = c.doc.pathology.id;
    for (const a of c.doc.diagnosis.accept) {
      const needles = alphaTokens(a);
      if (!needles.length) continue;
      for (const o of cases) {
        if (o.doc.pathology.id === pid) continue;
        const hay = alphaTokens(o.doc.diagnosis.answer);
        const subset = needles.every(function (w) { return hay.indexOf(w) >= 0; });
        assert.ok(!subset,
          c.file + " accept '" + a + "' is a token subset of " + o.file + " diagnosis");
      }
    }
  }
});
