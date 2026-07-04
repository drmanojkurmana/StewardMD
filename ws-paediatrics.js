/* StewardMD — Paediatrics specialty engine.
   ---------------------------------------------------------------------------
   Registers into window.SMD_WS_ENGINES.paediatrics, consumed by workspaces.js. A
   LIGHTWEIGHT specialty pathway — NOT the (adult) Internal Medicine engine and NOT
   a diagnosis generator. For each syndrome it collects focused findings + danger
   signs and returns a conservative MANAGEMENT DECISION: the antibiotic-need level
   (0 none → 5 emergency referral), whether SOURCE CONTROL / a procedure is required,
   and the referral/escalation. Actual drug choice AND ALL DOSING are deferred — in
   paediatrics every dose is weight/age-based and MUST be taken from the paediatric
   formulary / local protocol; antibiotic choice per local guidance / ICMR. No drug
   name, no dose, and NO adult regimen is ever implied here.

   The core value is RED-FLAG TRIAGE — the paediatric "traffic light" idea
   (appearance · work of breathing · circulation / hydration) — and separating the
   self-limiting VIRAL illness (antibiotics NOT indicated) from the child who needs
   urgent escalation. When in doubt, escalate. Any toxic, poorly-perfused, dehydrated
   or apnoeic child, and ANY unwell infant < 3 months, is treated as high-risk.

   Paediatrics is its own domain — this engine never marks conditions as "shared"
   with the adult Internal Medicine engine; escalation is to the paediatric team / PICU.

   Advisory only. Verify against local protocol, weight/age, and the individual child. */
(function () {
  "use strict";
  // ladder index → matches ABX/management ladder in workspaces.js
  // 0 none/supportive · 1 topical/local · 2 oral · 3 IV/admission · 4 urgent procedure/source control · 5 emergency referral
  function has(sel, id) { return sel && sel.has && sel.has(id); }
  function anyOf(sel, ids) { for (var i = 0; i < ids.length; i++) if (has(sel, ids[i])) return true; return false; }

  // Shared paediatric sepsis result — any red flag in a febrile child.
  function sepsisEmergency(catg, extra) {
    return { emergency: true, ladder: 5, catg: catg,
      sc: "Immediate IV/IO access; take cultures if it does not delay treatment; give empirical antibiotics WITHOUT delay; fluid resuscitation and oxygen per the paediatric sepsis pathway.",
      ref: "Emergency paediatric team + PICU escalation NOW.",
      mgmt: (["Empirical antibiotics — choice per local guidance / ICMR; ALL dosing weight-based per paediatric formulary / local protocol.", "Do NOT wait for LP, imaging or investigations before giving antibiotics in the shocked / toxic child.", "Reassess appearance, work of breathing and circulation frequently; escalate early."]).concat(extra || []) };
  }

  // Shared paediatric airway emergency (croup / upper-airway obstruction).
  function airwayEmergency(catg, extra) {
    return { emergency: true, ladder: 5, catg: catg,
      sc: "Do NOT distress or examine the throat, do not lie the child flat, do not cannulate if the airway is threatened — keep the child calm on the parent's lap. Secure the airway in a controlled setting with senior anaesthesia + ENT/paediatrics.",
      ref: "Emergency paediatric + anaesthesia / PICU escalation NOW.",
      mgmt: (["Humidified oxygen as tolerated; nebulised adrenaline and steroid per local protocol (weight-based dosing per paediatric formulary).", "Antibiotics do NOT treat viral croup — reserve for suspected bacterial airway infection, per local guidance / ICMR, only after the airway is secured."]).concat(extra || []) };
  }

  var PAEDS = {
    id: "paediatrics",
    name: "Paediatrics",
    syndromes: [
      /* ───────────────────── Febrile child (fever without source) ───────────────────── */
      {
        id: "febrile_child", name: "Febrile child (fever without obvious source)",
        q: [
          { id: "source", label: "Obvious localising source (e.g. ear, throat, urine, chest)" },
          { id: "well", label: "Well appearing / active / feeding normally" },
          { id: "highfever", label: "Fever ≥ 39 °C" },
          { id: "poorfeed", label: "Poor feeding / reduced wet nappies" },
          { id: "immuno", label: "Immunocompromise / unimmunised / comorbidity" }
        ],
        danger: [
          { id: "young_infant", label: "Age < 3 months with fever" },
          { id: "toxic", label: "Toxic / mottled / very lethargic appearance" },
          { id: "nonblanching", label: "Non-blanching (purpuric) rash" },
          { id: "caprefill", label: "Prolonged capillary refill / cold peripheries / poor perfusion" },
          { id: "lethargy", label: "Reduced consciousness / difficult to rouse / weak high-pitched cry" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["young_infant", "toxic", "nonblanching", "caprefill", "lethargy"]))
            return sepsisEmergency("⚠ Febrile child with RED FLAG — treat as paediatric sepsis until proven otherwise",
              ["ANY red flag (age < 3 months, toxic look, non-blanching rash, prolonged cap refill, or lethargy) = full septic screen + sepsis pathway.", "A well-looking infant < 3 months with fever still needs urgent paediatric assessment and a septic work-up."]);
          if (has(sel, "immuno") || (has(sel, "highfever") && has(sel, "poorfeed")))
            return { emergency: false, ladder: 3, catg: "Febrile child — intermediate risk / needs paediatric assessment",
              sc: "Septic screen (bloods, urine ± CXR/LP) per age and clinical picture; observe.", ref: "Paediatric review; admit for observation if immunocompromised, unimmunised or not improving.", mgmt: ["Do NOT give blind antibiotics to a well child — but have a low threshold to treat and admit the high-risk child; choice per local guidance / ICMR, dosing weight-based per paediatric formulary.", "Safety-net thoroughly and reassess appearance, work of breathing and hydration."] };
          if (has(sel, "source"))
            return { emergency: false, ladder: 2, catg: "Febrile child with an identified source",
              sc: "No procedure — treat the identified source; open the relevant syndrome pathway.", ref: "Follow-up per the source; escalate if the child becomes toxic or dehydrated.", mgmt: ["Manage the specific source (viral sources need supportive care only, not antibiotics).", "Antibiotic choice, if indicated, per local guidance / ICMR; ALL dosing weight-based per paediatric formulary / local protocol."] };
          return { emergency: false, ladder: 0, catg: "Well febrile child, no source — likely self-limiting viral illness",
            sc: "No procedure.", ref: "Safety-net (return if drowsy, non-blanching rash, poor feeding, breathing difficulty, cold hands/feet, or fever > 5 days); review if not settling.", mgmt: ["Supportive care — fluids, antipyresis for distress, observation. Antibiotics are NOT indicated for a well child without a bacterial source.", "Give clear return advice describing the red flags to the carer."] };
        }
      },
      /* ───────────────────── Suspected meningitis / meningococcal sepsis ───────────────────── */
      {
        id: "suspected_meningitis_sepsis", name: "Suspected meningitis / meningococcal sepsis",
        q: [
          { id: "fever", label: "Fever" }, { id: "irritable", label: "Irritability / inconsolable / lethargy" },
          { id: "headache_photo", label: "Headache / photophobia (older child)" }, { id: "vomiting", label: "Vomiting" }
        ],
        danger: [
          { id: "nonblanching", label: "Non-blanching (purpuric / petechial) rash" },
          { id: "neck_stiff", label: "Neck stiffness / Kernig / Brudzinski" },
          { id: "fontanelle", label: "Bulging fontanelle (infant)" },
          { id: "altered", label: "Altered consciousness / seizures / focal neuro signs" },
          { id: "shock", label: "Shock — mottled, cold, prolonged cap refill, hypotension (late)" }
        ],
        assess: function () {
          return sepsisEmergency("⚠ Suspected meningitis / meningococcal sepsis — medical emergency",
            ["Do NOT delay antibiotics for LP, CT or any imaging — give empirical antibiotics IMMEDIATELY (choice per local guidance / ICMR, weight-based dosing per paediatric formulary).", "Consider steroid and, in meningococcal disease, isolation + public-health notification + contact prophylaxis per local protocol.", "PICU escalation; watch for raised ICP and shock."]);
        }
      },
      /* ───────────────────── Acute otitis media (paediatric) ───────────────────── */
      {
        id: "acute_otitis_media_paeds", name: "Acute otitis media (child)",
        q: [
          { id: "otalgia", label: "Ear pain / ear-tugging / irritability" }, { id: "fever", label: "Fever" },
          { id: "under2_bilat", label: "Age < 2 with BILATERAL infection" }, { id: "otorrhoea", label: "Otorrhoea / discharge (perforation)" },
          { id: "systemic", label: "Systemically unwell / not settling at 48–72 h" }, { id: "immuno", label: "Immunocompromise / comorbidity" }
        ],
        danger: [
          { id: "mastoid", label: "Post-auricular swelling / protruding pinna (mastoiditis)" },
          { id: "intracranial", label: "Neck stiffness / altered consciousness / facial palsy / neuro signs" },
          { id: "toxic", label: "Toxic / poorly perfused / dehydrated child" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["intracranial", "toxic"]))
            return { emergency: true, ladder: 5, catg: "AOM with suspected complication / systemically unwell child",
              sc: "Urgent assessment ± imaging (CT/MRI); ENT for possible source control (myringotomy ± mastoid surgery).", ref: "Emergency paediatric + ENT review; admit / PICU escalation if toxic.", mgmt: ["Admit for IV antibiotics per local guidance / ICMR (weight-based dosing per paediatric formulary).", "This is a complication of AOM — do not treat as a simple ear infection."] };
          if (has(sel, "mastoid"))
            return { emergency: true, ladder: 4, catg: "AOM with suspected acute mastoiditis",
              sc: "Imaging (CT temporal bone); ENT for myringotomy ± drainage of subperiosteal abscess.", ref: "Urgent ENT + paediatrics; admit.", mgmt: ["IV antibiotics per local guidance / ICMR, dosing weight-based per paediatric formulary; de-escalate on culture."] };
          if (anyOf(sel, ["under2_bilat", "otorrhoea", "systemic", "immuno"]))
            return { emergency: false, ladder: 2, catg: "AOM likely to benefit from antibiotics",
              sc: "No procedure — treat medically; ENT if recurrent perforation / persistent discharge.", ref: "Review at 48–72 h; escalate if the child becomes toxic or dehydrated.", mgmt: ["Antibiotics reasonable (age < 2 with bilateral disease, otorrhoea, systemic upset or immunocompromise) — choice per local guidance / ICMR, ALL dosing weight-based per paediatric formulary.", "Analgesia (weight-based) is the mainstay for pain."] };
          return { emergency: false, ladder: 0, catg: "Uncomplicated AOM — mostly viral / self-limiting",
            sc: "No procedure.", ref: "Safety-net; review if no improvement at 48–72 h or discharge / mastoid signs develop.", mgmt: ["Analgesia + watchful waiting — antibiotics usually NOT needed and can be safely deferred 48–72 h in the well child.", "Antibiotics only if it fails to settle or red flags appear (age < 2 bilateral, otorrhoea, systemic upset)."] };
        }
      },
      /* ───────────────────── Tonsillitis / pharyngitis (paediatric) ───────────────────── */
      {
        id: "tonsillitis_pharyngitis_paeds", name: "Tonsillitis / pharyngitis (child)",
        q: [
          { id: "exudate", label: "Tonsillar exudate / swelling" }, { id: "fever", label: "Fever ≥ 38 °C" },
          { id: "nodes", label: "Tender anterior cervical nodes" }, { id: "nocough", label: "Absence of cough / coryza" },
          { id: "poorintake", label: "Reduced oral intake / dehydration risk" }
        ],
        danger: [
          { id: "airway", label: "Stridor / drooling / muffled voice / respiratory distress" },
          { id: "unilateral", label: "Unilateral bulge / trismus / unable to swallow saliva (quinsy)" },
          { id: "toxic", label: "Toxic / dehydrated child unable to maintain hydration" }
        ],
        assess: function (sel) {
          if (has(sel, "airway"))
            return airwayEmergency("Sore throat with airway compromise — exclude epiglottitis / deep-neck abscess",
              ["Do NOT attempt throat examination if stridor or drooling."]);
          if (has(sel, "unilateral"))
            return { emergency: false, ladder: 4, catg: "Peritonsillar abscess (quinsy)",
              sc: "ENT for needle aspiration / incision & drainage — drainage is the primary treatment.", ref: "Urgent ENT + paediatrics; watch the airway.", mgmt: ["IV antibiotics per local guidance / ICMR (weight-based dosing) as adjunct to drainage; IV fluids; analgesia."] };
          if (has(sel, "toxic"))
            return { emergency: false, ladder: 3, catg: "Tonsillitis with dehydration / unable to maintain intake",
              sc: "No procedure — assess hydration.", ref: "Paediatric review; admit for IV fluids if not tolerating oral intake.", mgmt: ["Admit for IV fluids and analgesia; antibiotics only if bacterial features, per local guidance / ICMR (weight-based dosing).", "AVOID aminopenicillins if glandular fever is possible."] };
          var centor = (has(sel, "exudate") ? 1 : 0) + (has(sel, "fever") ? 1 : 0) + (has(sel, "nodes") ? 1 : 0) + (has(sel, "nocough") ? 1 : 0);
          if (centor >= 3)
            return { emergency: false, ladder: 2, catg: "Possible bacterial (group A strep) tonsillitis",
              sc: "No procedure.", ref: "Review at 48 h; ENT if recurrent or peritonsillar spread.", mgmt: ["Antibiotic reasonable with high bacterial score — penicillin-class per local guidance / ICMR; ALL dosing weight-based per paediatric formulary. AVOID aminopenicillins if glandular fever possible.", "Analgesia + fluids; safety-net for airway symptoms and dehydration."] };
          return { emergency: false, ladder: 0, catg: "Sore throat — likely viral / self-limiting",
            sc: "No procedure.", ref: "Safety-net; review if unable to swallow, unilateral swelling, drooling or airway symptoms.", mgmt: ["Analgesia + fluids — antibiotics usually NOT needed (most childhood pharyngitis is viral).", "Antibiotics only if clear bacterial features; escalate for airway compromise or dehydration."] };
        }
      },
      /* ───────────────────── Bronchiolitis ───────────────────── */
      {
        id: "bronchiolitis", name: "Bronchiolitis (< 2 yr)",
        q: [
          { id: "coryza_wheeze", label: "Coryza then wheeze / crackles (age < 2 yr)" },
          { id: "feeding", label: "Reduced feeding (< 50–75% normal)" },
          { id: "risk", label: "Risk factor (prematurity, chronic lung/heart disease, age < 3 months)" }
        ],
        danger: [
          { id: "resp_distress", label: "Marked recession / grunting / respiratory distress" },
          { id: "hypoxia", label: "Hypoxia / cyanosis / persistently low SpO₂" },
          { id: "apnoea", label: "Apnoea (observed or reported)" },
          { id: "exhaustion", label: "Exhaustion / poor perfusion / severe dehydration" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["apnoea", "exhaustion", "hypoxia"]))
            return { emergency: true, ladder: 5, catg: "⚠ Severe bronchiolitis — impending respiratory failure",
              sc: "Oxygen / high-flow or CPAP as needed; support feeding (NG or IV fluids); prepare for respiratory support.", ref: "Emergency paediatric + PICU escalation NOW.", mgmt: ["Supportive care is the treatment — antibiotics are NOT indicated for viral bronchiolitis (add only if secondary bacterial infection is suspected, per local guidance / ICMR).", "Apnoea / hypoxia / exhaustion = high dependency; monitor closely."] };
          if (anyOf(sel, ["resp_distress", "feeding", "risk"]))
            return { emergency: false, ladder: 3, catg: "Bronchiolitis needing admission for support",
              sc: "Admit for oxygen if hypoxic, feeding support (NG / IV fluids), and monitoring for apnoea.", ref: "Paediatric admission; lower threshold if age < 3 months or risk factors.", mgmt: ["SUPPORTIVE care only — no antibiotics, no routine bronchodilators/steroids for typical bronchiolitis.", "Watch for the red flags: apnoea, rising work of breathing, hypoxia, exhaustion — escalate if they appear."] };
          return { emergency: false, ladder: 0, catg: "Mild bronchiolitis — manage at home",
            sc: "No procedure.", ref: "Safety-net (return for reduced feeding < 50–75%, increased work of breathing, apnoea, or fewer wet nappies); review as needed.", mgmt: ["Supportive care — small frequent feeds, nasal saline, observation. Antibiotics are NOT indicated.", "Give clear carer red-flag advice and review the young / at-risk infant early."] };
        }
      },
      /* ───────────────────── Croup (laryngotracheobronchitis) ───────────────────── */
      {
        id: "croup", name: "Croup (laryngotracheobronchitis)",
        q: [
          { id: "barking", label: "Barking cough / hoarse voice" }, { id: "coryza", label: "Preceding coryza / low-grade fever" },
          { id: "stridor_active", label: "Stridor with crying / activity only" }
        ],
        danger: [
          { id: "stridor_rest", label: "Stridor AT REST" },
          { id: "distress", label: "Marked recession / respiratory distress / agitation" },
          { id: "cyanosis", label: "Cyanosis / drowsiness / exhaustion (pre-terminal)" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["stridor_rest", "distress", "cyanosis"]))
            return airwayEmergency("⚠ Severe croup — airway emergency (stridor at rest / distress)",
              ["Keep the child calm on the parent's lap — agitation worsens obstruction.", "Steroid is the mainstay; give nebulised adrenaline for severe obstruction (weight-based dosing per paediatric formulary); prepare for a difficult airway."]);
          return { emergency: false, ladder: 0, catg: "Mild croup — viral, self-limiting",
            sc: "No procedure — keep the child calm and comfortable.", ref: "Safety-net (return for stridor at rest, respiratory distress, drooling, or drowsiness); review if worsening.", mgmt: ["A single dose of oral corticosteroid is the mainstay of treatment (dose weight-based per paediatric formulary / local protocol).", "Antibiotics are NOT indicated — croup is viral. Antipyresis / fluids as needed; escalate for any stridor at rest."] };
        }
      },
      /* ───────────────────── Community-acquired pneumonia (paediatric) ───────────────────── */
      {
        id: "community_pneumonia_paeds", name: "Community-acquired pneumonia (child)",
        q: [
          { id: "fever", label: "Fever" }, { id: "tachypnoea", label: "Tachypnoea (age-adjusted)" },
          { id: "focal", label: "Focal chest signs / crackles / bronchial breathing" }, { id: "cough", label: "Cough / increased work of breathing" },
          { id: "poorfeed", label: "Reduced feeding / oral intake" }
        ],
        danger: [
          { id: "hypoxia", label: "Hypoxia / cyanosis / severe respiratory distress" },
          { id: "toxic", label: "Toxic / poorly perfused / shocked" },
          { id: "effusion", label: "Suspected empyema / large effusion / not responding" },
          { id: "apnoea", label: "Apnoea / grunting / exhaustion (esp. infant)" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["toxic", "apnoea"]))
            return sepsisEmergency("⚠ Severe pneumonia with sepsis / impending respiratory failure",
              ["Oxygen and fluid resuscitation; empirical IV antibiotics without delay (choice per local guidance / ICMR, weight-based dosing).", "PICU escalation for respiratory failure or shock."]);
          if (anyOf(sel, ["hypoxia", "effusion"]))
            return { emergency: true, ladder: 4, catg: "Severe pneumonia (hypoxic) ± effusion / empyema",
              sc: "Oxygen; chest imaging / USS; ENT/surgical or paediatric respiratory input for drainage if empyema.", ref: "Urgent paediatric review; admit; escalate if deteriorating.", mgmt: ["Admit for IV antibiotics per local guidance / ICMR (ALL dosing weight-based per paediatric formulary); support feeding.", "Drainage / source control if a significant effusion or empyema is confirmed."] };
          if (has(sel, "poorfeed") || (has(sel, "tachypnoea") && has(sel, "focal")))
            return { emergency: false, ladder: 3, catg: "Pneumonia needing admission",
              sc: "Chest imaging if diagnosis unclear; assess oxygenation and hydration.", ref: "Paediatric admission — lower threshold in infants / reduced feeding.", mgmt: ["IV antibiotics if not tolerating oral intake or moderately unwell — choice per local guidance / ICMR, dosing weight-based per paediatric formulary.", "Monitor SpO₂, work of breathing and hydration; escalate if hypoxic or toxic."] };
          if (anyOf(sel, ["tachypnoea", "focal"]))
            return { emergency: false, ladder: 2, catg: "Community pneumonia — well enough for oral therapy",
              sc: "No procedure; chest imaging only if diagnosis unclear or not improving.", ref: "Review at 48 h; escalate if increased work of breathing, poor feeding or hypoxia develop.", mgmt: ["Oral antibiotics for the well child able to feed — choice per local guidance / ICMR; ALL dosing weight-based per paediatric formulary.", "Safety-net; note many young children have viral LRTI — reassess if not improving."] };
          return { emergency: false, ladder: 0, catg: "Likely viral lower respiratory tract infection",
            sc: "No procedure.", ref: "Safety-net for tachypnoea, hypoxia, poor feeding or focal signs; review if not settling.", mgmt: ["Supportive care — antibiotics NOT indicated without features of bacterial pneumonia.", "Reassess if focal signs, hypoxia or systemic upset develop."] };
        }
      },
      /* ───────────────────── Urinary tract infection (paediatric) ───────────────────── */
      {
        id: "uti_paeds", name: "Urinary tract infection (child)",
        q: [
          { id: "fever", label: "Fever (esp. young child without a source)" }, { id: "dysuria", label: "Dysuria / frequency (older child)" },
          { id: "vomiting", label: "Vomiting / poor feeding" }, { id: "irritable", label: "Irritability / lethargy / offensive urine (infant)" },
          { id: "recurrent", label: "Recurrent UTI / known renal tract abnormality" }
        ],
        danger: [
          { id: "toxic", label: "Toxic / septic appearance" },
          { id: "dehydrated", label: "Significant dehydration / not tolerating oral intake" },
          { id: "young_infant", label: "Age < 3 months with fever" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["toxic", "young_infant"]))
            return sepsisEmergency("⚠ Febrile UTI in a toxic child / young infant — treat as sepsis",
              ["Obtain a urine sample (clean-catch / SPA / catheter per protocol) but do NOT delay IV antibiotics in the toxic or very young child (choice per local guidance / ICMR, weight-based dosing).", "Arrange renal tract imaging and paediatric follow-up per local protocol."]);
          if (has(sel, "dehydrated"))
            return { emergency: false, ladder: 3, catg: "UTI with dehydration / unable to tolerate oral therapy",
              sc: "Obtain urine culture before antibiotics; assess hydration.", ref: "Paediatric review; admit for IV fluids + antibiotics if not tolerating oral intake.", mgmt: ["Admit for IV antibiotics + rehydration — choice per local guidance / ICMR; ALL dosing weight-based per paediatric formulary.", "Arrange urine culture and imaging / paediatric follow-up per local protocol."] };
          return { emergency: false, ladder: 2, catg: "UTI in a well / stable child — treat orally",
            sc: "Send urine culture BEFORE starting antibiotics; no procedure.", ref: "Review at 48 h; arrange imaging (USS ± further studies) and paediatric follow-up per local protocol, esp. if < 6 months, atypical or recurrent.", mgmt: ["Oral antibiotics for the well child — empirical choice per local guidance / ICMR, refined on culture; ALL dosing weight-based per paediatric formulary / local protocol.", "Always confirm with culture; escalate if the child becomes toxic or dehydrated."] };
        }
      }
    ]
  };

  window.SMD_WS_ENGINES = window.SMD_WS_ENGINES || {};
  window.SMD_WS_ENGINES.paediatrics = PAEDS;
})();
