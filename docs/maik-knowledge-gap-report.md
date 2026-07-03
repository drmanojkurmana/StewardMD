# MaiK Knowledge Coverage & Gap Report

_Phase 2 lawful-coverage deliverable. Measures what the knowledge base can ground — it copies no source text and invents no content. Regenerate with `node kb/tools/build-coverage-matrix.mjs && BASE=<served app> node test/run-maik-coverage.mjs && node kb/tools/build-gap-report-md.mjs`._

## 1. Source manifest & lawful-use policy

Treatment precedence: **icmr ▸ guideline ▸ harrison**. Policy: paraphrase-only, no verbatim, no paywalled ingestion, citation required. The deterministic engine — not any source or the LLM — owns diagnosis and stewardship.

| Source | Type | Use | Tier | Verbatim stored | Clinician label |
|---|---|---|---|---|---|
| Harrison's Principles of Internal Medicine, 22e (2025) | textbook | paraphrased_reference | harrison | no | Standard internal-medicine reference |
| ICMR / NCDC / National programme guidelines (India) | national_guideline | paraphrased_protocol | icmr | no | ICMR / national guidelines |
| International society / specialty guidelines | society_guideline | paraphrased_protocol | guideline | no | <Named society> guidelines |
| World Health Organization guidelines | who_guideline | paraphrased_protocol | guideline | no | WHO guidelines |
| Validated clinical criteria / severity scores | clinical_criteria | criteria_paraphrase | guideline | no | Clinical criteria |
| StewardMD Drug Index | internal_formulary | internal_data | formulary | no | StewardMD Drug Index |
| Local hospital / ICU antibiogram overlay | hospital_overlay | site_configured_overlay | overlay | no | Local hospital policy |

## 2. Coverage matrix — what the KB contains

484 searchable diseases (141 diagnostic + 343 reference-only). Capability presence across all diseases:

| Capability | Coverage |
|---|---|
| overview | 100% |
| clinicalFeatures | 100% |
| pathophysiology | 100% |
| differential | 98.8% |
| investigations | 99.6% |
| redFlags | 100% |
| severity | 81.6% |
| prognosis | 98.1% |
| diagnosticScoring | 29.1% |
| management | 28.9% |
| drugTherapy | 8.9% |
| dosing | 8.9% |
| stewardship | 10.5% |

**Read:** diagnostic-side content (overview, features, pathophysiology, differential, investigations, red flags) is near-complete across all 484 diseases. Treatment-side content (management, drug therapy, dosing, stewardship) is concentrated in the diagnostic infective/emergency syndromes — this is the structural gap.

### By specialty (management / drug-therapy / dosing presence)

| Specialty | Diseases | management | drugTherapy | dosing |
|---|---|---|---|---|
| Infectious Diseases | 73 | 0 | 0 | 0 |
| GI / Hepatology | 59 | 19 | 8 | 8 |
| Neurology | 58 | 20 | 3 | 3 |
| Cardiology | 53 | 11 | 2 | 2 |
| Endocrine / Metabolic | 45 | 10 | 0 | 0 |
| Hematology | 35 | 6 | 0 | 0 |
| Pulmonology | 34 | 20 | 10 | 10 |
| Rheumatology / MSK | 31 | 6 | 0 | 0 |
| Nephrology | 19 | 6 | 0 | 0 |
| Oncology | 15 | 3 | 1 | 1 |
| Infectious / Tropical | 12 | 12 | 8 | 8 |
| Genitourinary / Repro | 11 | 6 | 5 | 5 |
| Dermatology | 11 | 5 | 4 | 4 |
| Toxicology | 10 | 6 | 0 | 0 |
| Emergency / Allergy | 6 | 4 | 0 | 0 |
| Systemic / Other | 4 | 4 | 2 | 2 |
| Environmental / Occupational | 3 | 0 | 0 | 0 |
| Vascular | 2 | 1 | 0 | 0 |
| Critical Care | 2 | 1 | 0 | 0 |
| Immunology | 1 | 0 | 0 | 0 |

## 3. Gap report — what the KB can actually answer (live retrieval)

Ran **167** tagged clinician questions (152 in-scope) through the production retrieval path. Verdicts:

| Verdict | Meaning | Count |
|---|---|---|
| STRONG | expected topic + the asked capability retrieved | 97 |
| PARTIAL | right topic, asked capability (dose/mgmt/…) absent | 33 |
| INKB_MISLABELED | probe tagged out-of-scope but the topic is actually in the KB and was retrieved (coverage-positive) | 9 |
| TOPIC_MISS | expected topic not retrieved (incl. correct-sibling retrievals the test-tag didn't anticipate) | 22 |
| OOS_FALSEHIT | out-of-scope probe locked onto an unseen topic (review) | 4 |
| OOS_OK | genuinely out-of-scope probe correctly NOT force-fit (good) | 2 |

In-scope **STRONG 63.8%**, PARTIAL 21.7%. Proprietary-label leaks in Sources: **0** ✅. Gap-probes behaving as expected: 21/47.

### By question type

| qType | verdict breakdown |
|---|---|
| diagnosis | STRONG:12, TOPIC_MISS:2, PARTIAL:1 |
| empiric_antibiotics | STRONG:8, PARTIAL:3, TOPIC_MISS:4, INKB_MISLABELED:1 |
| follow_up | STRONG:10, TOPIC_MISS:2, INKB_MISLABELED:1 |
| red_flags | PARTIAL:6, TOPIC_MISS:4, STRONG:5 |
| investigations | STRONG:7, TOPIC_MISS:2, PARTIAL:6 |
| differential | PARTIAL:4, STRONG:7, TOPIC_MISS:4 |
| special_population | STRONG:23, PARTIAL:3, TOPIC_MISS:2 |
| dosing | STRONG:15, PARTIAL:4, TOPIC_MISS:1 |
| out_of_scope | INKB_MISLABELED:6, OOS_FALSEHIT:4, OOS_OK:2 |
| management | STRONG:10, PARTIAL:6, TOPIC_MISS:1, INKB_MISLABELED:1 |

### Notable gaps (59)

| Verdict | qType | Question | Expected topic | Top retrieved |
|---|---|---|---|---|
| PARTIAL | red_flags | red flags in acute pancreatitis I shouldn't miss | Acute pancreatitis | pancreatitis/harrison.pathophysiology |
| PARTIAL | differential | biliary colic vs acute cholecystitis — how to tell them apart? | Biliary colic | biliary_colic/management |
| PARTIAL | empiric_antibiotics | empiric antibiotics for acute appendicitis with peritonitis? | Acute Appendicitis and Peritonitis | acute_appendicitis/harrison.investigation |
| TOPIC_MISS | diagnosis | 55M sudden tearing chest pain radiating to back, BP different in both  | Aortic dissection | gerd_chest/harrison.pearl |
| TOPIC_MISS | red_flags | red flags in a patient on ramipril presenting with facial swelling | ACEi/hereditary angioedema | oncologic_emergencies/harrison.pearl |
| TOPIC_MISS | empiric_antibiotics | empiric antibiotics for a suspected infected AAA graft? | Desensitization | aaa/harrison.pitfall |
| OOS_FALSEHIT | out_of_scope | workup and management of massive PE in the ED | Pulmonary embolism | diabetes_mellitus_management_and_therapies/harrison.investigation |
| TOPIC_MISS | differential | ddx for a young woman with dysuria and frequency | Acute Cystitis | PYELONEPHRITIS/harrison.pearl |
| PARTIAL | special_population | safe antibiotic for pyelonephritis in pregnancy? | Acute Pyelonephritis | PYELONEPHRITIS/harrison.pearl |
| PARTIAL | empiric_antibiotics | first-line antibiotic regimen for donovanosis? | Donovanosis | donovanosis/harrison.pearl |
| TOPIC_MISS | diagnosis | 70yo male crushing chest pain radiating to left arm, diaphoretic — how | Acute coronary syndrome | gerd_chest/harrison.pearl |
| TOPIC_MISS | investigations | pt with new AF, HR 140, BP stable — what's the workup? which investiga | Atrial fibrillation | congenital_heart_disease/harrison.pathophysiology |
| PARTIAL | red_flags | red flags in acute pericarditis that mean I shouldn't send home? | Acute pericarditis | pericarditis/harrison.investigation |
| TOPIC_MISS | differential | chest pain differential — how do I tell pericarditis from ACS from aor | Acute pericarditis | aortic_dissection/harrison.redFlag |
| PARTIAL | management | management of acute rheumatic fever — full treatment protocol, give in | Acute rheumatic fever | acute_rheumatic_fever/harrison.pitfall |
| PARTIAL | investigations | what investigations to order for suspected multiple myeloma? | Multiple myeloma | myeloma/harrison.pathophysiology |
| PARTIAL | red_flags | red flags in a newly diagnosed acute leukaemia patient | Acute leukaemia | acute_leukemia/harrison.differential |
| TOPIC_MISS | differential | differential for schistocytes on peripheral smear with low platelets | DIC | hypothermia_and_peripheral_cold_injuries/harrison.pitfall |
| TOPIC_MISS | empiric_antibiotics | empiric antibiotics for febrile neutropenia in AML | AML | FEBRILE_NEUTROPENIA/management.treatment |
| PARTIAL | dosing | hydroxyurea dosing in sickle cell disease? | Sickle Cell Disease | sickle_cell_disease/harrison.pearl |
| OOS_FALSEHIT | out_of_scope | management of catastrophic antiphospholipid syndrome | Out of scope (CAPS) | CATASTROPHIC_APS/harrison.pitfall |
| TOPIC_MISS | red_flags | early signs that a cellulitis is actually nec fasc? | Necrotizing Fasciitis | CELLULITIS/harrison.infectionMimic |
| PARTIAL | dosing | what's the systemic steroid dose for DRESS syndrome? | DRESS syndrome | DRESS_SYNDROME/harrison.pearl |
| PARTIAL | management | first-line treatment and antibiotics for erythema nodosum? | Erythema nodosum | ERYTHEMA_NODOSUM/harrison.pitfall |
| PARTIAL | investigations | AKI workup - what investigations to order? | Acute kidney injury | aki/harrison.infectionMimic |
| PARTIAL | red_flags | red flags in nephrotic syndrome that need urgent referral? | Nephrotic syndrome | nephrotic/harrison.pathophysiology |
| PARTIAL | dosing | exact dose of cyclophosphamide for IgA nephropathy? | IgA nephropathy | IGA_NEPHROPATHY/harrison.investigation |
| PARTIAL | management | management of anti-GBM disease (Goodpasture) - plasma exchange protoco | Anti-GBM disease | GOODPASTURE/harrison.pitfall |
| PARTIAL | management | management of actinomycosis - give in detail | Actinomycosis | actinomycosis/harrison.pitfall |
| PARTIAL | empiric_antibiotics | empiric abx for carbapenem-resistant Acinetobacter VAP? | Acinetobacter Infections | VAP/management.treatment |
| TOPIC_MISS | dosing | metronidazole dose for amoebic liver abscess | Amoebiasis | AMOEBIC_LIVER_ABSCESS/management.stewardship |
| TOPIC_MISS | investigations | what investigations to order for suspected dengue vs other arboviral f | Arboviral/Rodent-Borne Infections | DENGUE/harrison.differential |
| PARTIAL | special_population | safe to treat amoebiasis in pregnancy? which drugs to avoid | Amoebiasis | amoebiasis/harrison.investigation |
| PARTIAL | special_population | colistin dosing for Acinetobacter in a patient on dialysis / renal imp | Acinetobacter Infections | renal_colic/management |
| TOPIC_MISS | follow_up | treated amoebic colitis, symptoms improving - what next? do I need a l | Amoebiasis | AMOEBIC_LIVER_ABSCESS/management.treatment |
| PARTIAL | red_flags | pt with SVC syndrome — what are the red flags that need emergent inter | SVC obstruction | svc_obstruction/harrison.pathophysiology |
| PARTIAL | dosing | dosing of neoadjuvant chemo for colorectal cancer? | Colorectal Cancer | colorectal_cancer/harrison.pitfall |
| OOS_FALSEHIT | out_of_scope | management of tumor lysis syndrome — rasburicase vs allopurinol? | Tumor lysis syndrome (not in KB) | TUMOR_LYSIS_SYNDROME/harrison.pitfall |
| PARTIAL | investigations | which investigations to order for suspected viral encephalitis? | Encephalitis | ENCEPHALITIS/harrison.pathophysiology |
| PARTIAL | management | first-line drug treatment and dose for Alzheimer's disease | Alzheimer's Disease | alzheimers_disease/harrison.pearl |
| TOPIC_MISS | management | long-term management of Addison's disease - steroid replacement and si | Adrenal cortical disorders | ibd_flare/management |
| TOPIC_MISS | red_flags | when does a hypoglycemic patient need admission - red flags? | Hypoglycemia | MALARIA/harrison.pathophysiology |
| TOPIC_MISS | differential | pheochromocytoma crisis vs thyroid storm - how to tell apart clinicall | Phaeochromocytoma crisis | thyroid_storm/management |
| PARTIAL | red_flags | red flags in serotonin syndrome vs NMS? | Serotonin syndrome / NMS | serotonin_nms/harrison.pearl |
| PARTIAL | differential | how to tell serotonin syndrome from NMS - differential | Serotonin syndrome / NMS | serotonin_nms/management |
| PARTIAL | investigations | which labs to order in suspected drug-induced hepatitis? | Toxic hepatitis | toxic_hepatitis/management |
| TOPIC_MISS | empiric_antibiotics | management of neurotoxic snakebite - which antivenom and antibiotics? | Venomous snakebites | snakebite_envenomation/management |
| PARTIAL | management | how do you manage antiphospholipid syndrome after a first unprovoked D | Antiphospholipid syndrome | CATASTROPHIC_APS/harrison.investigation |
| TOPIC_MISS | empiric_antibiotics | hot swollen knee, cant exclude septic joint clinically — empiric antib | Crystal arthritis | SEPTIC_SHOCK/management.stewardship |
| TOPIC_MISS | red_flags | GCA red flags I must not miss — worried about vision loss | Giant cell arteritis | anemia_due_to_acute_blood/harrison.pathophysiology |
| PARTIAL | differential | symmetric small joint polyarthritis in a 40F — ddx? | Rheumatoid arthritis | rheumatoid/harrison.pathophysiology |
| PARTIAL | investigations | suspected lupus flare, which labs should I send? | SLE / autoimmune flare | sle_flare/harrison.pitfall |
| TOPIC_MISS | special_population | which RA drugs are safe to continue in pregnancy? | Rheumatoid arthritis | porphyria/harrison.pathophysiology |
| OOS_FALSEHIT | out_of_scope | management of fibromyalgia — first line drugs? | Fibromyalgia (not in KB) | fibromyalgia/harrison.redFlag |
| PARTIAL | diagnosis | How do I tell bacterial from viral acute rhinosinusitis? When to actua | Acute Sinusitis | SINUSITIS/management.stewardship |
| PARTIAL | differential | acute bronchitis vs pneumonia - how to differentiate at bedside | Acute Bronchitis | ACUTE_BRONCHITIS/management.stewardship |
| TOPIC_MISS | special_population | how do I manage long-term COPD in a patient with stage 4 CKD - which i | COPD | ckd/management |
| PARTIAL | investigations | suspected miliary TB - what workup do I order? | Miliary TB | DISSEMINATED_TB/management.treatment |
| TOPIC_MISS | follow_up | TBM started on ATT and steroids - what next? give it to me in detail,  | TB Meningitis | temporal_arteritis/management |

### Interpretation (manual triage of the gaps)

- **Retrieval is disease-name-token biased.** Symptom-only questions that never name the disease ("tearing chest pain radiating to back", "new AF, HR 140", "hypoglycaemic patient — when to admit") can mis-route to a lexically-adjacent topic (GERD, congenital heart disease, malaria). In the live app a *patient case* mitigates this — `buildPackage` retrieves on the engine's assessment findings, not the raw phrase — but pure general-knowledge symptom queries expose the bias. **Remediation: add symptom/alias tokens to disease records; no content change.**
- **Several TOPIC_MISS are correct sibling retrievals**, not failures — e.g. "empiric antibiotics for febrile neutropenia in AML" retrieved FEBRILE_NEUTROPENIA (the right treatment topic) rather than the AML reference page; "metronidazole dose for amoebic liver abscess" retrieved AMOEBIC_LIVER_ABSCESS. These are test-tag mismatches; true topic coverage is higher than the STRONG% alone implies.
- **PARTIAL on red_flags / investigations** is a real ranking gap: the correct disease is retrieved but the red-flag / investigation chunk is out-ranked by overview/management chunks. **Remediation: retrieval-side section boosting for the asked capability (mirrors the existing treat-intent boost).**
- **INKB_MISLABELED (9)** confirms broad coverage: topics the generator guessed were out-of-scope (SBP, infective endocarditis, PE, thyroid storm, scrub typhus, cholangitis) are in fact in the KB and were retrieved with high confidence.

## 4. Recommended remediation (lawful, no textbook copying)

- **Dosing / drug-therapy gaps** (largest structural gap): expand the **StewardMD Drug Index** so regimen `drugRefs` carry dose/route/frequency for non-infective and reference conditions that currently have management prose but no explicit dose. Source: internal formulary — no copyright issue.
- **Management on reference-only diseases**: promote selected high-yield reference diseases to diagnostic tier by authoring a paraphrased `management` framework from the cited society/national guideline (ICMR ▸ guideline precedence), never verbatim. This is the Phase-4 promotion track in the reasoning plan.
- **TOPIC_MISS items**: add aliases / synonyms to the disease record so lexical retrieval locks the right topic; no content change needed.
- **out_of_scope probes**: confirm MaiK returns the honest gap sentence rather than forcing an answer (KNOWLEDGE_SYS already instructs this; verify against provider in Phase 3).

_No remediation invents clinical content; each maps to a declared source in the manifest._
