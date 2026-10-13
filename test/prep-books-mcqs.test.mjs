import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

test("maikbook1 overlay items well formed across all subjects", () => {
  const base = "prep/overlays/maikbook1";
  assert.ok(fs.existsSync(base), "maikbook1 directory exists");

  let totalItems = 0;
  for (const subj of ["anatomy", "physiology", "biochemistry", "surgery"]) {
    const subjDir = path.join(base, subj);
    assert.ok(fs.existsSync(subjDir), `${subj} overlay directory exists`);

    const files = fs.readdirSync(subjDir).filter((x) => x.endsWith(".json"));
    assert.ok(files.length > 0, `${subj} has overlay files`);

    for (const f of files) {
      const data = JSON.parse(fs.readFileSync(path.join(subjDir, f), "utf8"));
      assert.equal(data.set, "maikbook1");
      assert.equal(data.v, 1);
      assert.ok(Array.isArray(data.items) && data.items.length > 0);

      for (const it of data.items) {
        totalItems++;
        assert.ok(it.id && it.id.startsWith("bk-"));
        assert.equal(it.set, "maikbook1");
        assert.equal(it.o.length, 4, "Must have exactly 4 options");
        assert.ok(it.a >= 0 && it.a < 4, "Answer index must be 0..3");
        assert.ok(typeof it.q === "string" && it.q.length > 20, "Question stem must be present");
        assert.ok(typeof it.exp === "string" && it.exp.length > 20, "Explanation must be present");
        assert.equal(it.r.length, 4, "Must have 4 option explanation rationales");
        assert.ok(it.kp && it.kp.length > 5, "Key pearl must be present");
        assert.match(it.credit, /StewardMD/);

        // If image-bearing item, verify image file exists
        if (it.img && it.img.length) {
          for (const imgName of it.img) {
            const imgPath = path.join("prep/lessons/media", imgName);
            assert.ok(fs.existsSync(imgPath), `Referenced image ${imgName} must exist in prep/lessons/media`);
          }
        }
      }
    }
  }

  assert.equal(totalItems, 1095, "Expected 148 high-yield verified MCQs in maikbook1");
});

test("maikbook2 overlay items well formed across all subjects", () => {
  const base = "prep/overlays/maikbook2";
  assert.ok(fs.existsSync(base), "maikbook2 directory exists");

  let totalItems = 0;
  for (const subj of ["obstetrics-gynaecology", "pathology", "pharmacology", "ent", "psychiatry", "ophthalmology", "microbiology"]) {
    const subjDir = path.join(base, subj);
    assert.ok(fs.existsSync(subjDir), `${subj} overlay directory exists`);

    const files = fs.readdirSync(subjDir).filter((x) => x.endsWith(".json"));
    assert.ok(files.length > 0, `${subj} has overlay files`);

    for (const f of files) {
      const data = JSON.parse(fs.readFileSync(path.join(subjDir, f), "utf8"));
      assert.equal(data.set, "maikbook2");
      assert.equal(data.v, 1);
      assert.ok(Array.isArray(data.items) && data.items.length > 0);

      for (const it of data.items) {
        totalItems++;
        assert.ok(it.id && it.id.startsWith("bk2-"));
        assert.equal(it.set, "maikbook2");
        assert.equal(it.o.length, 4, "Must have exactly 4 options");
        assert.ok(it.a >= 0 && it.a < 4, "Answer index must be 0..3");
        assert.ok(typeof it.q === "string" && it.q.length > 20, "Question stem must be present");
        assert.ok(typeof it.exp === "string" && it.exp.length > 20, "Explanation must be present");
        assert.equal(it.r.length, 4, "Must have 4 option explanation rationales");
        assert.ok(it.kp && it.kp.length > 5, "Key pearl must be present");
        assert.match(it.credit, /StewardMD/);

        // If image-bearing item, verify image file exists
        if (it.img && it.img.length) {
          for (const imgName of it.img) {
            const imgPath = path.join("prep/lessons/media", imgName);
            assert.ok(fs.existsSync(imgPath), `Referenced image ${imgName} must exist in prep/lessons/media`);
          }
        }
      }
    }
  }

  assert.equal(totalItems, 1670, "Expected 1670 high-yield verified MCQs in maikbook2 (160 OBG + 530 pathology batch 2 + 120 pharmacology batch 2 + 270 ENT + 170 psychiatry + 200 ophthalmology + 220 microbiology)");
});
