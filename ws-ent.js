/* StewardMD — ENT (otorhinolaryngology) specialty engine.
   ---------------------------------------------------------------------------
   Registers into window.SMD_WS_ENGINES.ent, consumed by workspaces.js. A
   LIGHTWEIGHT specialty pathway — NOT the Internal Medicine engine and NOT a
   diagnosis generator. For each syndrome it collects focused findings + danger
   signs and returns a conservative MANAGEMENT DECISION: the antibiotic-need
   level (0 none → 5 emergency referral), whether SOURCE CONTROL / a procedure
   (drainage, cautery, airway) is required, and the referral/escalation. Actual
   drug choice is deferred to the existing stewardship engine / Drug Index /
   local antibiogram + ICMR (never prescribed here).

   The recurring ENT theme is that MOST acute presentations are viral / self-
   limiting (antibiotics NOT indicated) — the engine's job is to separate those
   from the true red flags: airway-threatening infections (epiglottitis, deep
   neck space, Ludwig's), suppurative complications needing drainage (quinsy,
   mastoiditis, subperiosteal abscess) and orbital / intracranial spread from
   sinusitis or otitis. Orbital / intracranial complications are co-managed —
   the notes flag Ophthalmology / Neurosurgery involvement.

   Advisory only. Verify against local protocol, imaging, and the individual patient. */
(function () {
  "use strict";
  // ladder index → matches ABX/management ladder in workspaces.js
  // 0 none · 1 topical/local · 2 oral · 3 IV/admission · 4 urgent drainage/source control · 5 emergency referral
  function has(sel, id) { return sel && sel.has && sel.has(id); }
  function anyOf(sel, ids) { for (var i = 0; i < ids.length; i++) if (has(sel, ids[i])) return true; return false; }

  // Shared airway emergency result (do not distress / do not lie flat).
  function airwayEmergency(catg, extra) {
    return { emergency: true, ladder: 5, catg: catg,
      sc: "SECURE THE AIRWAY FIRST — controlled setting (theatre/ICU) with senior anaesthesia + ENT. Do NOT examine the throat, cannulate or lie the patient flat if airway is threatened.",
      ref: "Emergency ENT + anaesthesia / critical care NOW.",
      mgmt: (["IV antibiotics per local protocol/ICMR — only AFTER the airway is controlled.", "Keep the patient calm, sitting up, humidified O₂; avoid sedation."]).concat(extra || []) };
  }

  var ENT = {
    id: "ent",
    name: "ENT",
    syndromes: [
      /* ───────────────────── Acute otitis media ───────────────────── */
      {
        id: "aom", name: "Acute otitis media",
        q: [
          { id: "otalgia", label: "Ear pain / otalgia" }, { id: "systemic", label: "Fever / systemic upset" },
          { id: "otorrhoea", label: "Otorrhoea / perforation / discharge" }, { id: "under2_bilat", label: "Age < 2 &/or bilateral" },
          { id: "recurrent", label: "Recurrent / grommets" }, { id: "immuno", label: "Immunocompromise" }
        ],
        danger: [
          { id: "mastoid", label: "Post-auricular swelling / protruding pinna (mastoiditis)" },
          { id: "facial_palsy", label: "Facial nerve palsy" },
          { id: "intracranial", label: "Neck stiffness / altered sensorium / neuro signs" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["intracranial", "facial_palsy"])) return { emergency: true, ladder: 5, catg: "AOM with suspected intracranial / facial-nerve complication",
            sc: "Urgent imaging (CT/MRI); source control per ENT (myringotomy ± mastoid surgery).", ref: "Emergency ENT + neurosurgery review.", mgmt: ["Admit for IV antibiotics per local protocol/ICMR.", "Complications of AOM — do not treat as a simple ear infection."] };
          if (has(sel, "mastoid")) return { emergency: true, ladder: 4, catg: "AOM with suspected acute mastoiditis",
            sc: "Image (CT temporal bone); myringotomy ± cortical mastoidectomy / drain subperiosteal abscess.", ref: "Urgent ENT; admit.", mgmt: ["IV antibiotics per local antibiogram/ICMR, then de-escalate."] };
          if (anyOf(sel, ["otorrhoea", "under2_bilat", "immuno"]) || has(sel, "systemic")) return { emergency: false, ladder: 2, catg: "AOM likely needing antibiotics",
            sc: "No procedure — treat medically; ENT if recurrent perforation / persistent discharge.", ref: "GP/ENT follow-up; review at 48–72 h.", mgmt: ["Oral antibiotic indicated (otorrhoea, age < 2, bilateral < 2 y, systemic upset or immunocompromise) — choose per local guidance.", "Analgesia is the mainstay for pain."] };
          return { emergency: false, ladder: 0, catg: "Uncomplicated AOM — likely viral / self-limiting",
            sc: "No procedure.", ref: "Safety-net; review if no improvement at 48–72 h or ear discharge / mastoid signs develop.", mgmt: ["Analgesia + watchful waiting — antibiotics usually NOT needed and can be deferred 48–72 h.", "Antibiotics if it fails to settle or red flags appear."] };
        }
      },
      /* ───────────────────── Otitis externa ───────────────────── */
      {
        id: "otitis_externa", name: "Otitis externa",
        q: [
          { id: "canal", label: "Canal pain / itch / tragal tenderness" }, { id: "discharge", label: "Discharge / debris" },
          { id: "swelling", label: "Canal oedema (drops won't reach)" }, { id: "water", label: "Water exposure / swimmer" },
          { id: "diabetes_elderly", label: "Diabetes / immunocompromise / elderly" }, { id: "pinna", label: "Spreading pinna / peri-auricular cellulitis" }
        ],
        danger: [
          { id: "granulation", label: "Granulation in canal + severe deep pain (necrotising OE)" },
          { id: "facial_palsy", label: "Facial / lower cranial nerve palsy" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["granulation", "facial_palsy"]) || (has(sel, "diabetes_elderly") && has(sel, "canal") && has(sel, "swelling"))) return { emergency: anyOf(sel, ["granulation", "facial_palsy"]), ladder: 4, catg: "Suspected necrotising (malignant) otitis externa",
            sc: "Aural microsuction / biopsy of granulation; imaging (CT/MRI, nuclear scan) to assess skull base.", ref: "Urgent ENT; admit — high-risk in diabetes/immunocompromise.", mgmt: ["Systemic anti-pseudomonal antibiotics (prolonged course) per local antibiogram/ICMR + strict glycaemic control.", "Not a simple OE — osteomyelitis of the skull base."] };
          if (has(sel, "pinna")) return { emergency: false, ladder: 2, catg: "Otitis externa with spreading cellulitis",
            sc: "Aural toilet / microsuction; wick if canal occluded.", ref: "ENT if not settling.", mgmt: ["Add oral anti-staph/strep cover for the spreading cellulitis per local guidance; continue topical treatment."] };
          return { emergency: false, ladder: 1, catg: "Uncomplicated otitis externa",
            sc: "Aural toilet / microsuction; insert an ear wick if the canal is oedematous so drops reach.", ref: "Review if not improving; ENT for recurrent / non-resolving.", mgmt: ["Topical antibiotic ± steroid drops are first-line — systemic antibiotics usually NOT needed.", "Keep the ear dry; analgesia."] };
        }
      },
      /* ───────────────────── Sore throat / tonsillitis ───────────────────── */
      {
        id: "sore_throat", name: "Sore throat / tonsillitis",
        q: [
          { id: "exudate", label: "Tonsillar exudate / swelling" }, { id: "fever", label: "Fever ≥ 38 °C" },
          { id: "nodes", label: "Tender anterior cervical nodes" }, { id: "nocough", label: "Absence of cough" },
          { id: "unilateral", label: "Unilateral bulge / uvular deviation / trismus" }, { id: "immuno", label: "Immunocompromise" }
        ],
        danger: [
          { id: "airway", label: "Stridor / drooling / muffled voice / respiratory distress" },
          { id: "quinsy_severe", label: "Severe trismus + unable to swallow saliva" }
        ],
        assess: function (sel) {
          if (has(sel, "airway")) return airwayEmergency("Sore throat with airway compromise — exclude epiglottitis / deep-neck abscess", ["Do not attempt tonsil/throat examination if stridor or drooling."]);
          if (has(sel, "unilateral") || has(sel, "quinsy_severe")) return { emergency: false, ladder: 4, catg: "Peritonsillar abscess (quinsy)",
            sc: "Needle aspiration / incision & drainage of the abscess is the primary treatment.", ref: "Urgent ENT for drainage.", mgmt: ["IV antibiotics + steroids per local protocol as adjunct to drainage; analgesia, IV fluids.", "Watch the airway."] };
          var centor = (has(sel, "exudate") ? 1 : 0) + (has(sel, "fever") ? 1 : 0) + (has(sel, "nodes") ? 1 : 0) + (has(sel, "nocough") ? 1 : 0);
          if (centor >= 3 || has(sel, "immuno")) return { emergency: false, ladder: 2, catg: "Likely bacterial (group A strep) tonsillitis",
            sc: "No procedure.", ref: "Review at 48 h; ENT if recurrent or peritonsillar spread.", mgmt: ["Oral antibiotic reasonable (high Centor/FeverPAIN or immunocompromise) — penicillin-class per local guidance; AVOID amoxicillin if glandular fever possible.", "Analgesia + fluids."] };
          return { emergency: false, ladder: 0, catg: "Sore throat — likely viral / self-limiting",
            sc: "No procedure.", ref: "Safety-net; review if unable to swallow, unilateral swelling or airway symptoms.", mgmt: ["Analgesia + fluids — antibiotics usually NOT needed (low Centor / FeverPAIN).", "Antibiotics only if bacterial features or high risk."] };
        }
      },
      /* ───────────────────── Acute rhinosinusitis ───────────────────── */
      {
        id: "rhinosinusitis", name: "Acute rhinosinusitis",
        q: [
          { id: "facialpain", label: "Facial pain / pressure" }, { id: "purulent", label: "Purulent nasal discharge" },
          { id: "block", label: "Nasal blockage" }, { id: "fever", label: "Fever" },
          { id: "persistent", label: "> 10 days or double-worsening" }, { id: "dental", label: "Dental origin (upper molar)" }
        ],
        danger: [
          { id: "orbital", label: "Periorbital swelling / proptosis / painful or restricted eye movement / reduced vision" },
          { id: "intracranial", label: "Severe frontal headache / altered sensorium / focal neuro signs / meningism" }
        ],
        assess: function (sel) {
          if (has(sel, "orbital")) return { emergency: true, ladder: 5, catg: "⚠ Orbital complication of sinusitis (orbital cellulitis / abscess)",
            sc: "URGENT contrast CT orbits/sinuses; drainage of orbital / subperiosteal abscess + sinus source control if confirmed.", ref: "Emergency ENT + OPHTHALMOLOGY co-management (± neurosurgery). Admit.", mgmt: ["Admit for IV broad-spectrum antibiotics per local protocol/ICMR immediately — sight- and life-threatening.", "This is a co-managed condition: Ophthalmology assesses the eye, ENT drains the sinus source."] };
          if (has(sel, "intracranial")) return { emergency: true, ladder: 5, catg: "⚠ Intracranial complication of sinusitis",
            sc: "Urgent contrast CT/MRI brain + sinuses; neurosurgical drainage if collection.", ref: "Emergency ENT + neurosurgery. Admit.", mgmt: ["IV antibiotics with CNS penetration per local protocol/ICMR now."] };
          if ((has(sel, "persistent") && has(sel, "purulent")) || (has(sel, "purulent") && has(sel, "fever") && has(sel, "facialpain"))) return { emergency: false, ladder: 2, catg: "Likely acute bacterial rhinosinusitis",
            sc: "No procedure; ENT if recurrent / complications / needs drainage.", ref: "Review; ENT for chronic or complicated disease.", mgmt: ["Oral antibiotic reasonable when bacterial (> 10 days or double-worsening + purulence + fever) — per local guidance; add intranasal steroid, saline, analgesia."] };
          return { emergency: false, ladder: 0, catg: "Acute rhinosinusitis — likely viral",
            sc: "No procedure.", ref: "Safety-net for orbital / intracranial red flags.", mgmt: ["Symptomatic care (analgesia, saline, intranasal steroid) — antibiotics usually NOT needed in the first 10 days.", "Antibiotics only for bacterial features or complications."] };
        }
      },
      /* ───────────── Deep neck space infection / Ludwig's angina ───────────── */
      {
        id: "deep_neck", name: "Deep neck space infection",
        q: [
          { id: "floor_mouth", label: "Floor-of-mouth swelling / tongue elevation (Ludwig's)" }, { id: "neck", label: "Neck swelling / torticollis" },
          { id: "dysphagia", label: "Dysphagia / odynophagia / trismus" }, { id: "dental", label: "Dental / tonsillar source" }, { id: "fever", label: "Fever / systemic sepsis" }
        ],
        danger: [
          { id: "airway", label: "Stridor / drooling / respiratory distress / rapid swelling" },
          { id: "mediastinal", label: "Chest pain / crepitus / mediastinal spread" }, { id: "sepsis", label: "Septic shock" }
        ],
        assess: function (sel) {
          if (has(sel, "airway")) return airwayEmergency("Deep neck space infection with airway compromise (Ludwig's / parapharyngeal)", ["Urgent CT neck/chest once safe; surgical drainage + secure airway together."]);
          if (anyOf(sel, ["mediastinal", "sepsis"])) return { emergency: true, ladder: 5, catg: "Deep neck infection with mediastinal spread / sepsis",
            sc: "Emergency surgical drainage (neck ± thorax) + source control; CT neck/chest.", ref: "Emergency ENT / maxillofacial + surgery + critical care.", mgmt: ["IV broad-spectrum antibiotics per local protocol/ICMR; resuscitate; ICU."] };
          return { emergency: true, ladder: 4, catg: "Deep neck space infection — needs drainage",
            sc: "CT neck with contrast; surgical drainage of the collection is the definitive treatment; protect the airway.", ref: "Urgent ENT / maxillofacial; admit.", mgmt: ["IV broad-spectrum antibiotics (aerobic + anaerobic) per local antibiogram/ICMR as adjunct to drainage.", "Treat the dental/tonsillar source."] };
        }
      },
      /* ───────────── Epiglottitis / supraglottitis (airway red-flag) ───────────── */
      {
        id: "epiglottitis", name: "Epiglottitis / supraglottitis",
        q: [
          { id: "rapid", label: "Rapid-onset severe sore throat + odynophagia" }, { id: "muffled", label: "Muffled 'hot-potato' voice" },
          { id: "drooling", label: "Drooling / can't swallow saliva" }, { id: "tripod", label: "Sitting forward / tripod, distressed" }, { id: "fever", label: "High fever / toxic" }
        ],
        danger: [{ id: "airway", label: "Stridor / respiratory distress / cyanosis — any = airway emergency" }],
        assess: function () { return airwayEmergency("⚠ Epiglottitis / supraglottitis — airway emergency", ["Do NOT use a tongue depressor or lie the patient flat.", "Prepare for difficult airway; ENT + anaesthesia at the bedside."]); }
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
          { id: "intracranial", label: "Neck stiffness / altered sensorium / neuro signs" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["intracranial", "facial_palsy"])) return { emergency: true, ladder: 5, catg: "Mastoiditis with intracranial / facial-nerve complication",
            sc: "Urgent contrast CT/MRI; cortical mastoidectomy ± neurosurgical drainage.", ref: "Emergency ENT + neurosurgery; admit.", mgmt: ["IV antibiotics per local protocol/ICMR immediately."] };
          if (has(sel, "abscess")) return { emergency: true, ladder: 4, catg: "Acute mastoiditis with subperiosteal abscess",
            sc: "Drain the abscess; myringotomy ± cortical mastoidectomy; CT temporal bone.", ref: "Urgent ENT; admit.", mgmt: ["IV antibiotics per local antibiogram/ICMR, de-escalate on culture."] };
          return { emergency: false, ladder: 3, catg: "Acute mastoiditis — admit",
            sc: "Image (CT temporal bone); myringotomy if intact drum; surgery if not improving.", ref: "ENT; admit.", mgmt: ["IV antibiotics per local protocol/ICMR; monitor for complications and escalate if abscess / neuro signs appear."] };
        }
      },
      /* ───────────── Epistaxis (source control, antibiotics usually N/A) ───────────── */
      {
        id: "epistaxis", name: "Epistaxis",
        q: [
          { id: "anterior", label: "Anterior bleed (visible Little's-area point)" }, { id: "posterior", label: "Posterior bleed (down the throat / both nares)" },
          { id: "anticoag", label: "On anticoagulant / antiplatelet / bleeding disorder" }, { id: "recurrent", label: "Recurrent / hypertension" }
        ],
        danger: [
          { id: "unstable", label: "Haemodynamic instability / large-volume bleed" },
          { id: "uncontrolled", label: "Ongoing despite ≥ 15 min first aid / packing" }, { id: "airway", label: "Aspiration / airway compromise" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["unstable", "airway"]) || (has(sel, "posterior") && has(sel, "uncontrolled"))) return { emergency: true, ladder: 5, catg: "Uncontrolled / posterior epistaxis — emergency",
            sc: "Resuscitate (ABC, IV access, group & save, correct coagulopathy); posterior pack / balloon; may need arterial ligation or embolisation.", ref: "Emergency ENT now.", mgmt: ["Antibiotics are NOT the treatment — this is bleeding control. Reverse anticoagulation per protocol.", "Consider prophylactic antibiotics only while nasal packing is in situ, per local policy."] };
          if (has(sel, "uncontrolled") || has(sel, "posterior")) return { emergency: false, ladder: 1, catg: "Epistaxis needing local intervention",
            sc: "First aid (firm pinch of the soft nose 15 min, lean forward); cautery (silver nitrate) of a visible anterior vessel, or anterior nasal pack if it continues.", ref: "ENT if bleeding persists after packing or is posterior.", mgmt: ["Antibiotics generally NOT indicated; consider prophylaxis only if a pack is left > 48 h, per local policy.", "Check/correct clotting and blood pressure."] };
          return { emergency: false, ladder: 0, catg: "Simple anterior epistaxis — first aid",
            sc: "Firm continuous pinch of the soft part of the nose for 15 min, sit forward; cautery if a bleeding point is seen.", ref: "Safety-net; ENT for recurrent bleeds.", mgmt: ["Antibiotics NOT indicated.", "Review medications (anticoagulants/antiplatelets) and blood pressure."] };
        }
      }
    ]
  };

  window.SMD_WS_ENGINES = window.SMD_WS_ENGINES || {};
  window.SMD_WS_ENGINES.ent = ENT;
})();
