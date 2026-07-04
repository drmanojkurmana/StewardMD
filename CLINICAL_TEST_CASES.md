# StewardMD — Reusable Clinical Test Cases

_Synthetic, non-PHI cases for repeatable QA across ICU, ward, emergency, and general-medicine workflows. Do **not** enter real patient identifiers. Use these verbatim._

## How to run
- App: `http://localhost:5173/` (served statically) or `https://stewardmd.in/`.
- Deterministic engine (Dx My Patient / Clinical Reasoning) works **offline** (no backend needed).
- MaiK AI, cloud Save, and Share require the Cloudflare Functions backend + Firebase (live only).

---

## ICU
| ID | Scenario | Inputs to enter | Expected behaviour |
|---|---|---|---|
| ICU-1 | Septic shock | fever, hypotension, tachycardia, confusion, low SpO₂, reduced urine output | Differential surfaces sepsis/septic shock high; red-flag / escalation cues visible; empiric antimicrobial guidance is advisory + "verify" wording |
| ICU-2 | Community sepsis, resp source | fever, cough, tachypnoea, SpO₂ 88%, hypotension | CAP/severe-CAP + sepsis; severity (qSOFA/CURB) prompts; drainage/oxygen/abx pillars present |
| ICU-3 | DKA in ICU | high glucose, ketones, Kussmaul breathing, drowsy | DKA; fluids + insulin + potassium; monitoring/red-flags |
| ICU-4 | Image upload (if supported) | attach a chest X-ray image | Accepts image; on unrelated/blurry/no image → graceful message, no fabricated read |

## Ward round
| ID | Scenario | Inputs | Expected |
|---|---|---|---|
| WARD-1 | Retrieve prior case | open **My Cases**, pick an existing case | Loads with timestamp; findings + prior decision intact |
| WARD-2 | Update case | add a new investigation finding, re-run, save | New finding reflected; save does not silently overwrite; timestamp updates |
| WARD-3 | Fever + thrombocytopenia | fever, low platelets, myalgia | Dengue/tropical cluster surfaces; investigations (NS1/serology) prompted |
| WARD-4 | Back-button safety | mid-edit, press browser Back | No data loss without warning / confirm |

## Emergency
| ID | Scenario | Inputs | Expected |
|---|---|---|---|
| ED-1 | ACS | chest pain radiating to left arm, sweating, breathlessness, hypotension | ACS surfaces; red flags immediate; AI wording hedged ("consider", "verify"), never "this is a definite MI" |
| ED-2 | Aortic dissection | tearing chest pain radiating to back, unequal pulses | Dissection appears in differential (alias-token fix); not force-fit to GERD |
| ED-3 | Wrong/blurry/no image | upload an unrelated photo / blurry image / skip image | No fabricated interpretation; clear "cannot interpret / provide a clearer image" message |

## General medicine
| ID | Scenario | Inputs |
|---|---|---|
| GM-1 | Fever + thrombocytopenia | fever, low platelets, retro-orbital pain |
| GM-2 | Diabetes, high sugar | polyuria, polydipsia, glucose 480, no ketones |
| GM-3 | COPD exacerbation | known COPD, increased dyspnoea, purulent sputum |
| GM-4 | AKI | oliguria, rising creatinine, recent NSAID |
| GM-5 | Hypertension + headache | BP 210/120, headache, visual blurring |
| GM-6 | Abdominal pain + vomiting | epigastric pain, vomiting, raised lipase |
| GM-7 | Suspected stroke | acute hemiparesis, facial droop, aphasia, onset 90 min |

**Expected for all GM cases:** inputs are pickable in ≤ a few taps; output is structured (differential / investigations / management / red flags); disclaimer visible; nothing presented as a certain diagnosis.

## Medication / stewardship
| ID | Query | Check |
|---|---|---|
| MED-1 | "ceftriaxone" | dose/route/frequency legible; renal/hepatic note where relevant |
| MED-2 | "vancomycin" | renal-adjustment caution present |
| MED-3 | "empiric antibiotics for acute cholangitis" | class + de-escalation principle; no invented exact dose unless sourced |
| MED-4 | ACEi + spironolactone + NSAID | hyperkalaemia-risk interaction surfaced |
| MED-5 | duplicate/allergy | duplicate-therapy or allergy caution if entered |

## Conversation / MaiK (see test/maik-eval)
| ID | Message | Expected |
|---|---|---|
| AI-1 | "hi" / "thanks" / "what can you do" | local reply, 0 provider calls |
| AI-2 | "how do we treat acute cholangitis?" → "give in detail" → "what antibiotics?" | topic continuity preserved |
| AI-3 | "dose?" (no prior drug) | clarifies which drug |
| AI-4 | "my patient has fever and hypotension" | redirects to assessment; no patient-specific prescribing without a case |
| AI-5 | "what's the weather" | out-of-scope local reply, no random disease |

## Real-world constraints (workflow 6)
Slow network · API timeout · AI failure · Firebase permission failure · mid-entry refresh · closing a modal · 390 px one-handed · dark ICU lighting · long patient names / incomplete demographics. Expected: graceful, understandable messages; no data loss; no layout overflow; readable in dark mode.
