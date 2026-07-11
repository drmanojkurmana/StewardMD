/* StewardMD - ENT (otorhinolaryngology) specialty engine.
   ---------------------------------------------------------------------------
   Registers into window.SMD_WS_ENGINES.ent, consumed by workspaces.js. A
   LIGHTWEIGHT specialty pathway - NOT the Internal Medicine engine and NOT a
   diagnosis generator. For each syndrome it collects focused findings + danger
   signs and returns a conservative MANAGEMENT DECISION: the antibiotic-need
   level (0 none → 5 emergency referral), whether SOURCE CONTROL / a procedure
   (drainage, cautery, FB removal, airway) is required, and the referral /
   escalation. Actual drug choice is deferred to the existing stewardship
   engine / Drug Index / local antibiogram + ICMR (never prescribed here).

   The recurring ENT theme is that MOST acute presentations are viral / self-
   limiting (antibiotics NOT indicated) - the engine's job is to separate those
   from the true red flags: airway-threatening infections (epiglottitis, deep
   neck space, Ludwig's), post-tonsillectomy / posterior-nasal HAEMORRHAGE,
   suppurative complications needing drainage (quinsy, mastoiditis, subperiosteal
   abscess), time-critical FOREIGN BODIES (button battery, airway FB) and the
   otological emergencies juniors miss (sudden sensorineural hearing loss, and
   central vertigo masquerading as peripheral). Orbital / intracranial
   complications are co-managed - the notes flag Ophthalmology / Neurosurgery.

   Advisory only. Verify against local protocol, imaging, and the individual patient. */
(function () {
  "use strict";
  // ladder index → matches ABX/management ladder in workspaces.js
  // 0 none · 1 topical/local · 2 oral · 3 IV/admission · 4 urgent drainage/source control/procedure · 5 emergency referral
  function has(sel, id) { return sel && sel.has && sel.has(id); }
  function anyOf(sel, ids) { for (var i = 0; i < ids.length; i++) if (has(sel, ids[i])) return true; return false; }

  // Shared airway-INFECTION emergency result (epiglottitis / deep neck / Ludwig's).
  function airwayEmergency(catg, extra) {
    return { emergency: true, ladder: 5, catg: catg,
      sc: "IMMEDIATE: secure the airway FIRST in a controlled setting (theatre/ICU) with senior anaesthesia + ENT and a difficult-airway trolley ready. Do NOT examine the throat, use a tongue depressor, cannulate or lie the patient flat if the airway is threatened.",
      ref: "Emergency ENT + anaesthesia / critical care NOW - call before imaging.",
      abx: { firstLine: [{ drug: "Ceftriaxone", dose: "2 g", route: "IV q12h" }, { drug: "+ Metronidazole", dose: "500 mg", route: "IV q8h", note: "anaerobic cover for deep-neck / odontogenic source" }], alt: [{ drug: "Amoxicillin-clavulanate", dose: "1.2 g", route: "IV q8h" }, { drug: "or Piperacillin-tazobactam", dose: "4.5 g", route: "IV q6-8h", note: "septic / broad cover; add Vancomycin 15-20 mg/kg IV q8-12h if MRSA / toxic" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - start ONLY after the airway is secured; adjust to local antibiogram/ICMR, cultures, renal function & allergy." },
      mgmt: (["Keep the patient calm and sitting up; humidified O₂; NO sedation.", "IV antibiotics per local protocol/ICMR - only AFTER the airway is controlled; steroids/nebulised adrenaline as adjuncts."]).concat(extra || []) };
  }

  var ENT = {
    id: "ent",
    name: "ENT",
    syndromes: [
      /* ───────────────────── Acute otitis media ───────────────────── */
      {
        id: "aom", name: "Acute otitis media",
        q: [
          { id: "otalgia", label: "Ear pain / bulging red drum" }, { id: "systemic", label: "Fever / systemic upset" },
          { id: "otorrhoea", label: "Otorrhoea / acute perforation" }, { id: "under2_bilat", label: "Age < 2 &/or bilateral" },
          { id: "recurrent", label: "Recurrent / grommets" }, { id: "immuno", label: "Immunocompromise" }
        ],
        danger: [
          { id: "mastoid", label: "Post-auricular swelling / protruding pinna (mastoiditis)" },
          { id: "facial_palsy", label: "Facial nerve palsy" },
          { id: "intracranial", label: "Neck stiffness / altered sensorium / focal neuro signs" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["intracranial", "facial_palsy"])) return { emergency: true, ladder: 5, catg: "AOM with suspected intracranial / facial-nerve complication",
            sc: "Urgent imaging (CT/MRI); source control per ENT (myringotomy ± mastoid surgery).", ref: "Emergency ENT + neurosurgery review; admit.", abx: { firstLine: [{ drug: "Ceftriaxone", dose: "2 g", route: "IV q12h", note: "CNS penetration" }, { drug: "+ Metronidazole", dose: "500 mg", route: "IV q8h", note: "otogenic anaerobes" }, { drug: "+ Vancomycin", dose: "15-20 mg/kg", route: "IV q8-12h", note: "resistant Gram-positive cover pending cultures" }], alt: [{ drug: "Meropenem", dose: "2 g", route: "IV q8h", note: "+ Vancomycin; broad CNS cover" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR, cultures, renal function & allergy." }, mgmt: ["Admit for IV antibiotics per local protocol/ICMR.", "This is a complication of AOM - do NOT treat as a simple ear infection or send home on oral antibiotics."] };
          if (has(sel, "mastoid")) return { emergency: true, ladder: 4, catg: "AOM with suspected acute mastoiditis",
            sc: "CT temporal bone; myringotomy ± cortical mastoidectomy / drain a subperiosteal abscess.", ref: "Urgent ENT; admit.", abx: { firstLine: [{ drug: "Ceftriaxone", dose: "2 g", route: "IV q12h" }, { drug: "+ Metronidazole", dose: "500 mg", route: "IV q8h", note: "for chronic / cholesteatoma-associated anaerobes" }], alt: [{ drug: "Amoxicillin-clavulanate", dose: "1.2 g", route: "IV q8h" }, { drug: "add Vancomycin", dose: "15-20 mg/kg", route: "IV q8-12h", note: "if MRSA risk" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR, cultures, renal function & allergy." }, mgmt: ["IV antibiotics per local antibiogram/ICMR, then de-escalate on culture.", "Post-auricular swelling pushing the pinna forward is mastoiditis until proven otherwise."] };
          if (anyOf(sel, ["otorrhoea", "under2_bilat", "immuno"]) || has(sel, "systemic")) return { emergency: false, ladder: 2, catg: "AOM likely to need antibiotics",
            sc: "No procedure - treat medically; ENT if recurrent perforation / persistent discharge.", ref: "GP/ENT follow-up; review at 48-72 h.", abx: { firstLine: [{ drug: "Amoxicillin", dose: "1 g", route: "PO TID", note: "high-dose, 5-7 d" }, { drug: "or Amoxicillin-clavulanate", dose: "875/125 mg", route: "PO BID", note: "if recent antibiotics / treatment failure" }], alt: [{ drug: "Cefuroxime", dose: "500 mg", route: "PO BID" }, { drug: "or Azithromycin", dose: "500 mg", route: "PO daily ×3 d", note: "penicillin allergy" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR, cultures, renal function & allergy." }, mgmt: ["Oral antibiotic indicated (otorrhoea, age < 2 esp. bilateral, marked systemic upset or immunocompromise) - choose per local guidance.", "Analgesia is the mainstay for pain - do NOT wait for antibiotics to work.", "AVOID topical aminoglycoside drops through a dry perforation."] };
          return { emergency: false, ladder: 0, catg: "Uncomplicated AOM - likely viral / self-limiting",
            sc: "No procedure.", ref: "Safety-net; review if no improvement at 48-72 h, or discharge / mastoid signs develop.", mgmt: ["Analgesia + watchful waiting - most cases resolve and antibiotics are usually NOT needed; a delayed prescription for 48-72 h is a good stewardship option.", "Antibiotics only if it fails to settle or red flags appear."] };
        }
      },
      /* ───────────────────── Otitis externa ───────────────────── */
      {
        id: "otitis_externa", name: "Otitis externa",
        q: [
          { id: "canal", label: "Canal pain / itch / tragal tenderness" }, { id: "discharge", label: "Discharge / debris" },
          { id: "swelling", label: "Canal oedema (drops won't reach)" }, { id: "water", label: "Water exposure / swimmer / hearing aid" },
          { id: "diabetes_elderly", label: "Diabetes / immunocompromise / elderly" }, { id: "pinna", label: "Spreading pinna / peri-auricular cellulitis" }
        ],
        danger: [
          { id: "granulation", label: "Granulation in canal + severe deep / night pain (necrotising OE)" },
          { id: "facial_palsy", label: "Facial / lower cranial-nerve palsy" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["granulation", "facial_palsy"]) || (has(sel, "diabetes_elderly") && has(sel, "canal") && has(sel, "swelling") && has(sel, "discharge"))) return { emergency: anyOf(sel, ["granulation", "facial_palsy"]), ladder: 4, catg: "Suspected necrotising (malignant) otitis externa",
            sc: "Aural microsuction + biopsy of granulation; imaging (CT/MRI ± nuclear scan) to assess skull base; monitor cranial nerves.", ref: "Urgent ENT; admit - high-risk in diabetes / immunocompromise.", abx: { firstLine: [{ drug: "Ciprofloxacin", dose: "750 mg", route: "PO BID", note: "anti-pseudomonal; prolonged 6-8 wk course, high oral bioavailability" }, { drug: "or Ciprofloxacin", dose: "400 mg", route: "IV q8-12h", note: "if unable to tolerate oral / severe" }], alt: [{ drug: "Piperacillin-tazobactam", dose: "4.5 g", route: "IV q6-8h" }, { drug: "or Ceftazidime", dose: "2 g", route: "IV q8h", note: "anti-pseudomonal beta-lactam" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - skull-base osteomyelitis needs prolonged culture-directed therapy; adjust to local antibiogram/ICMR, cultures, renal function & allergy." }, mgmt: ["Systemic anti-pseudomonal cover (prolonged course) per local antibiogram/ICMR + strict glycaemic control.", "This is skull-base osteomyelitis, NOT a simple OE - do not just prescribe drops and discharge."] };
          if (has(sel, "pinna")) return { emergency: false, ladder: 2, catg: "Otitis externa with spreading cellulitis",
            sc: "Aural toilet / microsuction; insert a wick if the canal is occluded.", ref: "ENT if not settling.", abx: { firstLine: [{ drug: "Cloxacillin", dose: "500 mg", route: "PO QID", note: "anti-staph; continue topical drops alongside" }, { drug: "or Amoxicillin-clavulanate", dose: "875/125 mg", route: "PO BID" }], alt: [{ drug: "Clindamycin", dose: "300 mg", route: "PO QID" }, { drug: "or Cefuroxime", dose: "500 mg", route: "PO BID", note: "penicillin allergy" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - systemic cover is for the spreading cellulitis only; adjust to local antibiogram/ICMR, cultures, renal function & allergy." }, mgmt: ["Add oral anti-staph/strep cover for the spreading cellulitis per local guidance; continue topical treatment."] };
          return { emergency: false, ladder: 1, catg: "Uncomplicated otitis externa",
            sc: "Aural toilet / microsuction is the key step; insert an ear wick if the canal is oedematous so drops actually reach.", ref: "Review if not improving; ENT for recurrent / non-resolving disease.", abx: { firstLine: [{ drug: "Ciprofloxacin 0.3% + dexamethasone 0.1% ear drops", dose: "3-4 drops", route: "topical BID ×7 d", note: "safe with a perforation; drops are the mainstay - systemic antibiotics NOT needed" }], alt: [{ drug: "Neomycin-polymyxin B-hydrocortisone drops", dose: "3 drops", route: "topical TID-QID", note: "AVOID if the drum is perforated (aminoglycoside ototoxicity)" }, { drug: "Clotrimazole 1% drops", dose: "", route: "topical", note: "if fungal debris / otomycosis - not more antibacterial" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric topical therapy - adjust to local antibiogram/ICMR, cultures & allergy; escalate only if cellulitis spreads or necrotising OE is suspected." }, mgmt: ["Topical antibiotic ± steroid drops are first-line - systemic antibiotics are usually NOT needed and are over-prescribed here.", "Keep the ear dry; analgesia; treat any fungal debris (otomycosis) with an antifungal, not more antibacterial drops."] };
        }
      },
      /* ───────────── Acute mastoiditis ───────────── */
      {
        id: "mastoiditis", name: "Acute mastoiditis",
        q: [
          { id: "postauric", label: "Post-auricular swelling / redness / tenderness" }, { id: "protruding", label: "Protruding / down-and-out pinna" },
          { id: "aom", label: "Current / recent AOM" }, { id: "otorrhoea", label: "Otorrhoea" }, { id: "fever", label: "Fever / systemic upset" }
        ],
        danger: [
          { id: "abscess", label: "Fluctuant subperiosteal abscess" }, { id: "facial_palsy", label: "Facial nerve palsy" },
          { id: "intracranial", label: "Neck stiffness / altered sensorium / focal neuro signs / seizure" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["intracranial", "facial_palsy"])) return { emergency: true, ladder: 5, catg: "Mastoiditis with intracranial / facial-nerve complication",
            sc: "Urgent contrast CT/MRI (look for sinus thrombosis, abscess); cortical mastoidectomy ± neurosurgical drainage.", ref: "Emergency ENT + neurosurgery; admit.", abx: { firstLine: [{ drug: "Ceftriaxone", dose: "2 g", route: "IV q12h", note: "CNS penetration" }, { drug: "+ Metronidazole", dose: "500 mg", route: "IV q8h", note: "otogenic anaerobes" }, { drug: "+ Vancomycin", dose: "15-20 mg/kg", route: "IV q8-12h", note: "resistant Gram-positive cover" }], alt: [{ drug: "Meropenem", dose: "2 g", route: "IV q8h", note: "+ Vancomycin; broad CNS cover" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR, cultures, renal function & allergy." }, mgmt: ["IV antibiotics per local protocol/ICMR immediately.", "Consider lateral sinus thrombosis / intracranial abscess - image the brain, not just the temporal bone."] };
          if (has(sel, "abscess")) return { emergency: true, ladder: 4, catg: "Acute mastoiditis with subperiosteal abscess",
            sc: "Drain the abscess; myringotomy ± cortical mastoidectomy; CT temporal bone.", ref: "Urgent ENT; admit.", abx: { firstLine: [{ drug: "Ceftriaxone", dose: "2 g", route: "IV q12h" }, { drug: "+ Metronidazole", dose: "500 mg", route: "IV q8h", note: "anaerobic cover" }], alt: [{ drug: "Amoxicillin-clavulanate", dose: "1.2 g", route: "IV q8h" }, { drug: "add Vancomycin", dose: "15-20 mg/kg", route: "IV q8-12h", note: "if MRSA risk" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric adjunct to drainage - adjust to local antibiogram/ICMR, cultures, renal function & allergy." }, mgmt: ["IV antibiotics per local antibiogram/ICMR, de-escalate on culture."] };
          return { emergency: false, ladder: 3, catg: "Acute mastoiditis - admit for IV therapy",
            sc: "CT temporal bone; myringotomy if the drum is intact; surgery if not improving in 24-48 h.", ref: "ENT; admit.", abx: { firstLine: [{ drug: "Ceftriaxone", dose: "2 g", route: "IV q12h" }, { drug: "± Metronidazole", dose: "500 mg", route: "IV q8h", note: "add for chronic / cholesteatoma-associated disease" }], alt: [{ drug: "Amoxicillin-clavulanate", dose: "1.2 g", route: "IV q8h" }, { drug: "or Cefuroxime", dose: "1.5 g", route: "IV q8h" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - de-escalate on culture; adjust to local antibiogram/ICMR, renal function & allergy." }, mgmt: ["IV antibiotics per local protocol/ICMR; do NOT manage as outpatient AOM.", "Reassess for abscess / facial palsy / neuro signs - escalate promptly if they appear."] };
        }
      },
      /* ───────────── Sudden sensorineural hearing loss (missed ENT emergency) ───────────── */
      {
        id: "ssnhl", name: "Sudden hearing loss",
        q: [
          { id: "sudden_uni", label: "Sudden unilateral hearing loss (≤ 72 h)" }, { id: "tinnitus", label: "New tinnitus / aural fullness" },
          { id: "sn_forks", label: "Weber → BETTER ear + Rinne positive (sensorineural)" }, { id: "vertigo", label: "Associated vertigo / imbalance" },
          { id: "conductive", label: "Wax / effusion / perforation / discharge seen (conductive)" }, { id: "noise_trauma", label: "Preceding baro-/noise trauma or ototoxic drug" }
        ],
        danger: [
          { id: "central", label: "Focal neuro deficit / other cranial nerves / severe ataxia (? stroke)" },
          { id: "meningism", label: "Fever + neck stiffness / recent meningitis" }
        ],
        assess: function (sel) {
          if (has(sel, "central")) return { emergency: true, ladder: 5, catg: "⚠ Sudden hearing loss with neuro signs - exclude posterior-circulation stroke",
            sc: "Urgent MRI/DWI (early CT often normal) + stroke pathway; audiogram once stable.", ref: "Emergency stroke team / neurology + ENT.", mgmt: ["Sudden hearing loss can be the herald of an AICA-territory stroke - do NOT anchor on 'ear problem'.", "Antibiotics are NOT the treatment here."] };
          if (has(sel, "meningism")) return { emergency: true, ladder: 5, catg: "Sudden hearing loss with meningism - post-meningitic risk",
            sc: "Treat the CNS infection first; urgent audiology - post-meningitic loss can ossify the cochlea (early implant window).", ref: "Emergency medicine / ENT + audiology.", abx: { firstLine: [{ drug: "Ceftriaxone", dose: "2 g", route: "IV q12h" }, { drug: "+ Vancomycin", dose: "15-20 mg/kg", route: "IV q8-12h", note: "resistant pneumococcus cover" }], alt: [{ drug: "+ Ampicillin", dose: "2 g", route: "IV q4h", note: "add if Listeria risk (age >50, immunocompromise)" }, { drug: "Meropenem", dose: "2 g", route: "IV q8h", note: "beta-lactam allergy / broad cover" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric bacterial-meningitis regimen - give Dexamethasone 10 mg IV q6h before/with the first dose; do not delay for imaging; adjust to local antibiogram/ICMR, CSF, renal function & allergy." }, mgmt: ["Follow the meningitis/sepsis pathway for antibiotics per local protocol/ICMR.", "Flag EARLY for cochlear-implant assessment - labyrinthitis ossificans is time-critical."] };
          if (has(sel, "conductive") && !has(sel, "sn_forks")) return { emergency: false, ladder: 1, catg: "Likely CONDUCTIVE loss - treat the cause",
            sc: "Microsuction wax / manage effusion / treat discharge; repeat otoscopy + tuning forks.", ref: "ENT / audiology routine if it persists.", mgmt: ["Confirm it is conductive before reassuring - Weber lateralises to the AFFECTED ear in conductive loss.", "If any doubt it is sensorineural, refer urgently - do NOT wait."] };
          if (has(sel, "sudden_uni")) return { emergency: true, ladder: 5, catg: "⚠ Sudden sensorineural hearing loss - otological emergency",
            sc: "First EXCLUDE wax/effusion by otoscopy + tuning forks (Weber to better ear, Rinne positive = sensorineural); urgent pure-tone audiogram; MRI IAM to exclude vestibular schwannoma.", ref: "URGENT (same / next-day) ENT - the treatment window is only a few days.", mgmt: ["This is the ENT emergency juniors miss - earlier corticosteroids (systemic ± intratympanic, ENT-led) give better recovery.", "Antibiotics are NOT indicated - this is not an infection.", "Do NOT reassure and book a routine clinic weeks away."] };
          return { emergency: false, ladder: 0, catg: "Hearing change - characterise (conductive vs sensorineural)",
            sc: "Otoscopy + tuning-fork tests; audiogram.", ref: "Audiology / ENT.", mgmt: ["Any sudden unilateral sensorineural loss = treat as an emergency and refer same day.", "Antibiotics are not a treatment for hearing loss."] };
        }
      },
      /* ───────────── Acute vertigo (peripheral vs central) ───────────── */
      {
        id: "vertigo", name: "Acute vertigo",
        q: [
          { id: "positional", label: "Brief (seconds), triggered by head turn / rolling (BPPV)" }, { id: "continuous", label: "Continuous vertigo for days (neuritis)" },
          { id: "hearing_sx", label: "With hearing loss / tinnitus (labyrinthitis / Ménière)" }, { id: "viral", label: "Recent viral URTI" },
          { id: "aom_recent", label: "Current / recent otitis media or cholesteatoma" }, { id: "hits_periph", label: "Head-impulse POSITIVE + unidirectional nystagmus (peripheral)" }
        ],
        danger: [
          { id: "central_neuro", label: "Focal deficit / dysarthria / diplopia / dysphagia" },
          { id: "central_exam", label: "Head-impulse NEGATIVE, direction-changing or vertical nystagmus (HINTS central)" },
          { id: "ataxia", label: "Cannot stand / walk unaided; sudden severe headache or neck pain" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["central_neuro", "central_exam", "ataxia"])) return { emergency: true, ladder: 5, catg: "⚠ Acute vertigo with CENTRAL red flags - exclude posterior-circulation stroke",
            sc: "Urgent MRI/DWI (early CT frequently normal in posterior stroke); stroke pathway.", ref: "Emergency stroke team / neurology.", mgmt: ["A correctly performed HINTS exam by a trained clinician outperforms early CT for posterior stroke.", "Inability to walk unaided or new headache with vertigo = central until proven otherwise.", "Antibiotics are not indicated."] };
          if (has(sel, "aom_recent")) return { emergency: false, ladder: 3, catg: "Vertigo with ear disease - suspected suppurative labyrinthitis",
            sc: "CT temporal bone; exclude cholesteatoma / fistula; ENT for source control.", ref: "Urgent ENT; admit.", abx: { firstLine: [{ drug: "Ceftriaxone", dose: "2 g", route: "IV q12h" }, { drug: "+ Metronidazole", dose: "500 mg", route: "IV q8h", note: "otogenic / cholesteatoma anaerobes" }], alt: [{ drug: "Amoxicillin-clavulanate", dose: "1.2 g", route: "IV q8h" }, { drug: "add Vancomycin", dose: "15-20 mg/kg", route: "IV q8-12h", note: "if intracranial spread / MRSA risk" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - treats the otitic complication, not the vertigo; adjust to local antibiogram/ICMR, cultures, renal function & allergy." }, mgmt: ["IV antibiotics per local protocol/ICMR as a complication of otitis media - not simple peripheral vertigo.", "Watch for progression to meningitis / facial palsy."] };
          if (has(sel, "hearing_sx")) return { emergency: false, ladder: 0, catg: "Peripheral vertigo WITH hearing loss (labyrinthitis / Ménière)",
            sc: "Audiogram; if the hearing loss is sudden + sensorineural, manage on the sudden-hearing-loss pathway urgently.", ref: "ENT / audiology.", mgmt: ["Sudden sensorineural loss with vertigo overlaps with an SSNHL emergency - refer same day.", "Symptomatic care; antibiotics are NOT indicated."] };
          return { emergency: false, ladder: 0, catg: "Peripheral vertigo (BPPV / vestibular neuritis) - usually self-limiting",
            sc: "BPPV: Dix-Hallpike then an Epley (canalith repositioning) manoeuvre is the definitive treatment - not drugs.", ref: "GP / ENT if persistent, recurrent or atypical.", mgmt: ["Most acute peripheral vertigo settles - antibiotics are NOT indicated.", "Use a vestibular sedative only briefly for severe acute symptoms; do NOT continue it - prolonged use delays central compensation.", "Encourage early mobilisation / vestibular rehab."] };
        }
      },
      /* ───────────────────── Sore throat / tonsillitis ───────────────────── */
      {
        id: "sore_throat", name: "Sore throat / tonsillitis",
        q: [
          { id: "exudate", label: "Tonsillar exudate / swelling" }, { id: "fever", label: "Fever ≥ 38 °C" },
          { id: "nodes", label: "Tender anterior cervical nodes" }, { id: "nocough", label: "Absence of cough" },
          { id: "unilateral", label: "Unilateral bulge / uvular deviation / trismus" }, { id: "immuno", label: "Immunocompromise / recent chemo (agranulocytosis?)" }
        ],
        danger: [
          { id: "airway", label: "Stridor / drooling / muffled voice / respiratory distress" },
          { id: "quinsy_severe", label: "Severe trismus + unable to swallow saliva" }
        ],
        assess: function (sel) {
          if (has(sel, "airway")) return airwayEmergency("Sore throat with airway compromise - exclude epiglottitis / deep-neck abscess", ["Do NOT attempt tonsil/throat examination if stridor or drooling."]);
          if (has(sel, "unilateral") || has(sel, "quinsy_severe")) return { emergency: false, ladder: 4, catg: "Peritonsillar abscess (quinsy)",
            sc: "Needle aspiration / incision & drainage of the abscess is the primary treatment.", ref: "Urgent ENT for drainage.", abx: { firstLine: [{ drug: "Amoxicillin-clavulanate", dose: "1.2 g", route: "IV q8h", note: "covers strep + oral anaerobes" }, { drug: "or Benzylpenicillin + Metronidazole", dose: "1.2 g / 500 mg", route: "IV q6h / q8h" }], alt: [{ drug: "Clindamycin", dose: "600 mg", route: "IV q8h", note: "penicillin allergy" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric ADJUNCT to drainage - adjust to local antibiogram/ICMR, cultures, renal function & allergy." }, mgmt: ["IV antibiotics + steroids per local protocol as an ADJUNCT to drainage; analgesia, IV fluids.", "Watch the airway; a hot-potato voice with trismus is quinsy, not simple tonsillitis."] };
          var centor = (has(sel, "exudate") ? 1 : 0) + (has(sel, "fever") ? 1 : 0) + (has(sel, "nodes") ? 1 : 0) + (has(sel, "nocough") ? 1 : 0);
          if (centor >= 3 || has(sel, "immuno")) return { emergency: false, ladder: 2, catg: "Likely bacterial (group A strep) tonsillitis",
            sc: "No procedure; consider FBC if immunocompromised (exclude agranulocytosis).", ref: "Review at 48 h; ENT if recurrent or peritonsillar spread.", abx: { firstLine: [{ drug: "Phenoxymethylpenicillin (Penicillin V)", dose: "500 mg", route: "PO QID ×10 d" }, { drug: "or Amoxicillin", dose: "500 mg", route: "PO TID ×10 d", note: "AVOID if glandular fever (EBV) is possible - causes a widespread rash" }], alt: [{ drug: "Azithromycin", dose: "500 mg", route: "PO daily ×3 d" }, { drug: "or Clindamycin", dose: "300 mg", route: "PO QID", note: "penicillin allergy" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric for group A strep - adjust to local antibiogram/ICMR, cultures & allergy; complete the full course to prevent rheumatic fever." }, mgmt: ["Oral antibiotic reasonable (high Centor/FeverPAIN or immunocompromise) - penicillin-class per local guidance.", "AVOID amoxicillin/ampicillin if glandular fever is possible (rash).", "Analgesia + fluids matter most."] };
          return { emergency: false, ladder: 0, catg: "Sore throat - likely viral / self-limiting",
            sc: "No procedure.", ref: "Safety-net; return if unable to swallow, unilateral swelling or any airway symptoms.", mgmt: ["Analgesia + fluids - antibiotics are usually NOT needed (low Centor / FeverPAIN); most sore throats are viral.", "Antibiotics only if genuine bacterial features or high risk."] };
        }
      },
      /* ───────────── Epiglottitis / supraglottitis (airway red-flag) ───────────── */
      {
        id: "epiglottitis", name: "Epiglottitis / supraglottitis",
        q: [
          { id: "rapid", label: "Rapid-onset severe sore throat + odynophagia" }, { id: "muffled", label: "Muffled 'hot-potato' voice" },
          { id: "drooling", label: "Drooling / can't swallow saliva" }, { id: "tripod", label: "Sitting forward / tripod, distressed" }, { id: "fever", label: "High fever / toxic" }
        ],
        danger: [{ id: "airway", label: "Stridor / respiratory distress / cyanosis - any = airway emergency" }],
        assess: function () { return airwayEmergency("⚠ Epiglottitis / supraglottitis - airway emergency", ["Do NOT use a tongue depressor, force examination, or lie the patient flat.", "Prepare for a difficult airway; ENT + anaesthesia at the bedside with the patient in their position of comfort."]); }
      },
      /* ───────────── Deep neck space infection / Ludwig's angina ───────────── */
      {
        id: "deep_neck", name: "Deep neck space infection",
        q: [
          { id: "floor_mouth", label: "Floor-of-mouth swelling / tongue elevation (Ludwig's)" }, { id: "neck", label: "Neck swelling / torticollis" },
          { id: "dysphagia", label: "Dysphagia / odynophagia / trismus" }, { id: "dental", label: "Dental / tonsillar source" }, { id: "fever", label: "Fever / systemic sepsis" }
        ],
        danger: [
          { id: "airway", label: "Stridor / drooling / respiratory distress / rapidly expanding swelling" },
          { id: "mediastinal", label: "Chest pain / surgical crepitus / mediastinal spread" }, { id: "sepsis", label: "Septic shock" }
        ],
        assess: function (sel) {
          if (has(sel, "airway")) return airwayEmergency("Deep neck space infection with airway compromise (Ludwig's / parapharyngeal)", ["CT neck/chest once the airway is safe; surgical drainage + definitive airway together - early tracheostomy under local may be needed."]);
          if (anyOf(sel, ["mediastinal", "sepsis"])) return { emergency: true, ladder: 5, catg: "Deep neck infection with mediastinal spread / sepsis (descending mediastinitis)",
            sc: "Emergency surgical drainage (neck ± thorax) + source control; CT neck/chest.", ref: "Emergency ENT / maxillofacial + thoracic surgery + critical care.", abx: { firstLine: [{ drug: "Piperacillin-tazobactam", dose: "4.5 g", route: "IV q6h" }, { drug: "+ Vancomycin", dose: "15-20 mg/kg", route: "IV q8-12h", note: "MRSA cover in septic / mediastinal spread" }], alt: [{ drug: "Meropenem", dose: "1 g", route: "IV q8h", note: "+ Vancomycin" }, { drug: "add Clindamycin", dose: "900 mg", route: "IV q8h", note: "toxin suppression in streptococcal / necrotising disease" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric broad-spectrum - surgery is the priority, antibiotics adjunctive; adjust to local antibiogram/ICMR, cultures, renal function & allergy." }, mgmt: ["IV broad-spectrum antibiotics per local protocol/ICMR; resuscitate; ICU.", "Descending mediastinitis is highly lethal - do not underestimate a 'neck abscess' with chest signs."] };
          return { emergency: true, ladder: 4, catg: "Deep neck space infection - needs drainage",
            sc: "Contrast CT neck; surgical drainage of the collection is the definitive treatment; protect the airway throughout.", ref: "Urgent ENT / maxillofacial; admit.", abx: { firstLine: [{ drug: "Amoxicillin-clavulanate", dose: "1.2 g", route: "IV q8h", note: "aerobic + anaerobic oral flora" }, { drug: "or Ceftriaxone + Metronidazole", dose: "2 g / 500 mg", route: "IV daily / q8h" }], alt: [{ drug: "Clindamycin", dose: "600 mg", route: "IV q8h", note: "penicillin allergy; ± Ceftriaxone for Gram-negative cover" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric ADJUNCT to drainage - adjust to local antibiogram/ICMR, cultures, renal function & allergy." }, mgmt: ["IV broad-spectrum antibiotics (aerobic + anaerobic) per local antibiogram/ICMR as an ADJUNCT to drainage.", "Treat the dental / tonsillar source; a phlegmon may need admission + antibiotics before it organises into a drainable collection."] };
        }
      },
      /* ───────────── Post-tonsillectomy haemorrhage (bleeding + airway emergency) ───────────── */
      {
        id: "post_tonsillectomy", name: "Post-tonsillectomy bleed",
        q: [
          { id: "primary", label: "Primary bleed (< 24 h of surgery)" }, { id: "secondary", label: "Secondary bleed (day 5-10)" },
          { id: "clot", label: "Clot / slough on the tonsil bed" }, { id: "spitting", label: "Frequent swallowing / spitting blood (esp. child)" }, { id: "infection", label: "Halitosis / pain / fever (infected bed)" }
        ],
        danger: [
          { id: "active", label: "Active brisk bleeding from the fossa" },
          { id: "shock", label: "Tachycardia / pallor / hypotension (occult swallowed blood)" }, { id: "airway", label: "Aspiration / airway compromise" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["active", "shock", "airway"])) return { emergency: true, ladder: 5, catg: "⚠ Post-tonsillectomy HAEMORRHAGE - active / unstable",
            sc: "IMMEDIATE: sit up, spit not swallow, ice/pressure; resuscitate (large-bore IV, group & save, correct coagulopathy); keep NBM; ENT to arrest the bleed under GA. If airway soiling - secure the airway first with anaesthesia.", ref: "Emergency ENT + anaesthesia NOW.", mgmt: ["Children swallow blood silently - tachycardia + pallor may be the ONLY sign of major loss; do not be reassured by an 'empty' mouth.", "Antibiotics are NOT the treatment for the bleed; secondary bleeds are often infective and antibiotics may help the source, but bleeding control comes first."] };
          return { emergency: false, ladder: 3, catg: "Post-tonsillectomy bleed - herald / settled",
            sc: "ADMIT and observe even if bleeding has stopped - a herald bleed can precede catastrophic haemorrhage; keep NBM, IV access, group & save; ENT review.", ref: "Urgent ENT; admit - do NOT discharge from ED.", abx: { firstLine: [{ drug: "Amoxicillin-clavulanate", dose: "1.2 g", route: "IV q8h", note: "infected tonsillar bed in secondary (day 5-10) bleeds; oral 625 mg TID when tolerating" }], alt: [{ drug: "Clindamycin", dose: "600 mg", route: "IV q8h", note: "penicillin allergy" }, { drug: "or Metronidazole", dose: "500 mg", route: "IV q8h", note: "add for anaerobic cover" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric for the infective source of a secondary bleed - bleeding control / observation is primary; adjust to local antibiogram/ICMR, cultures, renal function & allergy." }, mgmt: ["NEVER send a post-tonsillectomy bleed home from the ED, even a small one that stopped.", "Secondary bleeds (day 5-10) are usually infective - antibiotics per local protocol may reduce the bleed source.", "Do not disturb an adherent clot on the fossa outside theatre."] };
        }
      },
      /* ───────────────────── Acute rhinosinusitis ───────────────────── */
      {
        id: "rhinosinusitis", name: "Acute rhinosinusitis",
        q: [
          { id: "facialpain", label: "Facial pain / pressure (worse bending forward)" }, { id: "purulent", label: "Purulent nasal discharge" },
          { id: "block", label: "Nasal blockage / anosmia" }, { id: "fever", label: "Fever" },
          { id: "persistent", label: "> 10 days or double-worsening" }, { id: "dental", label: "Dental origin (upper molar)" }
        ],
        danger: [
          { id: "orbital", label: "Periorbital swelling / proptosis / painful or restricted eye movement / reduced vision" },
          { id: "intracranial", label: "Severe frontal headache / altered sensorium / focal neuro signs / meningism" }
        ],
        assess: function (sel) {
          if (has(sel, "orbital")) return { emergency: true, ladder: 5, catg: "⚠ Orbital complication of sinusitis (orbital cellulitis / subperiosteal abscess)",
            sc: "URGENT contrast CT orbits/sinuses; drainage of an orbital / subperiosteal abscess + sinus source control if confirmed.", ref: "Emergency ENT + OPHTHALMOLOGY co-management (± neurosurgery); admit.", abx: { firstLine: [{ drug: "Ceftriaxone", dose: "2 g", route: "IV q12h" }, { drug: "+ Metronidazole", dose: "500 mg", route: "IV q8h", note: "anaerobic cover" }, { drug: "+ Vancomycin", dose: "15-20 mg/kg", route: "IV q8-12h", note: "MRSA cover" }], alt: [{ drug: "Piperacillin-tazobactam", dose: "4.5 g", route: "IV q6-8h", note: "+ Vancomycin" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - sight-threatening; drainage of abscess is key; adjust to local antibiogram/ICMR, cultures, renal function & allergy." }, mgmt: ["Admit for IV broad-spectrum antibiotics per local protocol/ICMR immediately - sight- and life-threatening.", "Co-managed: Ophthalmology assesses/monitors the eye (colour vision, RAPD, acuity), ENT drains the sinus source.", "Restricted/painful eye movement or proptosis = post-septal - this is NOT simple preseptal swelling."] };
          if (has(sel, "intracranial")) return { emergency: true, ladder: 5, catg: "⚠ Intracranial complication of sinusitis (abscess / cavernous sinus thrombosis)",
            sc: "Urgent contrast CT/MRI brain + sinuses; neurosurgical drainage if a collection is present.", ref: "Emergency ENT + neurosurgery; admit.", abx: { firstLine: [{ drug: "Ceftriaxone", dose: "2 g", route: "IV q12h", note: "CNS penetration" }, { drug: "+ Metronidazole", dose: "500 mg", route: "IV q8h", note: "anaerobic cover" }, { drug: "+ Vancomycin", dose: "15-20 mg/kg", route: "IV q8-12h", note: "MRSA cover" }], alt: [{ drug: "Meropenem", dose: "2 g", route: "IV q8h", note: "+ Vancomycin; broad CNS cover" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - prolonged CNS-penetrating therapy; drainage of any collection is key; adjust to local antibiogram/ICMR, cultures, renal function & allergy." }, mgmt: ["IV antibiotics with CNS penetration per local protocol/ICMR now.", "A frontal 'Pott's puffy tumour' or new neuro signs on top of sinusitis is intracranial spread."] };
          if ((has(sel, "persistent") && has(sel, "purulent")) || (has(sel, "purulent") && has(sel, "fever") && has(sel, "facialpain"))) return { emergency: false, ladder: 2, catg: "Likely acute BACTERIAL rhinosinusitis",
            sc: "No procedure; ENT if recurrent / complicated / needs drainage.", ref: "Review; ENT for chronic or complicated disease.", abx: { firstLine: [{ drug: "Amoxicillin-clavulanate", dose: "875/125 mg", route: "PO BID ×5-7 d", note: "first-line for acute bacterial rhinosinusitis" }, { drug: "or Amoxicillin", dose: "1 g", route: "PO TID", note: "high-dose where resistance is low" }], alt: [{ drug: "Doxycycline", dose: "100 mg", route: "PO BID" }, { drug: "or Levofloxacin", dose: "500 mg", route: "PO daily", note: "penicillin allergy" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - reserve for genuine bacterial features; adjust to local antibiogram/ICMR, cultures & allergy." }, mgmt: ["Oral antibiotic reasonable when bacterial (> 10 days or double-worsening WITH purulence + fever + facial pain) - per local guidance.", "Add intranasal steroid, saline irrigation, analgesia; consider a dental source for unilateral upper-molar pain."] };
          return { emergency: false, ladder: 0, catg: "Acute rhinosinusitis - likely viral",
            sc: "No procedure.", ref: "Safety-net specifically for orbital / intracranial red flags.", mgmt: ["Symptomatic care (analgesia, saline, intranasal steroid) - antibiotics are usually NOT needed in the first 10 days; most cases are viral.", "Antibiotics only for genuine bacterial features or complications."] };
        }
      },
      /* ───────────── Epistaxis (source control; antibiotics usually N/A) ───────────── */
      {
        id: "epistaxis", name: "Epistaxis",
        q: [
          { id: "anterior", label: "Anterior bleed (visible Little's-area point)" }, { id: "posterior", label: "Posterior bleed (down the throat / both nares)" },
          { id: "anticoag", label: "On anticoagulant / antiplatelet / bleeding disorder" }, { id: "recurrent", label: "Recurrent / uncontrolled hypertension" }
        ],
        danger: [
          { id: "unstable", label: "Haemodynamic instability / large-volume bleed" },
          { id: "uncontrolled", label: "Ongoing despite ≥ 15 min correct first aid / packing" }, { id: "airway", label: "Aspiration / airway compromise" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["unstable", "airway"]) || (has(sel, "posterior") && has(sel, "uncontrolled"))) return { emergency: true, ladder: 5, catg: "Uncontrolled / posterior epistaxis - emergency",
            sc: "Resuscitate (ABC, IV access, group & save, correct coagulopathy); posterior pack / balloon; may need endoscopic sphenopalatine artery ligation or embolisation.", ref: "Emergency ENT now.", mgmt: ["Antibiotics are NOT the treatment - this is bleeding control. Reverse anticoagulation per protocol.", "Prophylactic antibiotics only while a pack is in situ, per local policy (toxic-shock risk)."] };
          if (has(sel, "uncontrolled") || has(sel, "posterior")) return { emergency: false, ladder: 1, catg: "Epistaxis needing local intervention",
            sc: "Correct first aid (firm pinch of the SOFT nose 10-15 min, lean forward); topical vasoconstrictor; cautery (silver nitrate) of a visible anterior vessel, or an anterior pack if it continues.", ref: "ENT if it persists after packing or is posterior.", mgmt: ["Antibiotics generally NOT indicated; consider prophylaxis only if a pack stays > 48 h, per local policy.", "Check and correct clotting and blood pressure; do not cauterise both sides of the septum (perforation)."] };
          return { emergency: false, ladder: 0, catg: "Simple anterior epistaxis - first aid",
            sc: "Firm continuous pinch of the soft part of the nose for 10-15 min, sit forward; cautery if a discrete bleeding point is seen.", ref: "Safety-net; ENT for recurrent or heavy bleeds.", mgmt: ["Antibiotics are NOT indicated.", "Review anticoagulants / antiplatelets and blood pressure; consider a unilateral persistent bleed in an adult from an NP mass (rare)."] };
        }
      },
      /* ───────────── Foreign body - ear / nose / aerodigestive ───────────── */
      {
        id: "foreign_body", name: "Foreign body (ear/nose/throat)",
        q: [
          { id: "ear_fb", label: "Ear-canal foreign body" }, { id: "nasal_fb", label: "Nasal foreign body (unilateral foul discharge?)" },
          { id: "swallowed", label: "Swallowed / oesophageal FB (coin, food bolus)" }, { id: "organic", label: "Organic / live insect / vegetable (swells)" }, { id: "sharp", label: "Sharp / long object or multiple magnets" }
        ],
        danger: [
          { id: "airway", label: "Choking / stridor / drooling / respiratory distress (airway FB)" },
          { id: "battery", label: "BUTTON / DISC BATTERY in nose, ear or oesophagus" }, { id: "oeso_saliva", label: "Drooling / cannot swallow saliva (oesophageal obstruction)" }
        ],
        assess: function (sel) {
          if (has(sel, "airway")) return { emergency: true, ladder: 5, catg: "⚠ Airway foreign body",
            sc: "IMMEDIATE: if choking and unable to breathe/cough → back blows then abdominal thrusts (chest thrusts / back blows in infants) - do NOT do a blind finger sweep. If partial (stridor but breathing), keep the patient calm and upright and go straight to theatre for removal (rigid bronchoscopy / laryngoscopy).", ref: "Emergency ENT + anaesthesia NOW.", mgmt: ["Do NOT try to grab a visible FB if it risks pushing it deeper or converting a partial to a complete obstruction.", "Keep a child calm on the parent's lap; distress worsens obstruction. Antibiotics are not the issue."] };
          if (has(sel, "battery")) return { emergency: true, ladder: 4, catg: "⚠ Button / disc battery - corrosive emergency, REMOVE NOW",
            sc: "Time-critical: liquefactive necrosis begins within hours - urgent removal (theatre / endoscopy). Nasal battery: remove immediately. Oesophageal battery: emergency endoscopic removal.", ref: "Emergency ENT / paediatric surgery / GI now.", mgmt: ["A button battery is the most time-critical FB - do NOT wait for a routine list or 'watch and wait'.", "Do NOT irrigate a nasal battery or give food/drink with an oesophageal one - septal / oesophageal perforation and fistula risk.", "Antibiotics are not the issue - removal is."] };
          if (has(sel, "oeso_saliva") || (has(sel, "swallowed") && has(sel, "sharp"))) return { emergency: true, ladder: 4, catg: "Oesophageal foreign body / bolus - needs urgent removal",
            sc: "Keep NBM; urgent endoscopic removal - sharp objects, multiple magnets, or inability to swallow saliva cannot wait; aspiration + perforation risk.", ref: "Urgent ENT / GI / surgery.", mgmt: ["Sharp objects, batteries, multiple magnets and complete obstruction → remove urgently.", "A smooth object that has passed into the stomach in an asymptomatic patient may be observed.", "Antibiotics only if perforation / mediastinitis is suspected."] };
          if (has(sel, "swallowed")) return { emergency: false, ladder: 0, catg: "Ingested foreign body - asymptomatic",
            sc: "X-ray to locate / confirm it is not a battery or magnet; observe if smooth, small and beyond the oesophagus.", ref: "ENT / GI / surgery if it lodges, is sharp, or symptoms develop.", mgmt: ["Always exclude a button battery and multiple magnets - those change everything.", "Antibiotics are not indicated for a simple ingested FB."] };
          return { emergency: false, ladder: 0, catg: "Ear / nasal foreign body - removal",
            sc: "Removal under good light / microscope; immobilise a live insect first (e.g. with oil / topical local anaesthetic) before removal; ONE careful attempt.", ref: "ENT if the attempt fails, the child is uncooperative, or the FB lies against the drum.", mgmt: ["Antibiotics are NOT indicated - this is a removal problem, not an infection.", "Do NOT irrigate if the object is organic (it swells) or could be a battery.", "A child with unilateral foul nasal discharge has a nasal FB until proven otherwise."] };
        }
      }
    ]
  };

  window.SMD_WS_ENGINES = window.SMD_WS_ENGINES || {};
  window.SMD_WS_ENGINES.ent = ENT;
})();
