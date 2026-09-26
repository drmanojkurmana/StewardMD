import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "clinix", "manifest.json");
const PRESENTATIONS_DIR = path.join(ROOT, "clinix", "presentations");

test("manifest registers all 5 core clinical presentations", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  assert.ok(Array.isArray(manifest.presentations), "manifest.presentations must be an array");
  assert.equal(manifest.presentations.length, 5, "manifest must register 5 core presentations");

  const expectedIds = ["breathlessness", "chest_pain", "acute_weakness", "jaundice", "acute_abdomen"];
  const ids = manifest.presentations.map(p => p.id);
  for (const expected of expectedIds) {
    assert.ok(ids.includes(expected), `manifest missing presentation: ${expected}`);
  }
});

test("each presentation file exists and conforms to CliniX 2.0 schema", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

  for (const entry of manifest.presentations) {
    const filePath = path.join(ROOT, "clinix", entry.file);
    assert.ok(fs.existsSync(filePath), `file must exist: ${entry.file}`);

    const p = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(p.id, entry.id);
    assert.ok(p.title && p.title.length > 5, `${p.id} must have a descriptive title`);
    assert.ok(p.subtitle && p.subtitle.length > 10, `${p.id} must have a subtitle`);
    assert.ok(typeof p.estMinutes === "number" && p.estMinutes >= 30, `${p.id} must have valid estMinutes >= 30`);
    assert.equal(p.review && p.review.status, "approved", `${p.id} review status must be approved`);

    // Validate Layers
    assert.ok(p.layers, `${p.id} must have layers`);
    const { recognise, classify, discriminators, dontMiss, investigations, skills, examPearls } = p.layers;

    // 1. Recognise
    assert.ok(Array.isArray(recognise.redFlags) && recognise.redFlags.length >= 4, `${p.id} must have >= 4 redFlags`);
    assert.ok(Array.isArray(recognise.vitalsPriorities) && recognise.vitalsPriorities.length >= 2, `${p.id} must have >= 2 vitalsPriorities`);

    // 2. Classify
    assert.ok(classify && typeof classify === "object", `${p.id} must have classify`);
    assert.ok(classify.tempo, `${p.id} classify must have tempo`);

    // 3. Discriminators
    assert.ok(Array.isArray(discriminators) && discriminators.length >= 3, `${p.id} must have >= 3 discriminators`);
    for (const d of discriminators) {
      assert.ok(d.title, "discriminator title required");
      assert.ok(d.finding, "discriminator finding required");
      assert.ok(d.highYield, "discriminator highYield required");
    }

    // 4. Don't Miss
    assert.ok(Array.isArray(dontMiss) && dontMiss.length >= 3, `${p.id} must have >= 3 dontMiss emergencies`);
    for (const dm of dontMiss) {
      assert.ok(dm.disease, "dontMiss disease required");
      assert.ok(dm.clue, "dontMiss clue required");
      assert.ok(dm.action, "dontMiss emergency action required");
    }

    // 5. Investigations (Step 1, 2, 3)
    assert.ok(investigations, `${p.id} must have investigations`);
    assert.ok(Array.isArray(investigations.step1_immediate) && investigations.step1_immediate.length >= 2);
    assert.ok(Array.isArray(investigations.step2_urgent) && investigations.step2_urgent.length >= 2);
    assert.ok(Array.isArray(investigations.step3_confirmatory) && investigations.step3_confirmatory.length >= 2);

    // 6. Skills
    assert.ok(Array.isArray(skills) && skills.length >= 4, `${p.id} must link to >= 4 core clinical skills`);

    // 7. Exam Pearls
    assert.ok(Array.isArray(examPearls) && examPearls.length >= 2, `${p.id} must have >= 2 exam pearls`);
    for (const pearl of examPearls) {
      assert.ok(pearl.topic, "pearl topic required");
      assert.ok(pearl.text, "pearl text required");
    }
  }
});
