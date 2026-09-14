// connect-agent/phone/onboard.mjs - the universal 6-tap onboarding script.
//
// Any doctor can connect any hospital EMR with six guided taps: sign in, show the patient list,
// open one chart, then show the three clinical tabs. Each ask names exactly what to tap and ends
// with the same reassurance: the AI learns the hospital's layout automatically, so the doctor
// only ever shows each screen once. Copy rules: plain words, no jargon, no em-dash (app-facing
// text), one action per step. Pure: no imports, no side effects.

/** The reassurance every guided ask ends with. The doctor taps; the agent remembers. */
export const REASSURANCE = 'Show each screen only once. The AI learns your hospital layout automatically, so next time it opens everything by itself.';

/* The six universal steps, in ward-round order. `instruction` is the exact sentence the doctor
 * reads; `gap` is the resource key the discovery engine files the captured screen under
 * (step 1 is sign-in, which needs no capture). */
export const ONBOARD_STEPS = Object.freeze([
  { step: 1, total: 6, gap: 'signin', title: 'Sign in', instruction: 'Sign in to your hospital portal.' },
  { step: 2, total: 6, gap: 'worklist', title: 'Patient list', instruction: 'Show me your admitted / inpatient patient list, then tap Done.' },
  { step: 3, total: 6, gap: 'patient', title: 'One patient', instruction: 'Tap on any patient to open their chart, then tap Done.' },
  { step: 4, total: 6, gap: 'labs', title: 'Lab results', instruction: 'Open the Lab / Investigations tab.' },
  { step: 5, total: 6, gap: 'radiology', title: 'Scans', instruction: 'Open the Radiology / Imaging tab.' },
  { step: 6, total: 6, gap: 'medications', title: 'Medicines', instruction: 'Open the Medications / Prescriptions tab.' },
]);

/** Gaps in ONBOARD_STEPS order. */
export const ONBOARD_ORDER = Object.freeze(ONBOARD_STEPS.map((s) => s.gap));

/* Follow-up screens asked only after the core six, in the same plain style. A hospital without
 * one is never blocked: every ask carries Not in my EMR. */
export const FOLLOWUP_STEPS = Object.freeze([
  { gap: 'notes', title: 'Notes', instruction: 'Open the Notes or Assessment section for that patient.' },
  { gap: 'discharge', title: 'Discharge summary', instruction: 'Open the Discharge Summary for that patient.' },
  { gap: 'history', title: 'Visit history', instruction: 'Open the Visit History for that patient.' },
]);

const BY_GAP = new Map();
for (const s of ONBOARD_STEPS.concat(FOLLOWUP_STEPS)) BY_GAP.set(s.gap, s);

/** The ONBOARD_STEPS / FOLLOWUP_STEPS entry for a resource gap, or null (signin has no ask). */
export function onboardStep(gap) {
  return BY_GAP.get(gap) || null;
}

/** The full askDoctor text for a resource gap: what to tap, then the reassurance. Pure. */
export function guidedPrompt(gap) {
  const s = onboardStep(gap);
  if (!s) return null;
  return s.instruction + ' ' + REASSURANCE;
}

/** "Step 2 of 6" line for a resource gap, or '' when the gap is not an onboarded step. Pure. */
export function stepLabel(gap) {
  const s = BY_GAP.get(gap);
  if (!s || !s.step) return '';
  return 'Step ' + s.step + ' of ' + ONBOARD_STEPS.length;
}
