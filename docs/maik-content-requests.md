# MaiK Knowledge Content-Request Queue (Tier-1)

_Lawful, reviewer-gated remediation for the highest-impact coverage gaps. Each item is a **request**, not content — no source text is copied here. Fill via the declared source (StewardMD Drug Index for dosing; ICMR ▸ guideline paraphrase for protocol), then clinician review before it ships. Derived from `kb/manifest/coverage-matrix.json` (Tier-1 emergencies with `management` present but `dosing`=0) and `docs/maik-knowledge-gap-report.md`._

| Priority | Topic (KB id) | Required sections | Preferred approved source | Reviewer | Retrieval keywords / synonyms |
|---|---|---|---|---|---|
| P0 | Anaphylaxis (`anaphylaxis`) | Adrenaline dose/route/repeat, adjuncts, biphasic monitoring | Resuscitation guidelines + StewardMD Drug Index | Emergency/allergy | anaphylaxis, adrenaline, epinephrine IM, angioedema |
| P0 | Status epilepticus (`status_epilepticus`) | Benzodiazepine dosing, 2nd-line AEDs, refractory ladder | national/neuro guideline + Drug Index | Neurology | status epilepticus, lorazepam, midazolam, levetiracetam, phenytoin |
| P0 | DKA (`dka`) | Fluid, insulin infusion rate, K⁺ replacement thresholds | ICMR/ADA-aligned + Drug Index | Endocrine/critical care | DKA, insulin infusion, potassium, anion gap |
| P0 | Hyperkalaemia (`hyperkalemia`) | Membrane stabilisation, shift, removal — agents & doses | KDIGO/national + Drug Index | Nephrology | hyperkalemia, calcium gluconate, insulin dextrose, salbutamol |
| P0 | Organophosphate poisoning (`organophosphate`) | Atropine titration, pralidoxime, ICU support | WHO/national tox + Drug Index | Toxicology | organophosphate, atropine, pralidoxime, cholinergic |
| P1 | Cardiogenic shock (`cardiogenic_shock`) | Inotrope/vasopressor choice & dose ranges | society guideline + Drug Index | Cardiology/CC | cardiogenic shock, noradrenaline, dobutamine, MCS |
| P1 | Adrenal crisis (`adrenal_crisis`) | Hydrocortisone dosing, fluids, precipitant search | endocrine guideline + Drug Index | Endocrine | adrenal crisis, hydrocortisone, Addisonian |
| P1 | Opioid overdose (`opioid_od`) | Naloxone dose/titration/infusion | national tox + Drug Index | Toxicology/EM | opioid overdose, naloxone, respiratory depression |
| P1 | Myxoedema coma (`myxedema`) | Levothyroxine/liothyronine + steroid cover doses | endocrine guideline + Drug Index | Endocrine | myxedema coma, levothyroxine, hydrocortisone |
| P1 | HHS (`hhs`) | Fluid, insulin, K⁺ — dosing distinct from DKA | ICMR/ADA-aligned + Drug Index | Endocrine/CC | HHS, hyperosmolar, insulin, osmolality |

**Also queued (retrieval metadata, no content authoring):**
- Add symptom/alias synonym tokens to disease records so symptom-only *general* queries lock the correct topic (fixes the name-token retrieval bias in the gap report) — e.g. "tearing chest pain to back"→aortic dissection, "AF RVR"→atrial fibrillation.
- Capability section-boost in `kb/ai/interface.mjs retrieve()` for red-flag / investigation / differential intents (mirror the existing `treatIntent` boost) — raises the right chunk for those question types.

**Constraint:** none of the above ships without (a) the dosing coming from the internal StewardMD Drug Index or a paraphrased approved guideline, and (b) clinician review. No proprietary textbook content.
