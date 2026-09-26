import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCREENS_SRC = fs.readFileSync(path.join(ROOT, "clinix-screens.js"), "utf8");

// Import audio engine to assert sound models cross-link
const audioModule = await import("../clinix-audio.js");
const AUDIO = audioModule.default || audioModule;

test("ABG engine evaluates pure and mixed acid-base disorders accurately", () => {
  // Extract solveAbg from clinix-screens.js
  const fnMatch = SCREENS_SRC.match(/function solveAbg\(vals\) \{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch, "solveAbg must be defined in clinix-screens.js");
  const solveAbg = new Function("vals", fnMatch[1]);

  // 1. DKA: High Anion Gap Metabolic Acidosis
  const dka = solveAbg({ ph: 7.15, paco2: 20, hco3: 7, na: 135, cl: 98, alb: 4.0 });
  assert.equal(dka.stateStr, "Acidemia");
  assert.match(dka.primary, /Metabolic Acidosis/);
  assert.equal(dka.agState, "High Anion Gap (HAGMA)");
  assert.ok(dka.corrAg > 14);
  assert.match(dka.compStr, /Winter's Formula/);

  // 2. Severe Diarrhea: Normal Anion Gap Metabolic Acidosis
  const nagma = solveAbg({ ph: 7.24, paco2: 26, hco3: 11, na: 140, cl: 118, alb: 4.0 });
  assert.equal(nagma.stateStr, "Acidemia");
  assert.match(nagma.primary, /Metabolic Acidosis/);
  assert.equal(nagma.agState, "Normal Anion Gap (NAGMA)");

  // 3. Acute Severe Asthma: Respiratory Acidosis
  const asthma = solveAbg({ ph: 7.25, paco2: 60, hco3: 26, na: 140, cl: 102, alb: 4.0 });
  assert.equal(asthma.stateStr, "Acidemia");
  assert.match(asthma.primary, /Respiratory Acidosis/);

  // 4. Panic / Hyperventilation: Respiratory Alkalosis
  const panic = solveAbg({ ph: 7.55, paco2: 24, hco3: 21, na: 140, cl: 104, alb: 4.0 });
  assert.equal(panic.stateStr, "Alkalemia");
  assert.match(panic.primary, /Respiratory Alkalosis/);

  // 5. Persistent Vomiting: Metabolic Alkalosis
  const vomiting = solveAbg({ ph: 7.52, paco2: 48, hco3: 38, na: 138, cl: 88, alb: 4.0 });
  assert.equal(vomiting.stateStr, "Alkalemia");
  assert.match(vomiting.primary, /Metabolic Alkalosis/);
});

test("Spotter Arena questions are rigorous, complete, and have valid options", () => {
  const match = SCREENS_SRC.match(/var SPOTTER_QUESTIONS = (\[[\s\S]*?\]);\n\n  function openSpotter/);
  assert.ok(match, "SPOTTER_QUESTIONS must be defined");
  const questions = eval(match[1]);

  assert.equal(questions.length, 10, "Spotter arena must have 10 clinical questions");
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    assert.ok(q.q && q.q.length > 20, `Question ${i + 1} must have a scenario prompt`);
    assert.ok(Array.isArray(q.opts) && q.opts.length === 4, `Question ${i + 1} must have exactly 4 options`);
    assert.ok(q.correct >= 0 && q.correct < 4, `Question ${i + 1} correctIndex must be 0-3`);
    assert.ok(q.why && q.why.length > 25, `Question ${i + 1} must provide clinical rationale`);
  }
});

test("The Chief's Ward Round reproduces high-pressure clinical viva", () => {
  const match = SCREENS_SRC.match(/var CHIEF_QUESTIONS = (\[[\s\S]*?\]);\n\n  function openChief/);
  assert.ok(match, "CHIEF_QUESTIONS must be defined");
  const questions = eval(match[1]);

  assert.equal(questions.length, 5, "Chief's ward round must have 5 clinical questions");
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    assert.ok(q.q && q.q.length > 25, `Question ${i + 1} must have professor prompt`);
    assert.ok(Array.isArray(q.opts) && q.opts.length === 4, `Question ${i + 1} must have 4 options`);
    assert.ok(q.correct >= 0 && q.correct < 4, `Question ${i + 1} correctIndex must be 0-3`);
    assert.ok(q.examinerPraise && q.examinerPraise.length > 15, `Question ${i + 1} must have praise`);
    assert.ok(q.examinerScold && q.examinerScold.length > 15, `Question ${i + 1} must have scold`);
  }
});

test("Spoken presentation generator formats all 8 mandatory Indian MBBS & PG sections", () => {
  const fnMatch = SCREENS_SRC.match(/function generateScriptForPresentation\(id\) \{([\s\S]*?)\n  \}/);
  assert.ok(fnMatch, "generateScriptForPresentation must be defined");

  // Run with mock state
  const mockState = {
    presentationBuilt: {
      presentation: {
        title: "Approach to the Breathless Patient",
        system: "respiratory"
      }
    }
  };
  const generateScript = new Function("state", "id", `
    var state = this.mockState;
    ${fnMatch[1]}
  `).bind({ mockState: mockState });

  const script = generateScript("breathlessness");
  assert.ok(script.title.includes("Breathless"), "Script title must mention symptom");
  assert.equal(script.sections.length, 8, "Script must have 8 standard case presentation sections");

  const expectedHeadings = [
    "Demographic Particulars & Chief Complaints",
    "History of Present Illness (HPI)",
    "Past, Personal & Drug History",
    "General Physical Examination",
    "Systemic Respiratory Examination",
    "Summary & Problem Representation",
    "Provisional Diagnosis",
    "Bedside Plan of Management"
  ];

  for (let i = 0; i < expectedHeadings.length; i++) {
    assert.ok(script.sections[i].heading.includes(expectedHeadings[i]), `Section ${i + 1} heading mismatch: ${script.sections[i].heading}`);
    assert.ok(script.sections[i].text.length > 50, `Section ${i + 1} text must be substantial`);
  }

  // All 5 presentation tracks produce 8-section viva presentations
  const presentations = ["chest_pain", "acute_weakness", "jaundice", "acute_abdomen"];
  for (const pid of presentations) {
    const presScript = generateScript(pid);
    assert.equal(presScript.sections.length, 8, `${pid} script must have 8 sections`);
    assert.ok(presScript.title.length > 15, `${pid} script title must be valid`);
    for (let i = 0; i < 8; i++) {
      assert.ok(presScript.sections[i].text.length > 50, `${pid} section ${i + 1} text must be substantial`);
    }
  }
});

test("Auscultation Sound Lab models cross-reference verified Web Audio synthesis engine", () => {
  const match = SCREENS_SRC.match(/var SOUND_MODELS = (\[[\s\S]*?\]);\n\n  function openSoundLab/);
  assert.ok(match, "SOUND_MODELS must be defined");
  const models = eval(match[1]);

  assert.equal(models.length, 17, "Sound lab must include 17 verified auscultation models");
  for (const m of models) {
    assert.ok(m.kind, "kind required");
    assert.ok(m.label, "label required");
    assert.ok(m.desc, "description required");
    assert.ok(AUDIO.has(m.kind), `Audio engine must have synthesized model for ${m.kind}`);
  }
});
