/* Cases for MaiK's "no talk about the reference material" filter (owner, 2026-09-26). Shared by
 * test/maik-metatalk.test.mjs (MaiK Cloud, functions/_maik_metatalk.js) and
 * test/maik-lite-metatalk.test.mjs (MaiK Lite's ES5 copy in maik-local.js), so both filters answer to
 * the same cases. */

// Whole sentences that talk ABOUT the material: dropped.
export const DROPPED = [
  "The passage you sent is irrelevant to this question.",
  "The provided sources do not cover paediatric dosing.",
  "The provided StewardMD knowledge focuses on Factor XII deficiency, which is characterized by a prolonged aPTT [1].",
  "The retrieved passages discuss a different condition.",
  "The excerpt above describes gout, not septic arthritis.",
  "Unfortunately the knowledge base does not cover this drug.",
  "The StewardMD Knowledge Base does not mention a loading dose.",
  "The provided context focuses on hepatitis rather than your question.",
  "The text provided is not relevant to your question.",
  "These sources do not mention the paediatric dose.",
  "My reference notes are about a different condition.",
  "The information in the prompt is limited.",
  "You sent me a passage about asthma, but the question is about COPD.",
  "The sources that you provided only discuss adults.",
  "Snippets 2 and 3 are about tuberculosis.",
  "The notes focus on iron deficiency instead.",
];

// Lead-ins and reporting frames: the frame goes, the clinical content stays.
export const REWRITTEN = [
  ["Based on the text provided, the next step is an anti-CCP test.", "The next step is an anti-CCP test."],
  ["According to the provided sources, first-line therapy is methotrexate.", "First-line therapy is methotrexate."],
  ["Based on the information you provided, this is likely inflammatory arthritis.", "This is likely inflammatory arthritis."],
  ["The provided text states that ceftriaxone 2 g IV daily is first line.", "Ceftriaxone 2 g IV daily is first line."],
  ["Give ceftriaxone 2 g IV daily, as per the provided text.", "Give ceftriaxone 2 g IV daily."],
  ["- In the retrieved notes, amoxicillin is first line.", "- Amoxicillin is first line."],
  ["**Based on the passages provided, you're asking about RA workup.**", "**You're asking about RA workup.**"],
];

// Clinical sentences that share a word with the material: untouched, byte for byte.
export const KEPT = [
  "Delayed passage of meconium beyond 48 hours suggests Hirschsprung disease.",
  "The nasal passages are narrowed in croup.",
  "In the context of sepsis, start antibiotics within one hour.",
  "The likely sources here are the urinary tract and the lungs.",
  "Achieve source control within 6 to 12 hours; common sources include abscesses and infected devices.",
  "Ensure the patient education materials provided at discharge are in their language.",
  "Based on the evidence, statins reduce cardiovascular mortality.",
  "The evidence given in RECOVERY is not directly applicable to children.",
  "Given her age and renal function, reduce the dose.",
  "The notes you shared mention a penicillin allergy, so avoid amoxicillin.",
  "The material you shared earlier suggests TB exposure.",
  "The sources of fever are usually infective.",
  "The evidence does not address paediatric patients.",
  "Guidelines do not cover this rare scenario; discuss with a specialist.",
  "The context provided by the history is key.",
  "The information you provided (age 71, creatinine 1.2) means the dose should be reduced.",
  "Rheumatoid factor is positive in about 70-80% of RA and is not specific; check anti-CCP.",
  "Risk factors include smoking, diabetes and hypertension.",
  "Troponin is not relevant in this setting until symptoms are cardiac.",
  "See the StewardMD Drug Index for brand availability.",
  "Amlodipine 5 to 10 mg once daily is first line for hypertension. [1]",
  "Start metformin. [1] Titrate over 4 weeks. [2, 3]",
  "First-line is amoxicillin 500 mg TDS (StewardMD Knowledge Base [1]).",
  "| Diagnosis | RF | Anti-CCP |",
  "| Sjogren syndrome | +/- | - |",
  "### The provided sources",
  "@@MORE@@",
  "@@REFINE: renal impairment | pregnant | the provided text@@",
];
