/* CliniX practical images: one picture is never reused for a different topic, and every picture exists.
 *
 * 2026-11-12 review: 69 practical items showed a picture of something else (a laparoscopic
 * cholecystectomy illustration on manual removal of placenta, hysterectomy, Bartholin marsupialisation
 * and hydrocele operations; one bowel X-ray on pneumoperitoneum, Hirschsprung and an IVU; CPR hand
 * placement on chest palpation). These feed the spotter quiz, so a wrong picture teaches a wrong
 * answer. Those files were removed; each item keeps its image.brief so a correct picture can be sourced.
 * The pairs below are the SAME object in two decks (an instrument used in both O&G and Surgery, the
 * two cerclage levels on one diagram) and may share a file. Anything else sharing bytes fails here.
 *   node --test test/clinix-practical-images.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const ROOT = new URL("../", import.meta.url);
const ALLOWED = new Set([
  "obg.ins.mosquito-forceps|surg.ins.halsted-mosquito-forceps",
  "obg.ins.mayo-scissors|surg.ins.mayo-dissecting-scissors",
  "obg.ins.deaver-retractor|surg.ins.deaver-retractor",
  "obg.ins.balfour-retractor|surg.ins.balfour-self-retaining-retractor",
  "obg.ins.veress-needle|surg.ins.veress-needle",
  "obg.ins.laparoscopic-atraumatic-grasper|obg.ins.laparoscopic-blunt-dissector|obg.ins.laparoscopic-toothed-grasper",
  "obg.ins.angled-hysteroscope-30|obg.ins.hysteroscopy-system",
  "obg.prc.cervical-cerclage-mcdonald|obg.prc.shirodkar-procedure",
  "paed.cns.cerebellar|paed.cns.coordination-gait",
  "paed.proc.ng-tube|surg.tub.ryles-tube",
]);

function practicalItems() {
  const out = [];
  for (const sub of fs.readdirSync(new URL("clinix/practicals/", ROOT), { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    for (const f of fs.readdirSync(new URL(`clinix/practicals/${sub.name}/`, ROOT))) {
      if (!f.endsWith(".json")) continue;
      const d = JSON.parse(fs.readFileSync(new URL(`clinix/practicals/${sub.name}/${f}`, ROOT), "utf8"));
      for (const it of d.items || []) out.push(it);
    }
  }
  return out;
}

test("every referenced practical picture exists", () => {
  const missing = practicalItems().filter((it) => it.image && it.image.file && !fs.existsSync(new URL("." + it.image.file, ROOT))).map((it) => it.id);
  assert.deepEqual(missing, []);
});

test("no picture is shared between different topics", () => {
  const byHash = new Map();
  for (const it of practicalItems()) {
    if (!it.image || !it.image.file) continue;
    const h = crypto.createHash("sha256").update(fs.readFileSync(new URL("." + it.image.file, ROOT))).digest("hex");
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(it.id);
  }
  const bad = [...byHash.values()].filter((ids) => ids.length > 1).map((ids) => ids.sort().join("|")).filter((k) => !ALLOWED.has(k));
  assert.deepEqual(bad, []);
});

test("lesson steps only show practical pictures that exist", () => {
  const dir = new URL("prep/lessons/v1/", ROOT);
  const missing = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "index.json") continue;
    const raw = fs.readFileSync(new URL(f, dir), "utf8");
    if (!raw.includes("clinix/media/practicals/")) continue;
    for (const s of JSON.parse(raw).steps || []) {
      const v = s.vis;
      if (v && v.kind === "image" && /clinix\/media\/practicals\//.test(v.src) && !fs.existsSync(new URL(String(v.src).replace(/^\//, ""), ROOT))) missing.push(f + ": " + v.src);
    }
  }
  assert.deepEqual(missing, []);
});
