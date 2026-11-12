/* Every lesson in prep/lessons/v1/index.json must show under a subject.
 * subjectLessons is the same function Learn uses: a lesson shows when its index key or its
 * module is a taxonomy module, or a topic id in prep/bank/v1/<subject>/index.json.
 * An entry with a set (radnotes and the like) may stay off the subject lists.
 * An MBBS key prefix must show in that MBBS subject (mbbs/<subject id>), not only under
 * another branch that happens to reuse the module id.
 *
 * node --test test/prep-learn-visibility.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const req = createRequire(import.meta.url);
const P = req("../prep-lessons.js");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every index lesson is shown in a subject, except an entry that carries a set", () => {
  const ix = JSON.parse(fs.readFileSync(join(ROOT, "prep/lessons/v1/index.json"), "utf8"));
  const tax = JSON.parse(fs.readFileSync(join(ROOT, "prep/taxonomy.json"), "utf8"));
  const shown = new Set();
  for (const b of tax.branches) {
    for (const sb of b.subjects) {
      let topics = [];
      try { topics = JSON.parse(fs.readFileSync(join(ROOT, "prep/bank/v1", sb.id, "index.json"), "utf8")).topics || []; } catch { topics = []; }
      for (const m of P.subjectLessons(ix, topics, sb.sections)) for (const x of m.list) shown.add(x[0]);
    }
  }
  const hidden = [];
  let allowed = 0;
  for (const [k, meta] of Object.entries(ix.modules || {})) {
    if (shown.has(k)) continue;
    if (meta && meta.set) { allowed++; continue; }
    hidden.push(k);
  }
  assert.deepEqual(hidden, []);
  assert.equal(shown.size + allowed, Object.keys(ix.modules).length);
});

/* Same prefix map as ~/prep-data/assessment/learn-own-subject.cjs. */
const MBBS = {
  ana: "anatomy", phy: "physiology", bio: "biochemistry", pat: "pathology", phm: "pharmacology",
  mic: "microbiology", fmt: "forensic-medicine", cm: "community-medicine", oph: "ophthalmology",
  ent: "ent", med: "medicine", sur: "surgery", obg: "obstetrics-gynaecology", ped: "paediatrics",
  ort: "orthopaedics", der: "dermatology", psy: "psychiatry", ans: "anaesthesia", rad: "radiology",
};

test("every MBBS-prefix lesson is shown in its own MBBS subject", () => {
  const ix = JSON.parse(fs.readFileSync(join(ROOT, "prep/lessons/v1/index.json"), "utf8"));
  const tax = JSON.parse(fs.readFileSync(join(ROOT, "prep/taxonomy.json"), "utf8"));
  const shownIn = {};
  for (const b of tax.branches) {
    for (const sb of b.subjects) {
      let topics = [];
      try { topics = JSON.parse(fs.readFileSync(join(ROOT, "prep/bank/v1", sb.id, "index.json"), "utf8")).topics || []; } catch { topics = []; }
      for (const m of P.subjectLessons(ix, topics, sb.sections)) {
        for (const x of m.list) (shownIn[x[0]] = shownIn[x[0]] || new Set()).add(b.id + "/" + sb.id);
      }
    }
  }
  const missed = [];
  for (const [k, meta] of Object.entries(ix.modules || {})) {
    if (meta && meta.set) continue;
    const own = MBBS[k.split("-")[0]];
    if (!own) continue;
    const where = shownIn[k];
    if (!where || !where.has("mbbs/" + own)) missed.push(k + " -> " + (meta && meta.module));
  }
  assert.deepEqual(missed, []);
});
