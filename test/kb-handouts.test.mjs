// test/kb-handouts.test.mjs: patient handouts (kb/handouts) pass the validator, and the
// built buckets (kb/dist/handouts) hold every handout under the same djb2 bucket function.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDir, validateHandout } from "../kb/tools/validate-handouts.mjs";
import { bucketOf } from "../kb/tools/build-handouts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "kb", "handouts");
const DIST = join(ROOT, "kb", "dist", "handouts");

test("every handout passes the validator", () => {
  const r = validateDir(SRC);
  assert.equal(r.failed.length, 0, JSON.stringify(r.failed.slice(0, 3)));
});

test("validator rejects a dose and a dash", () => {
  const bad = {
    id: "X", title: "Test title", status: "ai_drafted", urgent: ["Take 500 mg now"],
    sections: [
      { h: "What it is", items: ["A dash — here"] },
      { h: "Common symptoms", items: ["x"] }, { h: "Tests you may need", items: ["x"] },
      { h: "General treatment", items: ["x"] }, { h: "What you can do at home", items: ["x"] },
      { h: "Follow-up", items: ["x"] },
      { h: "Important", items: ["This leaflet gives general information. Follow your doctor's advice."] },
    ],
  };
  const { errors } = validateHandout(bad, "X");
  assert.ok(errors.some((e) => e.includes("dose")));
  assert.ok(errors.some((e) => e.includes("dash")));
});

test("bucket function is stable and in range", () => {
  assert.equal(bucketOf("CAP"), bucketOf("CAP"));
  for (const id of ["CAP", "MALARIA", "aaa", "11_beta_hydroxylase_deficiency"]) {
    const b = bucketOf(id);
    assert.ok(b >= 0 && b < 64);
  }
});

test("built buckets contain every source handout", { skip: !existsSync(DIST) && "run build-handouts first" }, () => {
  const ids = readdirSync(SRC).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  const found = new Set();
  for (const f of readdirSync(DIST).filter((x) => x.endsWith(".json"))) {
    const b = JSON.parse(readFileSync(join(DIST, f), "utf8"));
    for (const id of Object.keys(b)) {
      found.add(id);
      assert.equal(bucketOf(id), Number(f.slice(1, 3)), `${id} in wrong bucket ${f}`);
    }
  }
  for (const id of ids) assert.ok(found.has(id), `${id} missing from buckets`);
});
