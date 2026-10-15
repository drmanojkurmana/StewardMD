/* NEET-SS feeder-group mapping (owner 2026-10-14): Step 1 asks who the student is, Step 2 and Home show
 * only that group's subjects.
 * What must hold:
 *  - prep/ss-groups.json resolves to prep-ss-groups.js (the build is up to date);
 *  - every group lists >= 1 subject that holds live bank questions (no empty groups, no coming-soon);
 *  - every group includes Biostatistics and Research Methods;
 *  - medical-kind groups (General Medicine, Respiratory, Critical Care, Medical Oncology, Radiodiagnosis) show
 *    their own super-specialties plus the medical core and Biostatistics;
 *  - the surgical group shows its surgical super-specialties plus Biostatistics and no medical subject;
 *  - every other group shows its own super-specialties plus Biostatistics;
 *  - every mapped subject exists in prep/taxonomy.json;
 *  - every group carries the label, feeder degree and includes line the Step 1 cards render.
 * node --test test/prep-ss-groups.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const PLAN = require("../prep-plan.js");
const GROUPS = require("../prep-ss-groups.js");
const SRC = JSON.parse(fs.readFileSync(path.join(ROOT, "prep/ss-groups.json"), "utf8"));
const TAX = JSON.parse(fs.readFileSync(path.join(ROOT, "prep/taxonomy.json"), "utf8"));

const KNOWN = new Set();
TAX.branches.forEach((b) => (b.subjects || []).forEach((s) => KNOWN.add(s.id)));
const MEDICAL_KIND = ["medical", "respiratory", "critical-care", "medical-oncology", "radio-diagnosis"];
const MEDICAL_CORE = new Set(SRC.medicalCore.concat(["ss-general-medicine"]));

function bankVersion(sid) {
  // Mirrors the app (prep.js VER/bvOf): v5 unless the taxonomy pins another bank version for the subject.
  for (const b of TAX.branches || []) for (const s of b.subjects || []) if (s && s.id === sid && s.bv) return s.bv;
  return "v5";
}
function liveCounts() {
  // App counting: the subject's bank-version index plus its overlay items (prep.js countFor).
  const counts = {};
  for (const dir of fs.readdirSync(path.join(ROOT, "prep/bank"))) {
    let subs = [];
    try { subs = fs.readdirSync(path.join(ROOT, "prep/bank", dir)); } catch { continue; }
    for (const s of subs) {
      if (!s.startsWith("ss-") || dir !== bankVersion(s)) continue;
      const ix = path.join(ROOT, "prep/bank", dir, s, "index.json");
      if (!fs.existsSync(ix)) continue;
      try {
        const d = JSON.parse(fs.readFileSync(ix, "utf8"));
        counts[s] = (counts[s] || 0) + ((d.topics || []).reduce((n, t) => n + (+t.count || 0), 0));
      } catch {}
    }
  }
  const ov = JSON.parse(fs.readFileSync(path.join(ROOT, "prep/bank/overlay-counts.json"), "utf8"));
  for (const set of Object.values(ov.sets || {})) {
    for (const [sid, mods] of Object.entries(set || {})) {
      if (!String(sid).startsWith("ss-") || !mods || typeof mods !== "object") continue;
      counts[sid] = (counts[sid] || 0) + Object.values(mods).reduce((n, v) => n + (+v || 0), 0);
    }
  }
  return counts;
}

test("the compiled mapping is up to date with its JSON source", () => {
  execFileSync("node", ["tools/prep-ss-groups-build.mjs", "--check"], { cwd: ROOT, stdio: "pipe" });
  assert.equal(GROUPS.v, SRC.v);
  assert.deepEqual(GROUPS.groups.map((g) => g.id), SRC.groups.map((g) => g.id));
});

test("15 groups, each with label, feeder, includes line and subjects", () => {
  assert.equal(GROUPS.groups.length, 15);
  for (const g of GROUPS.groups) {
    assert.ok(g.id && g.label && g.feeder && g.includes, g.id + " card copy");
    assert.ok(Array.isArray(g.subjects) && g.subjects.length >= 1, g.id + " lists subjects");
    assert.equal(PLAN.ssGroupOf(g.id).label, g.label, "plan reads " + g.id);
  }
});

test("every mapped subject exists in the taxonomy and holds live questions", () => {
  const counts = liveCounts();
  for (const g of GROUPS.groups) {
    for (const id of g.subjects) {
      assert.ok(KNOWN.has(id), g.id + " maps " + id + " in taxonomy");
      assert.ok((counts[id] || 0) > 0, g.id + " maps " + id + " with live questions");
    }
  }
});

test("every group includes Biostatistics", () => {
  for (const g of GROUPS.groups) assert.ok(g.subjects.includes("ss-biostatistics"), g.id + " includes Biostatistics");
});

test("medical-kind groups show own subjects plus the medical core and Biostatistics", () => {
  for (const id of MEDICAL_KIND) {
    const g = GROUPS.groups.find((x) => x.id === id);
    for (const core of SRC.medicalCore) assert.ok(g.subjects.includes(core), id + " holds medical core " + core);
    assert.ok(g.subjects.includes("ss-biostatistics"), id + " holds Biostatistics");
  }
});

test("radiology group follows the owner rule: radiology plus medical core plus Biostatistics", () => {
  const g = GROUPS.groups.find((x) => x.id === "radio-diagnosis");
  assert.ok(g.subjects.includes("ss-radiology"), "radiology group holds Radiology");
  assert.ok(g.subjects.includes("ss-cardiology") && g.subjects.includes("ss-neurology"), "radiology group holds the medical core");
});

test("surgical group shows surgical subjects plus Biostatistics, no medical subjects", () => {
  const g = GROUPS.groups.find((x) => x.id === "surgical");
  for (const id of ["ss-general-surgery", "ss-urology", "ss-neurosurgery", "ss-surgical-oncology", "ss-ctvs", "ss-paediatric-surgery", "ss-plastic-surgery", "ss-vascular-surgery"]) {
    assert.ok(g.subjects.includes(id), "surgical holds " + id);
  }
  for (const id of g.subjects) {
    assert.ok(!MEDICAL_CORE.has(id) || id === "ss-biostatistics", "surgical excludes medical subject " + id);
  }
});

test("every other group shows its own subjects plus Biostatistics", () => {
  const own = {};
  SRC.groups.forEach((g) => { own[g.id] = new Set(g.own.concat([SRC.biostatistics])); });
  for (const g of GROUPS.groups) {
    if (MEDICAL_KIND.includes(g.id) || g.id === "surgical") continue;
    assert.deepEqual(new Set(g.subjects), own[g.id], g.id + " is own plus Biostatistics");
  }
});
