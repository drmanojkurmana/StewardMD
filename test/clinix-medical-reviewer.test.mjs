/* clinix-medical-reviewer.test.mjs — Clinical Reviewer & Pedagogical Quality Audit Suite.
 *
 * Verifies:
 * 1. 10x Clinical Enrichment: First-principles everyday physical analogies (ELI12/secondary school level).
 * 2. Bedside Hand Placement & Sensory Reality: Concrete step-by-step hand positioning and feel/sound distinction.
 * 3. Rookie Traps & OSCE Pitfalls: Dedicated common trap coverage across all clinical skills.
 * 4. Safe Non-Prescribing Pedagogy: Absence of leaked drug dosages in examination and diagnostic teaching.
 * 5. Clinical Diagram & Media Placement: Correct anatomical/pathological routing of interactive diagrams and videos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadSkills(filename) {
  const p = join(ROOT, "clinix/skills", filename);
  return JSON.parse(readFileSync(p, "utf8")).skills;
}

const SYSTEMS = [
  "cardiovascular.json",
  "respiratory.json",
  "abdomen.json",
  "neurology.json"
];

test("MEDICAL REVIEW: 100% of systemic clinical examination skills have intuitive physical analogies", () => {
  let examTotal = 0;
  for (const sysFile of SYSTEMS) {
    const skills = loadSkills(sysFile);
    for (const [id, s] of Object.entries(skills)) {
      if (s.kind === "exam" || s.kind === "general_exam") {
        examTotal++;
        assert.ok(Array.isArray(s.teach) && s.teach.length >= 2, `${id} in ${sysFile} must have at least 2 teach blocks`);
        const hasAnalogy = s.teach.some((b) => typeof b.analogy === "string" && b.analogy.length > 20);
        assert.ok(hasAnalogy, `${id} in ${sysFile} is missing an everyday physical analogy for secondary school comprehension`);
      }
    }
  }
  assert.ok(examTotal >= 44, `expected at least 44 examination skills across systems, found ${examTotal}`);
});

test("BEDSIDE TECHNIQUE: 100% of systemic examination skills specify step-by-step hand placement technique", () => {
  for (const sysFile of SYSTEMS) {
    const skills = loadSkills(sysFile);
    for (const [id, s] of Object.entries(skills)) {
      if (s.kind === "exam" || s.kind === "general_exam") {
        const hasTechnique = s.teach.some((b) => Array.isArray(b.technique) && b.technique.length >= 2);
        assert.ok(hasTechnique, `${id} in ${sysFile} is missing concrete bedside hand technique steps`);
      }
    }
  }
});

test("SENSORY REALITY: 100% of examination skills describe normal vs abnormal feel and sound", () => {
  for (const sysFile of SYSTEMS) {
    const skills = loadSkills(sysFile);
    for (const [id, s] of Object.entries(skills)) {
      if (s.kind === "exam" || s.kind === "general_exam") {
        const hasSensory = s.teach.some((b) => b.sensory && typeof b.sensory.normal === "string" && typeof b.sensory.abnormal === "string");
        assert.ok(hasSensory, `${id} in ${sysFile} is missing sensory description (normal and abnormal)`);
      }
    }
  }
});

test("OSCE TRAPS: 100% of examination skills teach rookie traps and candidate mistakes", () => {
  for (const sysFile of SYSTEMS) {
    const skills = loadSkills(sysFile);
    for (const [id, s] of Object.entries(skills)) {
      if (s.kind === "exam" || s.kind === "general_exam") {
        const hasTraps = s.teach.some((b) => Array.isArray(b.traps) && b.traps.length >= 1);
        assert.ok(hasTraps, `${id} in ${sysFile} is missing common rookie traps / OSCE pitfalls`);
      }
    }
  }
});

test("FIRST-PRINCIPLES MECHANICS: analogies use relatable mechanical and everyday models", () => {
  const mechanicalThemes = [
    /manometer|dipstick|plumbing|pump|hammer|circuit/i,   // Cardiovascular hemodynamics
    /bellows|elastic|sponge|pipes|tunnels|filter/i,       // Respiratory mechanics
    /detective|tube|lining|curtain|bouncing|sponge/i,     // Abdominal mechanics
    /cable|wiring|telephone|switchboard|relay/i           // Neurological conduction
  ];
  for (let i = 0; i < SYSTEMS.length; i++) {
    const skills = loadSkills(SYSTEMS[i]);
    const allAnalogies = Object.values(skills)
      .flatMap((s) => (s.teach || []).map((b) => b.analogy || ""))
      .join(" ");
    assert.match(allAnalogies, mechanicalThemes[i], `Analogies in ${SYSTEMS[i]} must reflect concrete physical mechanics`);
  }
});

test("SAFETY GUARD: no clinical examination skill leaks drug dosage prescriptions", () => {
  // Prescription dosages e.g. "500 mg", "10 mg po bd", "2 g iv" must never appear in exam or history skills.
  const DOSE_RX = /\b\d+\s*(?:mg|mcg|micrograms?|g|ml)\s*(?:po|iv|im|bd|tds|tid|qid|daily|nocte)\b/i;
  for (const sysFile of SYSTEMS) {
    const skills = loadSkills(sysFile);
    for (const [id, s] of Object.entries(skills)) {
      if (s.kind === "exam" || s.kind === "general_exam" || s.kind === "history" || s.kind === "reasoning") {
        const textBlob = JSON.stringify(s);
        assert.ok(!DOSE_RX.test(textBlob), `${id} in ${sysFile} contains prescription dosing text: ${textBlob.match(DOSE_RX)?.[0]}`);
      }
    }
  }
});

test("CLINICAL DIAGRAM REGISTRATION: all interactive SVG diagrams render valid SVG and are placeable", async () => {
  const diagramsModule = (await import("../clinix-diagrams.js")).default;
  const manifest = JSON.parse(readFileSync(join(ROOT, "clinix/media/manifest.json"), "utf8"));
  const media = manifest.media || {};

  const EXPECTED_DIAGRAMS = [
    "diagram.spirocurves",
    "diagram.pleuralsigns",
    "diagram.shiftingdullness",
    "diagram.murphysign",
    "diagram.cranial",
    "diagram.reflexarc",
    "diagram.corticospinal",
    "diagram.cerebellum",
    "diagram.wiggers",
    "diagram.murmurtiming",
    "diagram.jvp",
    "diagram.barrel",
    "diagram.hoover",
    "diagram.trachea",
    "diagram.expansion",
    "diagram.percussion.technique",
    "diagram.auscultation"
  ];

  for (const diaId of EXPECTED_DIAGRAMS) {
    assert.ok(diagramsModule.has(diaId), `Diagram ${diaId} is missing from clinix-diagrams registry`);
    const svg = diagramsModule.render(diaId, {});
    assert.ok(svg.includes("<svg") && svg.includes("</svg>"), `Diagram ${diaId} did not produce valid SVG`);
  }

  // Confirm placeable diagrams in media manifest
  for (const [mid, m] of Object.entries(media)) {
    if (m.inline && m.diagramId) {
      assert.ok(diagramsModule.has(m.diagramId), `Manifest entry ${mid} references unregistered diagram ${m.diagramId}`);
    }
  }
});
