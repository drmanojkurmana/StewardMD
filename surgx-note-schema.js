/* surgx-note-schema.js — SURGX · surgical note field schemas. DATA ONLY, no logic.
 * ===========================================================================
 * Five note types plus procedure-specific template deltas. Kept in code rather than fetched JSON
 * because it is small, always needed the moment Notes opens, and is read by both the renderer and
 * the (pure) completeness/extraction logic in surgx-model.js.
 *
 * TWO INDEPENDENT AXES, and confusing them is a patient-safety bug:
 *
 *   required    — the note cannot be finalised without it. A missing required field is SHOWN as
 *                 "[NOT RECORDED]", never quietly omitted.
 *   aiFillable  — whether an AI extraction may EVER write this field. `false` is a structural
 *                 refusal, not a preference: the key is dropped server-side and again client-side
 *                 whatever the model returns.
 *
 * Estimated blood loss is required:true, aiFillable:true - the AI may transcribe a number the
 * surgeon SAID, and surgx-model.numericGuard() voids it if that number is not in the transcript.
 *
 * Swab / instrument / needle counts are required:true, aiFillable:FALSE. A count is a two-person
 * physical verification with a legal weight of its own. No model, under any prompt, in any mode,
 * populates a count. Same for the specimen register, implant serial numbers, and the finalising
 * surgeon's name.
 *
 * phi:true marks a field that carries patient identifiers. Those fields are excluded from any
 * telemetry, never written to the shared progress ledger, and encrypted at rest by surgx-store.js.
 */
(function () {
  "use strict";

  // f(key, label, opts)
  function f(k, label, o) {
    o = o || {};
    return {
      k: k, label: label,
      type: o.type || "textarea",
      required: o.required === true,
      aiFillable: o.aiFillable !== false,
      phi: o.phi === true,
      rows: o.rows || (o.type === "text" ? 1 : 2),
      ph: o.ph || "",
      help: o.help || "",
      // type:"choice" renders as a row of tap targets. The stored value is still a plain string, so
      // completeness, provenance and the exported note text treat it exactly like a typed field.
      options: o.options instanceof Array ? o.options.slice() : null
    };
  }
  function sec(title, fields, o) {
    return { title: title, fields: fields, note: (o && o.note) || "" };
  }

  // Identification is PHI and is never AI-filled: a mis-transcribed patient identifier on an
  // operative note is a wrong-patient record.
  function identification(extra) {
    return sec("Identification", [
      f("patientRef", "Patient reference / UHID", { type: "text", required: true, aiFillable: false, phi: true, ph: "Initials or hospital number" }),
      f("age", "Age", { type: "text", aiFillable: false, phi: true }),
      f("sex", "Sex", { type: "text", aiFillable: false, phi: true }),
      f("date", "Date", { type: "text", required: true, aiFillable: false, ph: "e.g. 24 Aug 2026" })
    ].concat(extra || []), { note: "Identifiers stay on this device. Never AI-filled." });
  }

  /* WHO Surgical Safety Checklist (2009), recorded in the operative note. Every item is a team act
   * performed in the room, so every item is aiFillable:false: a model must never be able to state
   * that a time out happened. "Not done" is a valid, recordable answer; a checklist that can only
   * say "Done" teaches people to tick it. */
  var WHO_DONE = ["Done", "Not done"];
  var WHO_DONE_NA = ["Done", "Not applicable", "Not done"];
  function whoChecklist() {
    function c(k, label, req, opts, help) {
      return f(k, label, { type: "choice", options: opts || WHO_DONE, required: !!req, aiFillable: false, help: help || "" });
    }
    return sec("WHO Surgical Safety Checklist", [
      c("whoSignInIdentity", "Sign in: identity, site, procedure and consent confirmed with the patient", true),
      c("whoSignInSite", "Sign in: site marked", false, WHO_DONE_NA),
      c("whoSignInAnaes", "Sign in: anaesthesia safety check complete, pulse oximeter on and working", false),
      c("whoSignInRisk", "Sign in: allergy, difficult airway and blood loss risk reviewed", false, null,
        "Blood loss risk: more than 500 mL in an adult, or 7 mL/kg in a child, needs access and blood planned."),
      c("whoTimeOutTeam", "Time out: team introduced by name and role", false),
      c("whoTimeOut", "Time out: patient, site and procedure confirmed aloud", true),
      c("whoTimeOutAbx", "Time out: antibiotic prophylaxis given within the last 60 minutes", false, WHO_DONE_NA),
      c("whoTimeOutEvents", "Time out: critical steps, duration, blood loss and equipment concerns discussed", false),
      c("whoTimeOutImaging", "Time out: essential imaging displayed", false, WHO_DONE_NA),
      c("whoSignOut", "Sign out: procedure recorded, counts correct, specimens labelled", true),
      c("whoSignOutRecovery", "Sign out: equipment problems and key recovery concerns handed over", false)
    ], { note: "A team check done in the room. Never AI-filled." });
  }

  /* Clavien-Dindo grade. The app's Calculators module has the full classifier (clavien_dindo); this
   * records the grade the surgeon assigned. Grading is a judgement, so it is never AI-filled. */
  var CLAVIEN = ["None", "I", "II", "IIIa", "IIIb", "IVa", "IVb", "V"];
  function clavien() {
    return f("clavienDindo", "Complication grade (Clavien-Dindo)", {
      type: "choice", options: CLAVIEN, aiFillable: false,
      help: "I: any deviation without specific treatment. II: drugs, blood or TPN. III: intervention (a: no GA, b: under GA). IV: organ failure needing ICU (a: single, b: multi). V: death."
    });
  }

  var SCHEMAS = {

    /* ── Pre-operative note ─────────────────────────────────────────────────── */
    preop: {
      id: "preop", title: "Pre-operative note", icon: "event_upcoming",
      sections: [
        identification(),
        sec("Assessment", [
          f("diagnosis", "Working diagnosis", { required: true, rows: 2 }),
          f("indication", "Indication for surgery", { required: true, rows: 2 }),
          f("plannedProcedure", "Planned procedure", { required: true, rows: 2 }),
          f("side", "Side / site marked", { type: "text", required: true, aiFillable: false, help: "Site marking is a physical check, not a dictated one." })
        ]),
        sec("Fitness", [
          f("comorbidities", "Comorbidities", { rows: 3 }),
          f("medications", "Current medications", { rows: 3 }),
          f("allergies", "Allergies / ADR", { required: true, type: "text", ph: "or 'Nil known'" }),
          f("anticoagulation", "Anticoagulation / antiplatelet plan", { rows: 2 }),
          f("asa", "ASA grade", { type: "text", ph: "I-V" }),
          f("investigations", "Relevant investigations", { rows: 3 }),
          f("fasting", "Fasting status", { type: "text" })
        ]),
        sec("Plan", [
          f("anaesthesiaPlan", "Anaesthesia plan", { rows: 2 }),
          f("bloodProducts", "Blood products arranged", { type: "text" }),
          f("prophylaxis", "Antibiotic / VTE prophylaxis", { rows: 2 }),
          f("consent", "Consent taken (risks discussed)", { required: true, aiFillable: false, rows: 3, help: "Consent is an act, not a transcription. Record it yourself." }),
          f("preopNotes", "Other notes", { rows: 2 })
        ])
      ]
    },

    /* ── Operative note ─────────────────────────────────────────────────────── */
    operative: {
      id: "operative", title: "Operative note", icon: "content_cut",
      sections: [
        identification(),
        sec("Team and diagnosis", [
          f("preopDx", "Pre-operative diagnosis", { required: true, rows: 2 }),
          f("postopDx", "Post-operative diagnosis", { required: true, rows: 2 }),
          f("procedure", "Procedure performed", { required: true, rows: 2 }),
          f("surgeon", "Surgeon", { type: "text", required: true, aiFillable: false }),
          f("assistants", "Assistants", { type: "text", aiFillable: false }),
          f("anaesthetist", "Anaesthetist", { type: "text", aiFillable: false }),
          f("anaesthesia", "Anaesthesia", { type: "text", ph: "e.g. GA with ETT" }),
          f("incision", "Incision / approach", { rows: 2 })
        ]),
        sec("Operative detail", [
          f("findings", "Findings", { required: true, rows: 5, help: "Only what was seen. Never inferred." }),
          f("procedureDetail", "Procedure in detail", { required: true, rows: 8 }),
          f("closure", "Closure", { required: true, rows: 3 })
        ], { note: "The AI structures what you dictated. It never adds a finding you did not state." }),
        sec("Accounting", [
          f("specimens", "Specimens sent", { required: true, aiFillable: false, rows: 2, help: "Specimen register is a physical hand-off. Enter it yourself, or write 'None'." }),
          f("implants", "Implants / prostheses (type, size, serial)", { aiFillable: false, rows: 2 }),
          f("drains", "Drains (type, site, number)", { required: true, rows: 2, ph: "or 'None'" }),
          f("ebl", "Estimated blood loss", { type: "text", required: true, ph: "e.g. 150 mL" }),
          f("fluids", "Fluids / blood given", { type: "text" }),
          f("counts", "Swab, instrument and needle counts", { type: "text", required: true, aiFillable: false, help: "A count is a two-person physical check. No AI writes this field." }),
          f("complications", "Intra-operative complications", { required: true, rows: 2, ph: "or 'None'" })
        ]),
        whoChecklist(),
        sec("Plan", [
          f("postopPlan", "Post-operative instructions", { required: true, rows: 4 }),
          f("antibiotics", "Antibiotics", { rows: 2 }),
          f("followupPlan", "Follow-up / review", { rows: 2 })
        ])
      ]
    },

    /* ── Post-operative note ────────────────────────────────────────────────── */
    postop: {
      id: "postop", title: "Post-operative note", icon: "monitor_heart",
      sections: [
        identification([f("pod", "Post-operative day", { type: "text", required: true })]),
        sec("Progress", [
          f("procedureRef", "Procedure performed", { type: "text", required: true }),
          f("subjective", "Subjective", { required: true, rows: 3 }),
          f("vitals", "Observations", { rows: 2, ph: "BP, pulse, temp, SpO2, urine output" }),
          f("examination", "Examination", { required: true, rows: 4 }),
          f("wound", "Wound / drains", { required: true, rows: 2 }),
          f("investigationsPost", "Investigations", { rows: 3 })
        ]),
        sec("Assessment and plan", [
          f("assessment", "Assessment", { required: true, rows: 3 }),
          f("plan", "Plan", { required: true, rows: 4 }),
          f("escalation", "Escalation / who was informed", { rows: 2 }),
          clavien()
        ])
      ]
    },

    /* ── Progress note ──────────────────────────────────────────────────────── */
    progress: {
      id: "progress", title: "Progress note", icon: "clinical_notes",
      sections: [
        identification(),
        sec("SOAP", [
          f("subjective", "Subjective", { required: true, rows: 3 }),
          f("objective", "Objective", { required: true, rows: 4 }),
          f("assessment", "Assessment", { required: true, rows: 3 }),
          f("plan", "Plan", { required: true, rows: 4 })
        ])
      ]
    },

    /* ── Discharge summary ──────────────────────────────────────────────────── */
    /* Field set deliberately mirrors icu.js DISCHARGE_FIELDS so a surgical discharge reads the same
     * as a medical one and neither drifts from the other. */
    discharge: {
      id: "discharge", title: "Discharge summary", icon: "assignment_turned_in",
      sections: [
        identification([
          f("admitDate", "Admission date", { type: "text", required: true, aiFillable: false }),
          f("dischargeDate", "Discharge date", { type: "text", required: true, aiFillable: false })
        ]),
        sec("Episode", [
          f("finalDx", "Final diagnosis", { required: true, rows: 2 }),
          f("secondaryDx", "Secondary diagnoses / comorbidities", { rows: 3 }),
          f("allergies", "Allergies / ADR", { type: "text", required: true, ph: "or 'Nil known'" }),
          f("reason", "Reason for admission", { required: true, rows: 3 }),
          f("proceduresDone", "Procedures / interventions", { required: true, rows: 3 }),
          f("course", "Hospital course", { required: true, rows: 6 }),
          f("investigationsKey", "Key investigations", { rows: 4 }),
          f("pendingResults", "Results / cultures pending", { rows: 2 }),
          f("histopathology", "Histopathology", { rows: 2, ph: "or 'Awaited'" }),
          clavien()
        ]),
        sec("Discharge", [
          f("condition", "Condition at discharge", { required: true, rows: 3 }),
          f("meds", "Discharge medications", { required: true, aiFillable: false, rows: 6, help: "Medication list is prescribing. Enter and check it yourself." }),
          f("woundCare", "Wound / drain care", { rows: 3 }),
          f("followup", "Follow-up", { required: true, rows: 2 }),
          f("advice", "Advice and red flags for the patient", { required: true, rows: 4 }),
          f("doctor", "Discharging doctor", { type: "text", required: true, aiFillable: false })
        ])
      ]
    }
  };

  /* ── procedure-specific templates ────────────────────────────────────────────
   * A DELTA over a base type, never a separate note. Two things only: extra fields appended to a
   * named section, and prefilled text a surgeon edits rather than types. Authoring a whole parallel
   * operative note per procedure is how templates drift out of step with the base one. */
  var TEMPLATES = {
    "appendicectomy": {
      base: "operative", title: "Appendicectomy",
      prefill: { procedure: "Open / laparoscopic appendicectomy", incision: "" },
      extra: {
        "Operative detail": [
          f("appendixAppearance", "Appendix appearance", { rows: 2, ph: "Inflamed / gangrenous / perforated / normal" }),
          f("peritonealFluid", "Peritoneal fluid", { type: "text", ph: "Nil / serous / purulent / faeculent" }),
          f("stumpManagement", "Stump management", { type: "text" })
        ]
      }
    },
    "lap-cholecystectomy": {
      base: "operative", title: "Laparoscopic cholecystectomy",
      prefill: { procedure: "Laparoscopic cholecystectomy", anaesthesia: "GA with ETT" },
      extra: {
        "Operative detail": [
          f("cvs", "Critical View of Safety achieved", { type: "text", required: true, ph: "Yes / No - if No, state what was done instead" }),
          f("portPlacement", "Port placement", { rows: 2 }),
          f("gbAppearance", "Gallbladder appearance", { rows: 2 }),
          f("bileSpillage", "Bile / stone spillage", { type: "text", ph: "or 'None'" }),
          f("conversion", "Conversion to open", { type: "text", ph: "or 'No'" })
        ]
      }
    },
    "hernia-repair": {
      base: "operative", title: "Inguinal hernia repair",
      prefill: { procedure: "Open inguinal hernia repair (Lichtenstein)" },
      extra: {
        "Operative detail": [
          f("herniaType", "Hernia type", { type: "text", ph: "Direct / indirect / femoral / pantaloon" }),
          f("sacManagement", "Sac management", { type: "text" }),
          f("meshDetail", "Mesh (type, size, fixation)", { rows: 2 }),
          f("cordStructures", "Cord structures identified and preserved", { type: "text" })
        ]
      }
    },
    "laparotomy": {
      base: "operative", title: "Exploratory laparotomy",
      prefill: { procedure: "Exploratory laparotomy", incision: "Midline laparotomy" },
      extra: {
        "Operative detail": [
          f("systematicExam", "Systematic exploration findings", { required: true, rows: 5 }),
          f("contamination", "Contamination grade", { type: "text", ph: "Clean / clean-contaminated / contaminated / dirty" }),
          f("bowelViability", "Bowel viability", { rows: 2 }),
          f("anastomosis", "Anastomosis / stoma", { rows: 2 }),
          f("lavage", "Peritoneal lavage", { type: "text" })
        ]
      }
    },
    "abscess-drainage": {
      base: "operative", title: "Abscess incision and drainage",
      prefill: { procedure: "Incision and drainage of abscess" },
      extra: {
        "Operative detail": [
          f("abscessSite", "Site and size", { type: "text", required: true }),
          f("pusCharacter", "Pus character and volume", { type: "text" }),
          f("cultureSent", "Pus sent for culture", { type: "text", aiFillable: false, ph: "Yes / No" }),
          f("cavityManagement", "Cavity management / packing", { rows: 2 })
        ]
      }
    },
    /* ── specialty templates (generated from the specialty content authoring, 2026-11-04) ── */
    "below-knee-amputation": {
      base: "operative", title: "Below-knee amputation",
      prefill: {"procedure": "Below-knee amputation, long posterior flap"},
      extra: {
        "Operative detail": [
          f("sideConfirmed", "Side confirmed and marked", {"type": "text", "required": true, "aiFillable": false, "ph": "Left / Right, confirmed with patient"}),
          f("boneLevels", "Tibial and fibular cut levels", {"type": "text", "required": true, "aiFillable": false, "ph": "Tibia cm below joint line; fibula cm shorter"}),
          f("tissueViability", "Muscle and skin viability at the level", {"type": "textarea", "aiFillable": true, "rows": 2}),
          f("tourniquet", "Tourniquet use and time", {"type": "text", "aiFillable": false, "ph": "Not used / used without exsanguination, minutes"}),
          f("specimenSent", "Limb and bone margin sent", {"type": "text", "aiFillable": false, "ph": "Histology / bone for culture"})
        ]
      }
    },
    "burr-hole-csdh": {
      base: "operative", title: "Burr hole evacuation of chronic subdural haematoma",
      prefill: {"procedure": "Burr hole evacuation of chronic subdural haematoma"},
      extra: {
        "Operative detail": [
          f("preopGcsPupils", "Pre-op GCS (E V M) and pupils", {"type": "text", "required": true, "aiFillable": false, "ph": "E_ V_ M_, pupils L _ mm R _ mm, reactive?"}),
          f("sideBurrHoles", "Side and number of burr holes", {"type": "text", "required": true, "aiFillable": false, "ph": "Left / right / bilateral; frontal, parietal"}),
          f("fluidCharacter", "Haematoma fluid character and pressure", {"type": "text", "required": false, "aiFillable": true, "ph": "Motor-oil / mixed / clotted; under pressure?"}),
          f("drainDetail", "Drain type, position and plan", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Subdural / subgaleal / none (reason); bag level; removal plan"}),
          f("antithromboticPlan", "Antithrombotic restart plan", {"type": "text", "required": false, "aiFillable": true, "help": "Agreed date and indication, or 'not on antithrombotics'"})
        ]
      }
    },
    "chest-drain-insertion": {
      base: "operative", title: "Chest drain insertion",
      prefill: {"procedure": "Intercostal chest drain insertion", "anaesthesia": "Local anaesthetic"},
      extra: {
        "Operative detail": [
          f("sideSite", "Side and site (space, line)", {"type": "text", "required": true, "aiFillable": false, "ph": "Right, 5th space, mid-axillary line"}),
          f("ultrasoundGuided", "Ultrasound guidance", {"type": "text", "required": true, "aiFillable": false, "ph": "Real-time / site marked / not used (reason)"}),
          f("drainTechnique", "Technique and drain size", {"type": "text", "required": true, "aiFillable": true, "ph": "Seldinger 12 Fr / blunt dissection 28 Fr"}),
          f("guidewireRemoved", "Guidewire removed and seen intact", {"type": "text", "aiFillable": false, "ph": "Yes / not applicable"}),
          f("initialOutput", "Initial drainage (character and volume)", {"type": "text", "aiFillable": false}),
          f("positionConfirmed", "Position confirmed", {"type": "text", "aiFillable": false, "ph": "Swinging, bubbling, chest radiograph"})
        ]
      }
    },
    "evd-insertion": {
      base: "operative", title: "External ventricular drain insertion",
      prefill: {"procedure": "External ventricular drain insertion"},
      extra: {
        "Operative detail": [
          f("preopGcsPupils", "Pre-procedure GCS (E V M) and pupils", {"type": "text", "required": true, "aiFillable": false, "ph": "E_ V_ M_, pupils L _ mm R _ mm"}),
          f("sideEntry", "Side, entry point and number of passes", {"type": "text", "required": true, "aiFillable": false, "ph": "Right Kocher point, 1 pass"}),
          f("catheterDepth", "Catheter depth at skin / skull", {"type": "text", "required": true, "aiFillable": false, "ph": "cm"}),
          f("openingPressure", "Opening pressure and CSF appearance", {"type": "text", "required": true, "aiFillable": false, "ph": "cmH2O; clear / bloodstained / cloudy"}),
          f("evdLevel", "Reference level and drainage height", {"type": "text", "required": true, "aiFillable": false, "ph": "Zero at tragus; chamber at _ cmH2O; open / clamped"}),
          f("csfSent", "CSF samples sent", {"type": "text", "required": false, "aiFillable": false, "ph": "Microscopy, culture, other / none"})
        ]
      }
    },
    "femoral-embolectomy": {
      base: "operative", title: "Femoral embolectomy",
      prefill: {"procedure": "Femoral balloon catheter embolectomy"},
      extra: {
        "Operative detail": [
          f("rutherfordClass", "Pre-operative Rutherford acute class", {"type": "text", "required": true, "aiFillable": false, "ph": "I / IIa / IIb / III"}),
          f("arteriotomy", "Arteriotomy and closure", {"type": "text", "aiFillable": true, "ph": "Transverse primary / longitudinal with patch"}),
          f("catheterPasses", "Catheter passes and clot retrieved", {"type": "textarea", "aiFillable": true, "rows": 2}),
          f("completionImaging", "Completion angiography findings", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2}),
          f("fasciotomy", "Fasciotomy performed or reason not", {"type": "text", "required": true, "aiFillable": false}),
          f("embolusHistology", "Embolus sent for histology", {"type": "text", "aiFillable": false, "ph": "Yes / No"})
        ]
      }
    },
    "fess": {
      base: "operative", title: "Functional endoscopic sinus surgery",
      prefill: {"procedure": "Functional endoscopic sinus surgery"},
      extra: {
        "Operative detail": [
          f("extent", "Extent of surgery by side", {"type": "textarea", "required": true, "aiFillable": true, "rows": 3, "ph": "e.g. Left: uncinectomy, middle meatal antrostomy, anterior and posterior ethmoidectomy"}),
          f("ctLandmarks", "CT reviewed: skull base, lamina, Onodi, sphenoid, anterior ethmoidal artery", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Keros grade, dehiscences, variants"}),
          f("orbitCheck", "Orbit check at end, orbital fat seen", {"type": "text", "required": true, "aiFillable": false, "ph": "Eyes soft and equal; orbital fat yes / no"}),
          f("skullBase", "Skull base breach or CSF leak", {"type": "text", "required": true, "aiFillable": true, "ph": "None / describe and repair"}),
          f("nasalPacking", "Nasal packing and neuropatty count", {"type": "text", "required": true, "aiFillable": false, "ph": "Type, side, removal plan; patties counted out"})
        ]
      }
    },
    "hartmanns-procedure": {
      base: "operative", title: "Hartmann's procedure",
      prefill: {"procedure": "Hartmann's procedure (sigmoid colectomy, end colostomy, closure of rectal stump)", "incision": "Midline laparotomy"},
      extra: {
        "Operative detail": [
          f("contamination", "Peritoneal contamination", {"type": "text", "required": true, "aiFillable": true, "ph": "Purulent / faecal; localised / generalised", "help": "Hinchey grade if diverticular"}),
          f("leftUreter", "Left ureter identified and preserved", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes / No, and where"}),
          f("rectalStump", "Rectal stump: level, closure, marking", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Rectosigmoid junction, stapled, marked with long non-absorbable sutures"}),
          f("stomaDetail", "Stoma: type, site, height, viability", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "End colostomy, LIF, flush, pink and healthy", "help": "Viability is a physical check at the end of the operation"})
        ]
      }
    },
    "lap-perforated-duodenal-ulcer": {
      base: "operative", title: "Laparoscopic repair of perforated duodenal ulcer",
      prefill: {"procedure": "Laparoscopic omental patch repair of perforated duodenal ulcer and peritoneal lavage", "anaesthesia": "GA with ETT"},
      extra: {
        "Operative detail": [
          f("perforationSite", "Perforation: site and size", {"type": "text", "required": true, "aiFillable": true, "ph": "Anterior D1, 5 mm"}),
          f("contamination", "Contamination", {"type": "text", "required": true, "aiFillable": true, "ph": "Bilious / purulent / food; four-quadrant or localised"}),
          f("repair", "Repair technique", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Three interrupted sutures over pedicled omental patch"}),
          f("leakTest", "Leak test result", {"type": "text", "required": true, "aiFillable": false, "ph": "Air or methylene blue test negative"}),
          f("biopsy", "Biopsy taken (gastric perforation)", {"type": "text", "required": false, "aiFillable": false, "ph": "Yes / Not applicable"}),
          f("conversion", "Conversion to open", {"type": "text", "required": false, "aiFillable": true, "ph": "or 'No'"})
        ]
      }
    },
    "lap-salpingectomy": {
      base: "operative", title: "Laparoscopic salpingectomy",
      prefill: {"procedure": "Laparoscopic salpingectomy for ectopic pregnancy"},
      extra: {
        "Operative detail": [
          f("ectopicSite", "Side and site of ectopic, ruptured or not", {"type": "text", "required": true, "aiFillable": true, "ph": "Left ampullary, ruptured"}),
          f("haemoperitoneum", "Haemoperitoneum volume (mL)", {"type": "text", "required": true, "aiFillable": false}),
          f("contralateralTube", "Contralateral tube and ovaries", {"type": "text", "required": true, "aiFillable": true, "ph": "Normal / abnormal (describe)"}),
          f("procedureChoice", "Salpingectomy or salpingotomy, and reason", {"type": "text", "aiFillable": true}),
          f("antiD", "Rhesus status and anti-D", {"type": "text", "required": true, "aiFillable": false, "ph": "Rh positive / Rh negative: anti-D given"}),
          f("followUp", "Follow-up plan", {"type": "text", "aiFillable": true, "ph": "UPT at 3 weeks / serial hCG"})
        ]
      }
    },
    "loop-ileostomy": {
      base: "operative", title: "Loop ileostomy formation or closure",
      prefill: {"procedure": "Loop ileostomy (formation / closure)"},
      extra: {
        "Operative detail": [
          f("operationType", "Formation or closure", {"type": "text", "required": true, "aiFillable": true, "ph": "Formation / closure"}),
          f("stomaDetail", "Stoma: type, site, spout, viability, rod", {"type": "textarea", "required": false, "aiFillable": false, "rows": 3, "ph": "Loop ileostomy, RIF, afferent limb spouted 2 to 3 cm, pink, rod yes/no", "help": "Formation only. Viability and orientation are physical checks."}),
          f("distanceFromIcv", "Distance of loop from ileocaecal valve", {"type": "text", "required": false, "aiFillable": false, "ph": "cm"}),
          f("anastomosis", "Closure anastomosis: technique, stapled or handsewn", {"type": "textarea", "required": false, "aiFillable": true, "rows": 2, "ph": "Stapled side-to-side / handsewn single-layer", "help": "Closure only"}),
          f("leakTest", "Anastomosis checked (patency, integrity)", {"type": "text", "required": false, "aiFillable": false, "ph": "Closure only"}),
          f("woundClosure", "Fascia and skin closure", {"type": "text", "required": false, "aiFillable": true, "ph": "Fascia closed, skin purse-string"})
        ]
      }
    },
    "lscs": {
      base: "operative", title: "Lower segment caesarean section",
      prefill: {"procedure": "Lower segment caesarean section"},
      extra: {
        "Operative detail": [
          f("urgencyCategory", "Indication and urgency category", {"type": "text", "required": true, "aiFillable": true, "ph": "Indication; category 1 / 2 / 3 / 4; decision time"}),
          f("uterineIncision", "Uterine incision and any extension", {"type": "text", "required": true, "aiFillable": true, "ph": "Transverse lower segment; extensions"}),
          f("deliveryTime", "Time of delivery and method", {"type": "text", "required": true, "aiFillable": false, "ph": "hh:mm; cephalic / breech / forceps / vacuum"}),
          f("placenta", "Placenta delivery and completeness", {"type": "text", "aiFillable": true, "ph": "Controlled cord traction; complete"}),
          f("uterineClosure", "Uterine closure layers", {"type": "text", "required": true, "aiFillable": true, "ph": "Two layers, suture used"}),
          f("cordGases", "Paired cord gases", {"type": "text", "aiFillable": false, "ph": "Arterial and venous pH, base excess, or not taken"}),
          f("qbl", "Quantified blood loss (mL), weighed and measured", {"type": "text", "required": false, "aiFillable": false, "help": "Weigh swabs and measure suction. Visual estimates under-read obstetric haemorrhage."})
        ]
      }
    },
    "lumbar-discectomy-ces": {
      base: "operative", title: "Lumbar decompression for cauda equina syndrome",
      prefill: {"procedure": "Lumbar discectomy and decompression for cauda equina syndrome"},
      extra: {
        "Operative detail": [
          f("preopNeuroBladder", "Pre-op lower-limb, saddle and bladder status (with time)", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Power, saddle sensation, PVR / catheter, time of onset"}),
          f("levelConfirmed", "Level confirmed on imaging", {"type": "text", "required": true, "aiFillable": false, "ph": "L4/5 confirmed on lateral image intensifier"}),
          f("decompressionExtent", "Extent of bony decompression", {"type": "text", "required": true, "aiFillable": true, "ph": "Laminotomy / hemilaminectomy / laminectomy"}),
          f("sacFreeAtEnd", "Thecal sac and roots free at end", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes, roots mobile, no retained fragment"}),
          f("durotomy", "Dural tear and repair", {"type": "text", "required": true, "aiFillable": false, "ph": "None / tear: repair method and bed-rest plan"})
        ]
      }
    },
    "modified-radical-mastectomy": {
      base: "operative", title: "Modified radical mastectomy",
      prefill: {"procedure": "Modified radical mastectomy with level I and II axillary clearance"},
      extra: {
        "Operative detail": [
          f("marginsAssessment", "Margins (surgeon's assessment, deep and skin)", {"type": "text", "aiFillable": false, "ph": "Pectoral fascia taken; any concern about a margin"}),
          f("axillaryLevels", "Axillary levels cleared", {"type": "text", "required": true, "aiFillable": false, "ph": "Levels I and II; level III if taken"}),
          f("nervesPreserved", "Long thoracic, thoracodorsal, medial pectoral, intercostobrachial nerves", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Each: preserved / divided (reason)"}),
          f("orientationSutures", "Specimen orientation sutures", {"type": "text", "required": true, "aiFillable": false, "ph": "e.g. short superior, long lateral (state convention)"})
        ]
      }
    },
    "myringotomy-grommets": {
      base: "operative", title: "Myringotomy and grommet insertion",
      prefill: {"procedure": "Myringotomy and grommet insertion"},
      extra: {
        "Operative detail": [
          f("earsOperated", "Ear(s) operated", {"type": "text", "required": true, "aiFillable": false, "ph": "Right / left / bilateral"}),
          f("drumFindings", "Tympanic membrane and middle ear findings", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Effusion: serous / mucoid / purulent / dry; retraction"}),
          f("grommetType", "Grommet type", {"type": "text", "required": true, "aiFillable": false, "ph": "Make and type, per ear"}),
          f("incisionSite", "Myringotomy site", {"type": "text", "required": false, "aiFillable": true, "ph": "Anteroinferior quadrant"}),
          f("followUp", "Drops and follow-up", {"type": "text", "required": false, "aiFillable": true, "ph": "Drops; review with hearing test within 3 months"})
        ]
      }
    },
    "open-raaa-repair": {
      base: "operative", title: "Open repair of ruptured AAA",
      prefill: {"procedure": "Open repair of ruptured abdominal aortic aneurysm", "incision": "Midline laparotomy"},
      extra: {
        "Operative detail": [
          f("proximalControl", "Proximal control (level and method)", {"type": "text", "required": true, "aiFillable": true, "ph": "Supracoeliac / infrarenal clamp / aortic occlusion balloon"}),
          f("clampTimes", "Clamp times (suprarenal and total)", {"type": "text", "required": true, "aiFillable": false, "ph": "Suprarenal: min; total: min"}),
          f("graftDetail", "Graft type, size and lot number", {"type": "text", "required": true, "aiFillable": false, "ph": "Tube / bifurcated, size, lot"}),
          f("imaAndColon", "Inferior mesenteric artery and colon perfusion", {"type": "textarea", "aiFillable": true, "rows": 2}),
          f("limbPerfusion", "Limb perfusion at end of procedure", {"type": "text", "required": true, "aiFillable": false, "ph": "Pulses / Doppler signals, both feet"}),
          f("abdominalClosure", "Abdominal closure and retained packs", {"type": "text", "required": true, "aiFillable": false, "ph": "Primary / temporary closure; number of packs left"})
        ]
      }
    },
    "paeds-herniotomy": {
      base: "operative", title: "Paediatric herniotomy",
      prefill: {"procedure": "Inguinal herniotomy"},
      extra: {
        "Operative detail": [
          f("side", "Side and findings", {"type": "text", "required": true, "aiFillable": true, "ph": "Left / right / bilateral; sac contents"}),
          f("sacLigation", "Sac ligation level", {"type": "text", "aiFillable": true, "ph": "High ligation at internal ring"}),
          f("vasVessels", "Vas and testicular vessels identified and preserved", {"type": "text", "required": true, "aiFillable": false}),
          f("testisPosition", "Testis position at end of procedure", {"type": "text", "required": true, "aiFillable": false, "ph": "In scrotum, confirmed by palpation"}),
          f("apnoeaPlan", "Post-operative apnoea monitoring plan", {"type": "text", "aiFillable": true})
        ]
      }
    },
    "pyloromyotomy": {
      base: "operative", title: "Pyloromyotomy",
      prefill: {"procedure": "Ramstedt pyloromyotomy (open / laparoscopic)"},
      extra: {
        "Operative detail": [
          f("preopElectrolytes", "Pre-operative chloride, bicarbonate and potassium", {"type": "text", "required": true, "aiFillable": false, "ph": "Values and time of sample"}),
          f("approach", "Approach", {"type": "text", "required": true, "aiFillable": true, "ph": "Laparoscopic / open RUQ / circumumbilical"}),
          f("myotomyLength", "Myotomy extent and completeness", {"type": "textarea", "aiFillable": true, "rows": 2, "ph": "Antrum to pyloroduodenal junction; halves move independently"}),
          f("leakTest", "Mucosal leak test", {"type": "text", "required": true, "aiFillable": false, "ph": "Done: negative / positive and repaired"}),
          f("localAnaesthetic", "Local anaesthetic agent and total dose (mg/kg)", {"type": "text", "aiFillable": false, "help": "Combined surgeon and anaesthetist total"})
        ]
      }
    },
    "right-hemicolectomy": {
      base: "operative", title: "Right hemicolectomy",
      prefill: {"procedure": "Laparoscopic / open right hemicolectomy"},
      extra: {
        "Operative detail": [
          f("stagingFindings", "Staging findings (liver, peritoneum, tumour)", {"type": "textarea", "required": true, "aiFillable": true, "rows": 3, "ph": "Metastases seen / none; tumour fixity or invasion"}),
          f("highTie", "Level of vascular ligation", {"type": "text", "required": true, "aiFillable": false, "ph": "Ileocolic at SMV origin; right colic; right branch of middle colic"}),
          f("mesocolicPlane", "Mesocolic plane and specimen integrity", {"type": "text", "aiFillable": false, "ph": "Intact mesocolic envelope / defects"}),
          f("anastomosis", "Anastomosis type", {"type": "text", "required": true, "aiFillable": false, "ph": "Stapled side-to-side / handsewn; intra- or extracorporeal; perfusion checked"}),
          f("extractionSite", "Extraction site and wound protection", {"type": "text", "aiFillable": false, "ph": "Site; wound protector used"})
        ]
      }
    },
    "small-bowel-resection": {
      base: "operative", title: "Small bowel resection",
      prefill: {"procedure": "Small bowel resection with anastomosis", "incision": "Midline laparotomy"},
      extra: {
        "Operative detail": [
          f("indicationFinding", "Finding and segment resected", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Strangulated ileum from band, 40 cm resected, 60 cm from ICV"}),
          f("anastomosis", "Anastomosis: technique, stapled or handsewn", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Stapled side-to-side / handsewn single-layer extramucosal"}),
          f("leakTest", "Anastomosis checked (perfusion, patency, integrity)", {"type": "text", "required": true, "aiFillable": false}),
          f("residualLength", "Residual small bowel length and ICV status", {"type": "text", "required": true, "aiFillable": false, "ph": "Measured length in cm; ileocaecal valve present / absent", "help": "Measured, not estimated"}),
          f("mesentericDefect", "Mesenteric defect closed", {"type": "text", "required": false, "aiFillable": true, "ph": "Yes / No"}),
          f("secondLook", "Second look planned", {"type": "text", "required": false, "aiFillable": true, "ph": "or 'No'"})
        ]
      }
    },
    "surgical-tracheostomy": {
      base: "operative", title: "Open surgical tracheostomy",
      prefill: {"procedure": "Open surgical tracheostomy"},
      extra: {
        "Operative detail": [
          f("tubeDetail", "Tube type, size and cuff", {"type": "text", "required": true, "aiFillable": false, "ph": "Make, size, cuffed / uncuffed, fenestrated / not, adjustable flange"}),
          f("trachealOpening", "Tracheal opening and level", {"type": "text", "required": true, "aiFillable": true, "ph": "Window / slit / flap, rings 2 to 3 or 3 to 4"}),
          f("isthmus", "Thyroid isthmus", {"type": "text", "required": false, "aiFillable": true, "ph": "Divided and ligated / retracted"}),
          f("stayCapnography", "Capnography confirmed and stay sutures", {"type": "text", "required": true, "aiFillable": false, "ph": "EtCO2 trace confirmed; stay sutures yes / no, labelled"}),
          f("bedheadSign", "Bedhead sign completed and spare tubes with patient", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes / No"}),
          f("firstTubeChange", "Plan for first tube change", {"type": "textarea", "required": false, "aiFillable": true, "rows": 2, "ph": "Timing and who performs it"})
        ]
      }
    },
    "tonsillectomy": {
      base: "operative", title: "Tonsillectomy",
      prefill: {"procedure": "Bilateral tonsillectomy"},
      extra: {
        "Operative detail": [
          f("tonsilTechnique", "Dissection technique", {"type": "text", "required": true, "aiFillable": true, "ph": "Cold steel / bipolar / coblation / other", "help": "Hot techniques carry a higher secondary haemorrhage rate; record it for audit."}),
          f("haemostasisMethod", "Haemostasis method", {"type": "text", "required": true, "aiFillable": true, "ph": "Ties / bipolar / packs"}),
          f("fossaeCheckedGagRelease", "Fossae checked after gag release", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes / No", "help": "A physical check by the operating surgeon."}),
          f("throatPackRemoved", "Throat pack and swabs removed, postnasal space cleared", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes, counted out / No pack used"}),
          f("dexamethasoneGiven", "Intra-operative dexamethasone", {"type": "text", "required": false, "aiFillable": false, "ph": "Given / not given (reason)"})
        ]
      }
    },
    "total-thyroidectomy": {
      base: "operative", title: "Total thyroidectomy",
      prefill: {"procedure": "Total thyroidectomy"},
      extra: {
        "Operative detail": [
          f("rlnRight", "Right RLN identified and preserved", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes / No / not identified - state how", "help": "A visual identification confirmed by the surgeon."}),
          f("rlnLeft", "Left RLN identified and preserved", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes / No / not identified - state how"}),
          f("ionmSignals", "Nerve monitoring signals (V1, R1, R2, V2 each side)", {"type": "textarea", "required": true, "aiFillable": false, "rows": 3, "ph": "Values or 'present/absent' per side; any loss of signal and the action taken"}),
          f("ebsln", "External branch of superior laryngeal nerve", {"type": "text", "aiFillable": false, "ph": "Identified / stimulated / not seen, each side"}),
          f("parathyroids", "Parathyroids seen, preserved, autotransplanted", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Per gland: seen in situ / autotransplanted (site) / not seen"})
        ]
      }
    },
    "trauma-craniotomy-edh": {
      base: "operative", title: "Trauma craniotomy for extradural haematoma",
      prefill: {"procedure": "Craniotomy and evacuation of extradural haematoma"},
      extra: {
        "Operative detail": [
          f("preopGcsPupils", "Pre-op GCS (E V M) and pupils", {"type": "text", "required": true, "aiFillable": false, "ph": "E_ V_ M_, pupils L _ mm R _ mm, reactive?"}),
          f("clotSource", "Clot volume, location and bleeding source", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "e.g. left temporal EDH, MMA branch coagulated"}),
          f("duraFindings", "Dura opened and findings", {"type": "text", "required": true, "aiFillable": false, "ph": "Not opened / opened: subdural, contusion, swelling"}),
          f("boneFlapStatus", "Bone flap replaced or stored (where)", {"type": "text", "required": true, "aiFillable": false, "ph": "Replaced, plates / stored in bone bank / abdominal pocket"}),
          f("duralClosure", "Dural closure and hitch sutures", {"type": "text", "required": false, "aiFillable": false, "ph": "Hitches placed; primary / duraplasty (material)"}),
          f("icpMonitor", "ICP monitor or drain placed", {"type": "text", "required": false, "aiFillable": false, "ph": "None / parenchymal / EVD"})
        ]
      }
    },
    "uro-scrotal-exploration": {
      base: "operative", title: "Scrotal exploration",
      prefill: {"procedure": "Scrotal exploration and bilateral testicular fixation", "incision": "Median raphe"},
      extra: {
        "Operative detail": [
          f("painOnset", "Time of pain onset and time of incision", {"type": "text", "required": true, "aiFillable": false, "help": "Ischaemic time is the main prognostic fact."}),
          f("torsionFindings", "Side, degrees of twist and direction", {"type": "text", "required": true, "aiFillable": true, "ph": "e.g. left, 720 degrees, medial; or no torsion found"}),
          f("viability", "Viability after detorsion and warming", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Colour, tunical bleeding, decision and who agreed it"}),
          f("fixation", "Fixation method, both sides", {"type": "text", "required": true, "aiFillable": true, "ph": "Suture type and points, or dartos pouch; contralateral fixed: Yes / No"}),
          f("orchidectomy", "Orchidectomy and specimen", {"type": "text", "required": false, "aiFillable": false, "ph": "Not performed, or side and specimen sent"})
        ]
      }
    },
    "uro-suprapubic-catheter": {
      base: "operative", title: "Suprapubic catheter insertion",
      prefill: {"procedure": "Suprapubic catheter insertion", "anaesthesia": "Local anaesthetic"},
      extra: {
        "Operative detail": [
          f("guidance", "Bladder confirmation and guidance", {"type": "text", "required": true, "aiFillable": false, "ph": "Ultrasound / cystoscopic / open; bowel excluded: Yes / No"}),
          f("previousSurgery", "Previous lower abdominal surgery or scars", {"type": "text", "required": true, "aiFillable": true}),
          f("seekerAspiration", "Urine aspirated with seeker needle; depth", {"type": "text", "required": true, "aiFillable": false}),
          f("catheterDetail", "Catheter type, size and balloon volume", {"type": "text", "required": true, "aiFillable": false, "ph": "e.g. silicone, size Ch, balloon mL water"}),
          f("firstChange", "Plan for first catheter change", {"type": "text", "required": true, "aiFillable": true, "help": "Who changes it and when."})
        ]
      }
    },
    "uro-turbt": {
      base: "operative", title: "Transurethral resection of bladder tumour",
      prefill: {"procedure": "Transurethral resection of bladder tumour (TURBT)"},
      extra: {
        "Operative detail": [
          f("tumourMap", "Tumour number, size, site and appearance", {"type": "textarea", "required": true, "aiFillable": true, "rows": 3, "help": "Describe as a bladder diagram: wall, distance from orifices."}),
          f("bimanual", "Bimanual examination before and after", {"type": "text", "required": true, "aiFillable": false, "ph": "No mass / mobile mass / fixed mass"}),
          f("completeness", "Resection complete; detrusor in base specimen", {"type": "text", "required": true, "aiFillable": false, "ph": "Complete / incomplete; base sent separately: Yes / No"}),
          f("perforation", "Bladder perforation", {"type": "text", "required": true, "aiFillable": false, "ph": "None / extraperitoneal / intraperitoneal, and action"}),
          f("instillation", "Immediate post-operative instillation", {"type": "text", "required": true, "aiFillable": false, "ph": "Given (agent, time) / withheld and reason"}),
          f("catheterDetail", "Catheter type, size and balloon volume", {"type": "text", "required": false, "aiFillable": false})
        ]
      }
    },
    "uro-turp": {
      base: "operative", title: "Transurethral resection of the prostate",
      prefill: {"procedure": "Transurethral resection of the prostate (TURP)", "anaesthesia": "Spinal"},
      extra: {
        "Operative detail": [
          f("energyIrrigant", "Energy platform and irrigation fluid", {"type": "text", "required": true, "aiFillable": true, "ph": "Bipolar / saline, or monopolar / glycine", "help": "The fluid decides the TUR syndrome risk."}),
          f("resectionTime", "Resection time (minutes)", {"type": "text", "required": true, "aiFillable": false, "ph": "e.g. start and finish times"}),
          f("resectedWeight", "Resected tissue weight (g)", {"type": "text", "required": true, "aiFillable": false, "help": "Weighed in theatre."}),
          f("landmarks", "Verumontanum and ureteric orifices preserved", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes / No, with detail"}),
          f("capsulePerforation", "Capsular perforation or open sinuses; sodium checked", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "None, or site, action taken and sodium result"}),
          f("catheterDetail", "Catheter type, size and balloon volume; irrigation", {"type": "text", "required": true, "aiFillable": false, "ph": "e.g. three-way, size Ch, balloon mL water, irrigation running"})
        ]
      }
    },
    "wle-sentinel-node-biopsy": {
      base: "operative", title: "Wide local excision and sentinel node biopsy",
      prefill: {"procedure": "Wide local excision with sentinel lymph node biopsy"},
      extra: {
        "Operative detail": [
          f("localisation", "Localisation device and specimen radiograph", {"type": "text", "required": true, "aiFillable": false, "ph": "Device type; lesion and device confirmed in specimen: Yes / No"}),
          f("orientationSutures", "Specimen orientation sutures and additional margins", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Convention used; any shaved margins and their orientation"}),
          f("sentinelNodes", "Sentinel nodes removed (number, counts, blue)", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Node 1: count, blue Y/N; residual axillary count"}),
          f("tracer", "Tracer technique", {"type": "text", "aiFillable": false, "ph": "Isotope / blue dye / magnetic; any reaction"}),
          f("cavityClips", "Cavity clips placed", {"type": "text", "aiFillable": false, "ph": "Number and position"})
        ]
      }
    }
    /* ── end specialty templates ── */
  };

  /* Resolve a type + optional template into a single flat schema. Pure. */
  function schemaFor(typeId, templateId) {
    var base = SCHEMAS[typeId];
    if (!base) return null;
    var t = templateId ? TEMPLATES[templateId] : null;
    if (t && t.base !== typeId) t = null;                       // a template only extends its own base
    // Deep-ish clone so a caller can never mutate the registry.
    var sections = base.sections.map(function (s) {
      return { title: s.title, note: s.note, fields: s.fields.slice() };
    });
    if (t && t.extra) {
      for (var title in t.extra) {
        if (!Object.prototype.hasOwnProperty.call(t.extra, title)) continue;
        var target = null;
        for (var i = 0; i < sections.length; i++) if (sections[i].title === title) target = sections[i];
        if (!target) { target = { title: title, note: "", fields: [] }; sections.push(target); }
        target.fields = target.fields.concat(t.extra[title]);
      }
    }
    return {
      id: base.id, type: base.id, templateId: t ? templateId : "",
      title: t ? t.title : base.title, icon: base.icon,
      sections: sections,
      prefill: (t && t.prefill) || {}
    };
  }

  function typeList() {
    return ["preop", "operative", "postop", "progress", "discharge"].map(function (id) {
      return { id: id, title: SCHEMAS[id].title, icon: SCHEMAS[id].icon };
    });
  }
  function templateList(typeId) {
    var out = [];
    for (var id in TEMPLATES) {
      if (!Object.prototype.hasOwnProperty.call(TEMPLATES, id)) continue;
      if (typeId && TEMPLATES[id].base !== typeId) continue;
      out.push({ id: id, title: TEMPLATES[id].title, base: TEMPLATES[id].base });
    }
    out.sort(function (a, b) { return a.title < b.title ? -1 : 1; });
    return out;
  }

  var API = { SCHEMAS: SCHEMAS, TEMPLATES: TEMPLATES, schemaFor: schemaFor, typeList: typeList, templateList: templateList };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SURGX_NOTE_SCHEMA = API;
})();
