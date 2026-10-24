import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const viewsDoc = JSON.parse(readFileSync(join(ROOT, "kardia", "views.json"), "utf8"));
const pathDoc = JSON.parse(readFileSync(join(ROOT, "kardia", "pathology", "catalogue.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(ROOT, "atlas", "3d", "manifest.json"), "utf8"));

const manifestIds = new Set(manifest.parts.map(function (p) { return p[0]; }));
const parametricIds = new Set(viewsDoc.parametricStructures.map(function (s) { return s.id; }));

const VALID_MODALITIES = ["tte", "tee", "pocus"];
const VALID_WINDOWS = ["parasternal", "apical", "subcostal", "suprasternal", "oesophageal", "gastric", "abdominal", "lung"];
const VALID_LEVELS = ["mbbs", "resident", "fellow", "sonographer"];
const DASH = /[-\u2013\u2014]/;

function textOf(value, out) {
  if (typeof value === "string") { out.push(value); return; }
  if (Array.isArray(value)) { value.forEach(function (v) { textOf(v, out); }); return; }
  if (value && typeof value === "object") { Object.values(value).forEach(function (v) { textOf(v, out); }); }
}

test("views file carries ai drafted review status", function () {
  assert.equal(viewsDoc.review && viewsDoc.review.status, "ai_drafted");
});

test("pathology file carries ai drafted review status", function () {
  assert.equal(pathDoc.review && pathDoc.review.status, "ai_drafted");
});

test("view ids are unique", function () {
  const ids = viewsDoc.views.map(function (v) { return v.id; });
  assert.equal(new Set(ids).size, ids.length, "duplicate view id found");
});

test("condition ids are unique", function () {
  const ids = pathDoc.conditions.map(function (c) { return c.id; });
  assert.equal(new Set(ids).size, ids.length, "duplicate condition id found");
});

test("every view has valid modality window and levels", function () {
  for (const v of viewsDoc.views) {
    assert.ok(VALID_MODALITIES.includes(v.modality), v.id + " bad modality " + v.modality);
    assert.ok(VALID_WINDOWS.includes(v.window), v.id + " bad window " + v.window);
    assert.ok(Array.isArray(v.level) && v.level.length > 0, v.id + " needs at least one level");
    for (const l of v.level) {
      assert.ok(VALID_LEVELS.includes(l), v.id + " bad level " + l);
    }
  }
});

test("every landmark ref exists in the BodyParts3D manifest or the parametric list", function () {
  const missing = [];
  for (const v of viewsDoc.views) {
    for (const lm of v.landmarks) {
      if (!manifestIds.has(lm.ref) && !parametricIds.has(lm.ref)) {
        missing.push(v.id + " -> " + lm.ref);
      }
    }
  }
  assert.deepEqual(missing, [], "unknown landmark refs: " + missing.join(", "));
});

test("parametric list covers every non manifest ref", function () {
  const used = new Set();
  for (const v of viewsDoc.views) {
    for (const lm of v.landmarks) {
      if (!manifestIds.has(lm.ref)) { used.add(lm.ref); }
    }
  }
  for (const ref of used) {
    assert.ok(parametricIds.has(ref), "parametric structure missing for " + ref);
  }
});

test("tolerances are positive numbers", function () {
  for (const v of viewsDoc.views) {
    assert.equal(typeof v.tolerance.distanceMm, "number", v.id);
    assert.equal(typeof v.tolerance.angleDeg, "number", v.id);
    assert.ok(v.tolerance.distanceMm > 0, v.id + " distance must be positive");
    assert.ok(v.tolerance.angleDeg > 0, v.id + " angle must be positive");
  }
});

test("probe vectors are unit length and perpendicular", function () {
  for (const v of viewsDoc.views) {
    const n = v.probe.normal;
    const u = v.probe.up;
    assert.equal(n.length, 3, v.id + " normal needs 3 components");
    assert.equal(u.length, 3, v.id + " up needs 3 components");
    const nn = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    const uu = Math.sqrt(u[0] * u[0] + u[1] * u[1] + u[2] * u[2]);
    const dot = n[0] * u[0] + n[1] * u[1] + n[2] * u[2];
    assert.ok(Math.abs(nn - 1) < 0.05, v.id + " normal not unit");
    assert.ok(Math.abs(uu - 1) < 0.05, v.id + " up not unit");
    assert.ok(Math.abs(dot) < 0.05, v.id + " normal and up not perpendicular");
  }
});

test("no dash characters in catalogue text", function () {
  for (const doc of [viewsDoc, pathDoc]) {
    const strings = [];
    textOf(doc, strings);
    const bad = strings.filter(function (s) { return DASH.test(s); });
    assert.deepEqual(bad.slice(0, 3), [], "dash found: " + bad.slice(0, 3).join(" | "));
  }
});

test("every condition has echo ecg sound parameters and graded thresholds", function () {
  for (const c of pathDoc.conditions) {
    assert.ok(c.echo_findings.length >= 3, c.id + " needs echo findings");
    assert.ok(c.ecg_changes.length >= 2, c.id + " needs ecg changes");
    assert.ok(c.heart_sounds.length >= 2, c.id + " needs heart sounds");
    assert.ok(c.model_parameters.length >= 3, c.id + " needs model parameters");
    assert.ok(c.severity_grades.length >= 3, c.id + " needs severity grades");
    for (const g of c.severity_grades) {
      assert.ok(g.grade && g.criteria && g.source, c.id + " grade needs grade criteria source");
    }
  }
});

test("expected view counts per modality", function () {
  const count = function (m) { return viewsDoc.views.filter(function (v) { return v.modality === m; }).length; };
  assert.equal(count("tte"), 25, "expected 25 TTE views");
  assert.equal(count("tee"), 8, "expected 8 TEE views");
  assert.equal(count("pocus"), 10, "expected 10 POCUS views");
});

test("expected condition count", function () {
  assert.equal(pathDoc.conditions.length, 20, "expected 20 conditions");
});
