/* Must-not-miss content, pinned so it cannot be edited away.
 *
 * Every item here was a CRITICAL or IMPORTANT finding of the R1 clinical review on 2026-08-25.
 * Each was absent from content that read well and looked complete, which is exactly why prose
 * review is not enough: nothing about a skill LOOKS wrong when the emergency is simply missing.
 *
 * The original wheeze skill went further than omission and said "Wheeze rarely is [a reason to call
 * for help]", which would teach a student to under-triage a peri-arrest asthmatic. That sentence is
 * asserted against by name below.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const skills = (f) => JSON.parse(readFileSync(join(ROOT, "clinix/skills", f), "utf8")).skills;
const text = (s) => JSON.stringify(s);

test("WHEEZE: the silent chest is taught, and wheeze is never called a non-emergency", () => {
  const s = skills("respiratory.json")["skill.hx.resp.wheeze"];
  const t = text(s);
  assert.match(t, /silent chest/i, "a silent chest is the ominous sign in acute asthma");
  assert.match(t, /complete a sentence/i, "inability to complete a sentence is an acute severe marker");
  assert.match(t, /SpO2|saturation/i, "saturation belongs in the severity assessment");
  assert.match(t, /anaphylaxis/i, "sudden wheeze with urticaria or swelling is anaphylaxis");
  // The exact sentence R1 flagged as dangerous.
  assert.ok(!/Wheeze rarely is/i.test(t),
    'the skill must not say "Wheeze rarely is" a reason to call for help');
  assert.match(t, /quietening chest is not improvement|not improvement/i,
    "a fading wheeze must be named as deterioration, not improvement");
});

test("SEIZURE: the five minute rule and a capillary glucose are both present", () => {
  const s = skills("neurology.json")["skill.hx.neuro.seizure"];
  const t = text(s);
  assert.match(t, /status epilepticus/i);
  assert.match(t, /five minutes|5 minutes/i, "status is defined by the clock");
  assert.match(t, /without full recovery|without recovery/i,
    "repeated seizures without recovery between them also count");
  assert.match(t, /glucose/i, "every seizure and blackout needs a capillary glucose");
  assert.match(t, /eclampsia/i, "eclampsia needs magnesium, not an anticonvulsant");
  assert.match(t, /benzodiazepine/i, "status needs treatment, not observation");
});

test("PLEURITIC PAIN: pericarditis and aortic dissection are both considered", () => {
  const s = skills("respiratory.json")["skill.hx.resp.chestpain"];
  const t = text(s);
  assert.match(t, /pericarditis/i, "positional respirophasic pain is classically pericarditis");
  assert.match(t, /leaning forward|sitting forward/i, "the relieving posture is the clue");
  assert.match(t, /dissection/i, "the pain that kills the patient told it was musculoskeletal");
  assert.match(t, /maximal at onset/i, "dissection is worst in the first second, unlike pleurisy");
  assert.match(t, /both arms/i, "pulse and pressure asymmetry");
  assert.match(t, /tuberculous pericarditis/i, "a real cause in the target setting");
});

test("HAEMOPTYSIS: massive is defined by a number and by airway compromise", () => {
  const s = skills("respiratory.json")["skill.hx.resp.haemoptysis"];
  const t = text(s);
  assert.match(t, /100 mL|100mL/, "massive haemoptysis needs a stated volume");
  assert.match(t, /airway/i, "any volume compromising the airway counts, whatever the number");
  assert.match(t, /bleeding side/i, "positioning is the immediate manoeuvre");
  // Indian-context causes of massive haemoptysis.
  assert.match(t, /mitral stenosis/i, "haemoptysis from rheumatic heart disease");
  assert.match(t, /aspergilloma/i, "a leading cause of massive haemoptysis in a healed TB cavity");
});

test("GBS: respiratory and bulbar failure are asked about, not just the ascending weakness", () => {
  const s = skills("neurology.json")["skill.hx.neuro.weakness"];
  const t = text(s);
  assert.match(t, /Guillain/i);
  assert.match(t, /breathless|single.breath|respiratory failure/i,
    "GBS kills through neuromuscular respiratory failure");
  assert.match(t, /swallow|nasal voice|bulbar/i, "bulbar failure means aspiration risk");
  assert.match(t, /periodic paralysis/i,
    "hypokalaemic periodic paralysis is a common, immediately treatable acute quadriparesis in India");
});

test("VERTIGO: isolated vertigo does not exclude a stroke", () => {
  const s = skills("neurology.json")["skill.hx.neuro.vertigo"];
  const t = text(s);
  assert.match(t, /isolated vertigo does not exclude|does not exclude (a )?stroke/i,
    "cerebellar infarct can present as isolated acute vestibular syndrome");
  assert.match(t, /stand|walk|truncal|gait/i,
    "inability to stand or walk unaided is the cerebellar red flag");
});

test("HEADACHE: the glaucoma trap and the two analgesic thresholds", () => {
  const s = skills("neurology.json")["skill.hx.neuro.headache"];
  const t = text(s);
  assert.match(t, /glaucoma/i,
    "acute angle-closure glaucoma mimics cluster and blinds the eye in hours");
  // Both thresholds must appear: 15 for simple analgesics, 10 for triptans/opioids/combinations.
  assert.match(t, /15 or more days|15 days|15\+ days/i, "medication overuse: simple analgesics at 15 days");
  assert.match(t, /10 or more days|10 days|10\+ days/i, "medication overuse: triptans and opioids at 10 days");
  assert.match(t, /triptan/i, "the lower threshold must name the drugs it applies to");
  assert.match(t, /pre-eclampsia|eclampsia/i, "new headache in pregnancy");
});

test("CURB-65 is actionable: the score maps to a disposition, in both urea units", () => {
  const s = skills("respiratory.json")["skill.hx.pneumonia.risk"];
  const t = text(s);
  assert.match(t, /mg\/dL/, "Indian labs report urea in mg/dL, so both units are needed");
  assert.match(t, /0 to 1|0-1/, "the score is inert without its disposition cut-offs");
  assert.match(t, /critical care|ICU|intensive/i, "a score of 3 or more needs escalation");
});
