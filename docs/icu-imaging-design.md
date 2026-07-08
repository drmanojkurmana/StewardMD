# Ward Sync Imaging Import + Imaging Notes + AI Differential Assist

Status: **inspection done, owner-approved to build in a FRESH session** (this session already had 16 commits). This note grounds the next-session build so it executes cleanly. Focused PR — imaging import + clinician-assist only.

## Do-not-modify
Deterministic reasoning engine + ranking · antibiotic engine / ICMR precedence · Ward Sync **auth** model · patient/cloud ownership · MaiK quotas/provider/RAG/privacy · discharge creator · unrelated ICU nav.

## Confirmed Ward Sync imaging endpoints (real — no guessing)
Already used by `ghis-ward.js` importPatientReports:
- **`/radiology?patientId=…`** → `{ orders: [{ resultid, printType, description, date }] }`
- **`/radiology-report?resultid=…&type=<printType>`** → `{ report, reported, enteredBy, error? }`

Field mapping (exposed vs not):
- `reportId`←`resultid` · `studyName`←`description` · `reportDateTime`←`date`/`reported` · `radiologist`←`enteredBy` · `report`=one **free-text blob** (findings+impression together) · error `session_expired`.
- **NOT exposed:** structured modality, separate findings/impression, bodyRegion, orderingDept, clinicalIndication, **PDF links**. → normalize modality from the title; parse sections from the text (preserve raw); missing → "Not documented". Manual PDF/photo only via existing upload workflow.

## Normalized record (per report)
`{ patientId, ownerUid, wardSyncPatientId, reportId(resultid), modality(normalized), studyName(raw description), bodyRegion, reportDateTime, performedDateTime, orderingDepartment, radiologist(enteredBy), clinicalIndication, findingsRaw, impressionRaw, reportRaw, source:"ward-sync", importedAt, importStatus, clinicianVerified:false }`. Dedup by **resultid + performedDate + normalized-text hash**. Never overwrite; per owner+patient scoped. Store in a new `imaging[]` on ICU_STATE (or a patient-scoped store) — DON'T touch labs.trends/vitals.

## UI — Imaging Notes (fits the 5-workspace nav: Documents or a Monitoring member)
Collapsible cards: modality + date + "Ward Sync"; Impression; key findings; actions (Open full · Add to ICU note · Add to Daily Summary · Add to Discharge Draft · Ask MaiK · Mark reviewed · Correct/annotate · Hide duplicate). Filters: All / CT-MRI / Ultrasound / X-ray / Cardiac / Endoscopy / Reviewed / Unreviewed. Empty state: "No imaging reports available from Ward Sync for this patient." No raw metadata by default. "Parsed automatically — verify" badge when sections auto-extracted.

## AI Assist — **clinician chooses the mode** (owner decision: offer BOTH)
Button "AI Assist: Summarize imaging", only after a report is explicitly selected. Two modes the clinician picks at use time:
1. **AI summary** — reuse the existing AI text path (NO new provider / NO MaiK quota/RAG change) with a dedicated imaging prompt → structured output: (1) Imaging summary (2) Key positives (3) Important negatives (4) Possible significance (5) Differential considerations (6) Correlate with (7) Urgent red flags (8) Suggested next checks (9) Source: Ward Sync report dated […]. Marked "Draft — clinician review required".
2. **Deterministic extract** — offline: impression + client-side critical-term scan + modality-based correlation list. No LLM.
**Critical-term flag is ALWAYS deterministic** (client keyword scan → "Potential urgent imaging finding — verify & escalate"), in both modes; keyword triggers review only, never a diagnosis.

**De-identification (hard rule):** AI request MAY include age-band, sex, working dx, relevant symptoms/labs/trends, specialty, ICU status, report text, modality, indication. MUST NOT include name, MRN, bed, phone/address, full Ward Sync payload, unrelated notes, other-patient data. (Assert in tests.)

**Safety wording:** "Imaging is suggestive of…/Consider correlation with…/Differential considerations include…/Urgent review may be needed if…". NEVER "confirmed diagnosis/definitely has/no emergency/safe to discharge". Incomplete report → "Insufficient report detail for reliable interpretation — review original radiology report."

Critical terms: intracranial haemorrhage, midline shift, hydrocephalus, bowel perforation, free intraperitoneal air, ischaemic bowel, ruptured aneurysm, aortic dissection, PE, tension pneumothorax, spinal cord compression, obstructed infected kidney, necrotising pancreatitis, abscess, portal vein thrombosis, active contrast extravasation.

## Workflow integrations
Add reviewed imaging to: Daily ICU Summary · Progress Note · Discharge Draft ("Important imaging during admission") · (opt-in only) Clinical Reasoning context — passing a concise clinician-approved summary, NOT raw report; engine stays diagnostic authority, imaging never auto-alters ranking.

## Manual entry
"Add Imaging Note": modality/date/region/indication/findings/impression/key+/key−/comment + optional upload via existing de-id workflow.

## Parser
Extract Clinical history/Technique/Findings/Impression/Recommendation when confident; preserve original text always; normalize "CECT abdomen / Contrast enhanced CT abdomen / CT abdomen with contrast" → one modality label, keep original study title.

## Tests (`test/run-icu-imaging.mjs`)
Patient isolation · fetch (CECT/CT-brain/X-ray/USG) · dedup (same report twice → one) · empty state · AI de-id (name/MRN/bed/payload excluded from request) · AI structured output · critical-term flag triggers review (no auto-dx) · manual note appears + addable to summary · workflow add (summary/progress/discharge/reasoning) · security (owner UID + patient ID required).

## Data flow
`/radiology → /radiology-report → normalize+parse → ImagingNote (dedup, owner+patient) → cards (review) → optional AI Assist (de-id) or deterministic → add to ICU note / discharge / opt-in reasoning`.
