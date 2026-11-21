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
    "above-knee-amputation": {
      base: "operative", title: "Above-knee amputation",
      prefill: {"procedure": "Above-knee (transfemoral) amputation"},
      extra: {
        "Operative detail": [
          f("levelReason", "Level chosen and reason a lower level was not used", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2}),
          f("boneLevel", "Femoral cut level", {"type": "text", "required": true, "aiFillable": false, "ph": "cm above knee joint line"}),
          f("vesselLigation", "Femoral vessel ligation", {"type": "text", "required": true, "aiFillable": false, "ph": "SFA transfixed, vein ligated separately"}),
          f("sciaticHandling", "Sciatic nerve handling", {"type": "text", "required": false, "aiFillable": true, "ph": "Ligated and divided under traction"}),
          f("myodesis", "Myodesis or myoplasty", {"type": "text", "required": false, "aiFillable": true, "ph": "Adductor myodesis / myoplasty / none"}),
          f("stagedGuillotine", "Guillotine first stage", {"type": "text", "required": false, "aiFillable": false, "ph": "No / yes, plan for definitive"})
        ]
      }
    },
    "acdf": {
      base: "operative", title: "Anterior cervical discectomy and fusion",
      prefill: {"procedure": "Anterior cervical discectomy and fusion"},
      extra: {
        "Operative detail": [
          f("levelImageConfirmed", "Level confirmed on image (levels, side of approach)", {"type": "text", "required": true, "aiFillable": false, "ph": "C5-6, left-sided approach, needle image saved"}),
          f("decompressionDetail", "Decompression: posterior osteophytes, PLL, foramina", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2}),
          f("monitoringEvents", "Monitoring events and the response", {"type": "text", "required": false, "aiFillable": true, "ph": "None, or time, change and action"}),
          f("neckAirwayPlan", "Neck haematoma and airway plan handed over", {"type": "text", "required": true, "aiFillable": false, "ph": "Head up, clip/suture remover at bedside, who to call"})
        ]
      }
    },
    "acl-reconstruction": {
      base: "operative", title: "ACL reconstruction",
      prefill: {"procedure": "Arthroscopic ACL reconstruction with hamstring autograft"},
      extra: {
        "Operative detail": [
          f("euaFindings", "Examination under anaesthesia (both knees)", {"type": "text", "required": true, "aiFillable": false, "ph": "Lachman, pivot shift, collateral and posterolateral laxity", "help": "A physical examination finding."}),
          f("meniscusCartilage", "Meniscal and chondral findings and treatment", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2}),
          f("graftDetail", "Graft configuration, diameter and length", {"type": "text", "required": true, "aiFillable": false, "ph": "e.g. four-strand semitendinosus and gracilis, diameter in mm", "help": "Measured on the sizing block."}),
          f("tunnelFixation", "Tunnel positions and fixation", {"type": "text", "required": true, "aiFillable": true, "ph": "Femoral tunnel technique, femoral and tibial fixation"}),
          f("tourniquetTime", "Tourniquet pressure and time (or none)", {"type": "text", "required": true, "aiFillable": false, "ph": "Pressure (mmHg) and minutes, or WALANT, no tourniquet", "help": "Read from the tourniquet machine; a physical record."})
        ],
        "Accounting": [
          f("implantRegister", "Implant register: make, size, serial / lot number", {"type": "textarea", "required": true, "aiFillable": false, "rows": 3, "ph": "Each implant on its own line", "help": "Copy from the implant stickers. A physical record, never AI-filled."})
        ]
      }
    },
    "adenoidectomy": {
      base: "operative", title: "Adenoidectomy",
      prefill: {"procedure": "Adenoidectomy"},
      extra: {
        "Operative detail": [
          f("palatePalpated", "Palate palpated, no submucous cleft", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes, palate normal / suspected cleft (action)", "help": "A physical check before removal."}),
          f("adenoidTechnique", "Technique and view", {"type": "text", "required": true, "aiFillable": true, "ph": "Suction diathermy / coblation / curettage; mirror / endoscope"}),
          f("inferiorFringe", "Tori and inferior fringe", {"type": "text", "required": false, "aiFillable": true, "ph": "Tori preserved; inferior fringe left / removed"}),
          f("postnasalPackOut", "Postnasal pack and swabs removed, nasopharynx clear", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes, counted out"})
        ]
      }
    },
    "ankle-orif": {
      base: "operative", title: "Ankle ORIF",
      prefill: {"procedure": "Open reduction and internal fixation of ankle fracture"},
      extra: {
        "Operative detail": [
          f("fibulaFixation", "Fibular reduction and fixation", {"type": "text", "required": true, "aiFillable": true, "ph": "Lag screw, plate type and position, number of screws"}),
          f("medialFixation", "Medial malleolus or deltoid", {"type": "text", "required": false, "aiFillable": true, "ph": "Fixation used, or not required"}),
          f("syndesmosisTest", "Syndesmosis stress test and fixation", {"type": "text", "required": true, "aiFillable": false, "ph": "Test result; screws or suture-button, number and level", "help": "The stress test is a physical intra-operative finding."}),
          f("weightBearing", "Weight-bearing instruction and protection", {"type": "text", "required": true, "aiFillable": true})
        ],
        "Accounting": [
          f("implantRegister", "Implant register: make, size, serial / lot number", {"type": "textarea", "required": true, "aiFillable": false, "rows": 3, "ph": "Each implant on its own line", "help": "Copy from the implant stickers. A physical record, never AI-filled."}),
          f("imageIntensifier", "Image intensifier dose and screening time", {"type": "text", "required": true, "aiFillable": false, "ph": "e.g. dose (cGy cm2) and time (s) from the C-arm", "help": "Read from the machine at the end of the case."})
        ]
      }
    },
    "av-fistula-radiocephalic": {
      base: "operative", title: "Radiocephalic AV fistula",
      prefill: {"procedure": "Left / right radiocephalic arteriovenous fistula"},
      extra: {
        "Operative detail": [
          f("vesselSizes", "Artery and vein diameters (mapping or on table)", {"type": "text", "required": true, "aiFillable": false, "ph": "Radial artery mm; cephalic vein mm"}),
          f("anastomosisConfig", "Anastomosis configuration and arteriotomy length", {"type": "text", "required": true, "aiFillable": true, "ph": "End vein to side artery; length"}),
          f("thrillAtEnd", "Thrill at end of procedure", {"type": "text", "required": true, "aiFillable": false, "ph": "Continuous thrill / pulse only / none"}),
          f("handPerfusion", "Hand perfusion at end", {"type": "text", "required": true, "aiFillable": false, "ph": "Colour, capillary refill, palmar Doppler"})
        ]
      }
    },
    "axillary-lymph-node-dissection": {
      base: "operative", title: "Axillary lymph node dissection note",
      prefill: {"procedure": "Axillary lymph node dissection"},
      extra: {
        "Operative detail": [
          f("operatedSide", "Side", {"type": "text", "required": true, "aiFillable": false, "ph": "Right or left axilla"}),
          f("levelsCleared", "Levels cleared", {"type": "text", "required": true, "aiFillable": false, "ph": "I and II; level III only if gross disease"}),
          f("nervesStatus", "Long thoracic, thoracodorsal and pectoral nerves", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Identified and preserved", "help": "Physical finding."}),
          f("intercostobrachialNerve", "Intercostobrachial nerve", {"type": "text", "required": false, "aiFillable": false, "ph": "Preserved, or divided because ..."}),
          f("clippedNodeRetrieved", "Clipped or marked node retrieved", {"type": "text", "required": false, "aiFillable": false, "ph": "Confirmed on specimen imaging, or not applicable"})
        ]
      }
    },
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
    "breast-fibroadenoma-excision": {
      base: "operative", title: "Excision of a benign breast lump (fibroadenoma) note",
      prefill: {"procedure": "Excision of a benign breast lump (fibroadenoma)"},
      extra: {
        "Operative detail": [
          f("lesionSite", "Side, clock position and distance from nipple", {"type": "text", "required": true, "aiFillable": false, "ph": "Left breast, 2 o'clock, 4 cm from nipple"}),
          f("tripleAssessment", "Pre-operative triple assessment", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Clinical P2, ultrasound U2, core biopsy B2: concordant"}),
          f("localisationMethod", "Localisation method for impalpable lesion", {"type": "text", "required": false, "aiFillable": false, "ph": "Wire, seed, clip, or palpable"}),
          f("excisionCompleteness", "Lump excised intact and complete", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes, in pseudo-capsule; or fragmented, or not found"})
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
    "cabg": {
      base: "operative", title: "Coronary artery bypass grafting",
      prefill: {"procedure": "Coronary artery bypass grafting"},
      extra: {
        "Operative detail": [
          f("graftList", "Grafts: conduit to target and flow", {"type": "textarea", "required": true, "aiFillable": false, "rows": 3, "ph": "LIMA to LAD, flow; SVG to OM1, flow"}),
          f("bypassTimes", "Bypass and cross-clamp times", {"type": "text", "required": true, "aiFillable": false, "ph": "CPB min; cross-clamp min"}),
          f("aortaAssessment", "Ascending aorta assessment", {"type": "text", "required": false, "aiFillable": true, "ph": "Palpation / epiaortic scan findings"}),
          f("weaning", "Weaning and support", {"type": "text", "required": true, "aiFillable": false, "ph": "Inotropes, pacing, IABP"}),
          f("pacingWires", "Pacing wires placed", {"type": "text", "required": true, "aiFillable": false, "ph": "Atrial / ventricular, thresholds"})
        ]
      }
    },
    "carotid-endarterectomy": {
      base: "operative", title: "Carotid endarterectomy",
      prefill: {"procedure": "Carotid endarterectomy with patch angioplasty"},
      extra: {
        "Operative detail": [
          f("symptomStatus", "Symptom status, side and stenosis (NASCET %)", {"type": "text", "required": true, "aiFillable": false, "ph": "Symptomatic / asymptomatic; side; % stenosis; date of last event"}),
          f("cerebralMonitoring", "Anaesthesia and cerebral monitoring", {"type": "text", "required": true, "aiFillable": true, "ph": "LA awake testing / GA with stump pressure, TCD, NIRS"}),
          f("shuntUsed", "Shunt used and clamp time", {"type": "text", "required": true, "aiFillable": false, "ph": "No shunt / selective / routine; clamp time min"}),
          f("distalEndpoint", "Distal endpoint and tacking sutures", {"type": "text", "required": false, "aiFillable": true, "ph": "Clean taper / tacked"}),
          f("cranialNerves", "Cranial nerves identified and preserved", {"type": "text", "required": true, "aiFillable": false, "ph": "Hypoglossal, vagus, marginal mandibular"}),
          f("neuroOnWaking", "Neurological status on waking", {"type": "text", "required": true, "aiFillable": false, "ph": "No new deficit / deficit and action taken"})
        ]
      }
    },
    "carpal-tunnel-release": {
      base: "operative", title: "Carpal tunnel release",
      prefill: {"procedure": "Open carpal tunnel release", "incision": "Palmar incision in line with the ring finger radial border"},
      extra: {
        "Operative detail": [
          f("nerveAppearance", "Median nerve appearance and motor branch anatomy", {"type": "text", "required": true, "aiFillable": true, "ph": "e.g. hourglass constriction, extraligamentous motor branch"}),
          f("releaseExtent", "Extent of release confirmed", {"type": "text", "required": true, "aiFillable": false, "ph": "Distal fat pad to distal antebrachial fascia", "help": "Confirmed by the surgeon in theatre."}),
          f("canalFindings", "Other findings in the canal", {"type": "text", "required": false, "aiFillable": true, "ph": "Tenosynovitis, mass, anomalous muscle, or none"}),
          f("tourniquetTime", "Tourniquet pressure and time (or none)", {"type": "text", "required": true, "aiFillable": false, "ph": "Pressure (mmHg) and minutes, or WALANT, no tourniquet", "help": "Read from the tourniquet machine; a physical record."})
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
    "craniotomy-supratentorial-tumour": {
      base: "operative", title: "Craniotomy for supratentorial tumour",
      prefill: {"procedure": "Craniotomy for supratentorial tumour"},
      extra: {
        "Operative detail": [
          f("navigationAccuracy", "Navigation registration and accuracy check", {"type": "text", "required": true, "aiFillable": false, "ph": "Method; error on landmarks; re-checked after dural opening"}),
          f("resectionAdjuncts", "Adjuncts used (5-ALA, ultrasound, monitoring, mapping)", {"type": "textarea", "required": false, "aiFillable": true, "rows": 2}),
          f("monitoringEvents", "Monitoring or mapping events and the response", {"type": "textarea", "required": false, "aiFillable": true, "rows": 2, "ph": "None, or time, change and action"}),
          f("extentOfResection", "Surgeon's impression of extent of resection", {"type": "text", "required": true, "aiFillable": true, "ph": "Gross total / subtotal / debulking; reason resection stopped"}),
          f("frozenSection", "Frozen section or smear result", {"type": "text", "required": false, "aiFillable": false, "ph": "Result as reported, or 'not sent'"}),
          f("boneFlapDecision", "Bone flap replaced or left out", {"type": "text", "required": true, "aiFillable": false, "ph": "Replaced with plates / left out (brain swelling), stored where"})
        ]
      }
    },
    "d2-gastrectomy": {
      base: "operative", title: "D2 gastrectomy for gastric cancer note",
      prefill: {"procedure": "D2 gastrectomy for gastric cancer"},
      extra: {
        "Operative detail": [
          f("gastrectomyExtent", "Extent of gastrectomy", {"type": "text", "required": true, "aiFillable": false, "ph": "Subtotal (distal) or total"}),
          f("stationsCleared", "Nodal stations cleared", {"type": "textarea", "required": true, "aiFillable": false, "rows": 3, "ph": "D2: 1, 3, 4sb, 4d, 5, 6, 7, 8a, 9, 11p, 12a"}),
          f("proximalMargin", "Proximal margin and frozen section", {"type": "text", "required": true, "aiFillable": false, "ph": "Distance from tumour; frozen section clear or not sent"}),
          f("reconstructionType", "Reconstruction", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Roux-en-Y oesophagojejunostomy, circular stapled, retrocolic limb; leak test negative"}),
          f("mesentericDefects", "Mesenteric defects closed", {"type": "text", "required": false, "aiFillable": false, "ph": "Petersen and jejunojejunostomy defects closed"}),
          f("peritonealFindings", "Peritoneal cytology and staging findings", {"type": "text", "required": false, "aiFillable": true, "ph": "Washings sent; no peritoneal or liver disease"})
        ]
      }
    },
    "decompressive-craniectomy": {
      base: "operative", title: "Decompressive craniectomy",
      prefill: {"procedure": "Decompressive craniectomy"},
      extra: {
        "Operative detail": [
          f("preopGcsPupils", "Pre-op GCS (E V M) and pupils", {"type": "text", "required": true, "aiFillable": false, "ph": "E_ V_ M_, pupils L _ mm R _ mm, reactive?"}),
          f("decisionBasis", "Indication and criteria met", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Malignant MCA infarction (time from onset, NIHSS, infarct extent) / refractory ICP after TBI"}),
          f("craniectomySize", "Craniectomy dimensions and middle fossa decompression", {"type": "text", "required": true, "aiFillable": false, "ph": "e.g. 13 x 15 cm, flush to middle fossa floor"}),
          f("duraplasty", "Dural opening and duraplasty", {"type": "text", "required": true, "aiFillable": true, "ph": "Stellate opening, onlay graft (material), not watertight"}),
          f("boneFlapStorage", "Bone flap storage site and reference", {"type": "text", "required": true, "aiFillable": false, "ph": "Bone bank freezer ref ___ / abdominal pocket left / right"}),
          f("icpMonitor", "ICP monitor inserted (type, site, opening value)", {"type": "text", "required": false, "aiFillable": false})
        ]
      }
    },
    "distal-radius-fixation": {
      base: "operative", title: "Distal radius fracture fixation",
      prefill: {"procedure": "Fixation of distal radius fracture"},
      extra: {
        "Operative detail": [
          f("fixationMethod", "Fixation method", {"type": "text", "required": true, "aiFillable": true, "ph": "Volar locking plate, K-wires, bridge plate or external fixator"}),
          f("reductionParams", "Reduction achieved", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Radial height, inclination, volar tilt, articular step"}),
          f("screwCheck", "Dorsal tangential view and screw length check", {"type": "text", "required": true, "aiFillable": false, "ph": "Done; any screw exchanged", "help": "Read from the saved images."}),
          f("drujStability", "DRUJ stability", {"type": "text", "required": true, "aiFillable": false, "ph": "Stable or unstable, in which rotation", "help": "A physical examination finding."})
        ],
        "Accounting": [
          f("implantRegister", "Implant register: make, size, serial / lot number", {"type": "textarea", "required": true, "aiFillable": false, "rows": 3, "ph": "Each implant on its own line", "help": "Copy from the implant stickers. A physical record, never AI-filled."}),
          f("imageIntensifier", "Image intensifier dose and screening time", {"type": "text", "required": true, "aiFillable": false, "ph": "e.g. dose (cGy cm2) and time (s) from the C-arm", "help": "Read from the machine at the end of the case."})
        ]
      }
    },
    "dynamic-hip-screw": {
      base: "operative", title: "Dynamic hip screw",
      prefill: {"procedure": "Dynamic (sliding) hip screw fixation", "incision": "Lateral approach to proximal femur"},
      extra: {
        "Operative detail": [
          f("fractureClass", "Fracture pattern and lateral wall", {"type": "text", "required": true, "aiFillable": true, "ph": "e.g. two-part intertrochanteric, lateral wall intact"}),
          f("reduction", "Reduction achieved (AP and lateral)", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2}),
          f("tipApex", "Lag screw position and tip-apex distance", {"type": "text", "required": true, "aiFillable": false, "ph": "Central-central, TAD in mm", "help": "Measured from the final images, not estimated."}),
          f("plateDetail", "Plate angle, holes and screws", {"type": "text", "required": false, "aiFillable": true})
        ],
        "Accounting": [
          f("implantRegister", "Implant register: make, size, serial / lot number", {"type": "textarea", "required": true, "aiFillable": false, "rows": 3, "ph": "Each implant on its own line", "help": "Copy from the implant stickers. A physical record, never AI-filled."}),
          f("imageIntensifier", "Image intensifier dose and screening time", {"type": "text", "required": true, "aiFillable": false, "ph": "e.g. dose (cGy cm2) and time (s) from the C-arm", "help": "Read from the machine at the end of the case."})
        ],
        "Plan": [
          f("nvStatusPostop", "Neurovascular status post-op", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Pulses, capillary refill, motor and sensory function distal to the operation", "help": "A physical examination you performed. Not dictated."}),
          f("weightBearing", "Weight-bearing status", {"type": "text", "required": true, "aiFillable": true, "ph": "Full weight-bearing unless stated"})
        ]
      }
    },
    "evacuation-rpoc": {
      base: "operative", title: "Surgical management of miscarriage",
      prefill: {"procedure": "Surgical management of miscarriage (vacuum aspiration)"},
      extra: {
        "Operative detail": [
          f("gestationAndIndication", "Gestation, scan findings and indication", {"type": "text", "required": true, "aiFillable": true, "ph": "Missed miscarriage at 9 weeks by CRL, intrauterine"}),
          f("uterusSizeAxis", "Uterine size and axis on examination", {"type": "text", "required": true, "aiFillable": false, "ph": "Anteverted, 8 week size"}),
          f("aspirationMethod", "Cervical priming, dilatation and cannula size, method", {"type": "text", "required": false, "aiFillable": true, "ph": "Misoprostol priming; dilated to 8; 8 mm cannula; MVA / electric"}),
          f("tissueIdentified", "Pregnancy tissue identified macroscopically", {"type": "text", "required": true, "aiFillable": false, "ph": "Villi seen / not seen (ectopic plan)"}),
          f("perforationExcluded", "Perforation suspected or excluded", {"type": "text", "required": true, "aiFillable": false}),
          f("antiDStatus", "Rhesus status and anti-D", {"type": "text", "required": true, "aiFillable": false, "ph": "Rh positive / Rh negative, anti-D given"})
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
    "fem-pop-bypass": {
      base: "operative", title: "Femoro-popliteal bypass",
      prefill: {"procedure": "Femoro-popliteal (above-knee) bypass with reversed great saphenous vein"},
      extra: {
        "Operative detail": [
          f("inflowTarget", "Inflow and target arteries", {"type": "text", "required": true, "aiFillable": true, "ph": "Common femoral to above-knee popliteal"}),
          f("conduit", "Conduit, orientation and quality", {"type": "text", "required": true, "aiFillable": false, "ph": "Ipsilateral GSV reversed / in situ / prosthetic; diameter; quality"}),
          f("tunnelRoute", "Tunnel route", {"type": "text", "required": false, "aiFillable": true, "ph": "Subsartorial / subcutaneous"}),
          f("completionImaging", "Completion imaging findings", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2}),
          f("footPerfusion", "Foot perfusion at end", {"type": "text", "required": true, "aiFillable": false, "ph": "Pulses / Doppler signals"})
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
    "fistula-in-ano-surgery": {
      base: "operative", title: "Fistula-in-ano surgery",
      prefill: {"procedure": "Examination under anaesthesia, fistula-in-ano"},
      extra: {
        "Operative detail": [
          f("patientPositionAnal", "Patient position (for clock-face reference)", {"type": "text", "required": true, "aiFillable": true, "ph": "Lithotomy / prone jack-knife"}),
          f("openings", "External and internal openings", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "External: left posterolateral 3 cm from verge. Internal: posterior midline at dentate line"}),
          f("parksType", "Tract type (Parks) and sphincter involvement", {"type": "text", "required": true, "aiFillable": true, "ph": "Low trans-sphincteric, small proportion of external sphincter"}),
          f("fistulaTreatment", "Treatment: fistulotomy or loose seton", {"type": "text", "required": true, "aiFillable": false, "ph": "Loose silicone seton"}),
          f("tbSent", "Tissue sent for TB studies", {"type": "text", "required": false, "aiFillable": false, "ph": "Yes, culture and PCR / not indicated"})
        ]
      }
    },
    "flexor-tendon-repair": {
      base: "operative", title: "Flexor tendon repair (zone II)",
      prefill: {"procedure": "Primary flexor tendon repair, zone II"},
      extra: {
        "Operative detail": [
          f("tendonsInjured", "Tendons divided and repaired, digit and zone", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "e.g. FDP and FDS, right middle finger, zone IIB"}),
          f("coreTechnique", "Core repair technique, strands and suture", {"type": "text", "required": true, "aiFillable": true, "ph": "e.g. 6-strand M-Tang with looped suture, running epitendinous"}),
          f("pulleyVenting", "Pulleys preserved or vented", {"type": "text", "required": true, "aiFillable": true}),
          f("gapCheck", "Active or passive gap and gliding check", {"type": "text", "required": true, "aiFillable": false, "ph": "No gap on full active flexion, or how tested", "help": "Observed in theatre."}),
          f("digitalNerves", "Digital nerves: intact or repaired", {"type": "text", "required": true, "aiFillable": true}),
          f("tourniquetTime", "Tourniquet pressure and time (or none)", {"type": "text", "required": true, "aiFillable": false, "ph": "Pressure (mmHg) and minutes, or WALANT, no tourniquet", "help": "Read from the tourniquet machine; a physical record."})
        ]
      }
    },
    "gsv-ablation-stripping": {
      base: "operative", title: "Great saphenous vein surgery",
      prefill: {"procedure": "Great saphenous vein endovenous ablation / high tie and stripping"},
      extra: {
        "Operative detail": [
          f("technique", "Technique and device", {"type": "text", "required": true, "aiFillable": true, "ph": "EVLA / RFA / high tie and strip to knee"}),
          f("accessSite", "Access site and treated length", {"type": "text", "required": false, "aiFillable": true, "ph": "Cannulated at; length treated cm"}),
          f("tipDistance", "Tip distance from junction on ultrasound", {"type": "text", "required": false, "aiFillable": false, "ph": "cm from SFJ"}),
          f("energyDelivered", "Energy delivered", {"type": "text", "required": false, "aiFillable": false, "ph": "Total J / cycles"}),
          f("deepVeinScan", "End-of-procedure deep vein scan", {"type": "text", "required": true, "aiFillable": false, "ph": "CFV patent, no thrombus"}),
          f("phlebectomySites", "Phlebectomy sites", {"type": "text", "required": false, "aiFillable": true, "ph": "Thigh / calf, number"})
        ]
      }
    },
    "haemorrhoidectomy": {
      base: "operative", title: "Haemorrhoidectomy",
      prefill: {"procedure": "Milligan-Morgan haemorrhoidectomy"},
      extra: {
        "Operative detail": [
          f("patientPositionAnal", "Patient position (for clock-face reference)", {"type": "text", "required": true, "aiFillable": true, "ph": "Lithotomy / prone jack-knife"}),
          f("pilesExcised", "Haemorrhoids excised, by anatomical position", {"type": "text", "required": true, "aiFillable": true, "ph": "Left lateral, right posterior, right anterior"}),
          f("skinBridges", "Mucocutaneous bridges preserved", {"type": "text", "required": true, "aiFillable": false, "ph": "Three adequate bridges"}),
          f("analCalibre", "Anal calibre at end of procedure", {"type": "text", "required": true, "aiFillable": false, "ph": "Admits retractor without tension"}),
          f("rectalFindings", "Proctoscopy and sigmoidoscopy findings", {"type": "text", "required": false, "aiFillable": true, "ph": "No mass, no proctitis"})
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
    "hemithyroidectomy": {
      base: "operative", title: "Hemithyroidectomy (thyroid lobectomy) note",
      prefill: {"procedure": "Hemithyroidectomy (thyroid lobectomy)"},
      extra: {
        "Operative detail": [
          f("operatedSide", "Side of lobectomy", {"type": "text", "required": true, "aiFillable": false, "ph": "Right or left lobe"}),
          f("rlnStatus", "Recurrent laryngeal nerve identified and preserved", {"type": "textarea", "required": true, "aiFillable": false, "rows": 3, "ph": "Seen, traced to larynx, intact", "help": "Physical finding: record what you saw."}),
          f("ionmSignals", "Nerve monitoring signals (V1, R1, R2, V2)", {"type": "textarea", "required": false, "aiFillable": false, "rows": 3, "ph": "Amplitudes in microvolts, or 'monitoring not used'"}),
          f("parathyroidsOperatedSide", "Parathyroids on operated side", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Superior and inferior: seen in situ, autotransplanted, not seen"}),
          f("isthmusAndPyramidal", "Isthmus division and pyramidal lobe", {"type": "text", "required": false, "aiFillable": true, "ph": "Divided flush with contralateral lobe; pyramidal lobe taken"})
        ]
      }
    },
    "hip-hemiarthroplasty": {
      base: "operative", title: "Hemiarthroplasty of the hip",
      prefill: {"procedure": "Cemented hemiarthroplasty of the hip"},
      extra: {
        "Operative detail": [
          f("headSize", "Measured femoral head and prosthetic head size", {"type": "text", "required": true, "aiFillable": false, "ph": "Measured diameter and head chosen (unipolar or bipolar)", "help": "Measured with the gauge in theatre."}),
          f("acetabulumState", "Acetabular cartilage", {"type": "text", "required": true, "aiFillable": true, "ph": "e.g. healthy cartilage, no arthritis"}),
          f("cementEvent", "Cement safety pause and any cardiovascular event", {"type": "text", "required": true, "aiFillable": false, "ph": "Pause performed; any hypotension or desaturation at cementing"}),
          f("weightBearing", "Weight-bearing instruction", {"type": "text", "required": true, "aiFillable": true, "ph": "Full weight bearing as tolerated, or the reason for restriction"})
        ],
        "Accounting": [
          f("implantRegister", "Implant register: make, size, serial / lot number", {"type": "textarea", "required": true, "aiFillable": false, "rows": 3, "ph": "Each implant on its own line", "help": "Copy from the implant stickers. A physical record, never AI-filled."})
        ]
      }
    },
    "ivor-lewis-oesophagectomy": {
      base: "operative", title: "Oesophagectomy (Ivor Lewis principles) note",
      prefill: {"procedure": "Oesophagectomy (Ivor Lewis principles)"},
      extra: {
        "Operative detail": [
          f("approachPhases", "Approach for each phase", {"type": "text", "required": true, "aiFillable": true, "ph": "Open abdomen, right thoracotomy; or hybrid; or totally minimally invasive"}),
          f("conduitAssessment", "Conduit perfusion assessment", {"type": "text", "required": true, "aiFillable": false, "ph": "Visual, or objective perfusion method used"}),
          f("anastomosisDetail", "Anastomosis level and technique", {"type": "text", "required": true, "aiFillable": false, "ph": "At azygos level, circular stapled, doughnuts complete"}),
          f("thoracicDuct", "Thoracic duct management", {"type": "text", "required": true, "aiFillable": false, "ph": "Identified and ligated, or mass ligation above diaphragm"}),
          f("ngTubePosition", "Nasogastric tube position", {"type": "text", "required": true, "aiFillable": false, "ph": "Tip across anastomosis in conduit; do not reposition blindly"}),
          f("feedingAccess", "Feeding access", {"type": "text", "required": false, "aiFillable": false, "ph": "Feeding jejunostomy, nasojejunal tube, or none"})
        ]
      }
    },
    "lap-anterior-resection-tme": {
      base: "operative", title: "Anterior resection with TME",
      prefill: {"procedure": "Laparoscopic anterior resection with total mesorectal excision"},
      extra: {
        "Operative detail": [
          f("tumourHeight", "Tumour height from anal verge and distal margin", {"type": "text", "required": true, "aiFillable": false, "ph": "cm from verge on rigid sigmoidoscopy; distal margin confirmed by DRE/endoscopy"}),
          f("vascularTie", "IMA tie level, IMV, ureter identified, splenic flexure", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "High / low tie; IMV at pancreas; left ureter seen before division; flexure mobilised yes/no"}),
          f("tmeQuality", "TME plane quality (surgeon's grade)", {"type": "text", "required": true, "aiFillable": false, "ph": "Complete / nearly complete / incomplete", "help": "Grade on the specimen before it leaves theatre"}),
          f("anastomosisCheck", "Anastomosis: height, doughnuts, air leak test", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Stapled colorectal at x cm; doughnuts complete; air test negative", "help": "Physical checks: record what was seen"}),
          f("nervesPreserved", "Hypogastric and pelvic nerves preserved", {"type": "text", "required": false, "aiFillable": false, "ph": "Yes / no / not identified"}),
          f("defunctionDecision", "Defunctioning or end stoma decision and reasons", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Loop ileostomy RIF because low anastomosis after chemoradiotherapy"})
        ]
      }
    },
    "lap-cbd-exploration": {
      base: "operative", title: "Laparoscopic CBD exploration",
      prefill: {"procedure": "Laparoscopic cholecystectomy and common bile duct exploration"},
      extra: {
        "Operative detail": [
          f("cholangiogram", "Cholangiogram: stones, size, duct diameter", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "3 stones up to 6 mm, CBD 10 mm, free flow / no flow to duodenum"}),
          f("cbdeRoute", "Route and reason", {"type": "text", "required": true, "aiFillable": true, "ph": "Transcystic / choledochotomy, because..."}),
          f("ductCleared", "Duct clearance confirmed and how", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes, choledochoscopy to ampulla and both hepatic ducts / completion cholangiogram / not cleared"}),
          f("ductClosure", "Duct closure", {"type": "text", "required": true, "aiFillable": true, "ph": "Cystic duct endoloop / primary closure / T-tube / antegrade stent"}),
          f("ercpPlan", "ERCP plan if not cleared", {"type": "text", "required": false, "aiFillable": true, "ph": "Not needed / arranged with gastroenterology"})
        ]
      }
    },
    "lap-inguinal-hernia-repair": {
      base: "operative", title: "Laparoscopic inguinal hernia repair",
      prefill: {"procedure": "Laparoscopic inguinal hernia repair (TEP / TAPP)"},
      extra: {
        "Operative detail": [
          f("approach", "Approach: TEP or TAPP, side(s)", {"type": "text", "required": true, "aiFillable": true, "ph": "TEP, right / TAPP, bilateral"}),
          f("defectTypes", "Defects found on each side", {"type": "text", "required": true, "aiFillable": true, "ph": "Right: indirect (EHS L2), no femoral; Left: none", "help": "Direct, indirect, femoral and obturator spaces on each side"}),
          f("cordLipoma", "Cord lipoma looked for and reduced", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes, reduced / none found"}),
          f("meshPosition", "Mesh size, coverage and fixation zones", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "15 x 10 cm, covers myopectoral orifice, tacked to Cooper's ligament only", "help": "Confirm no fixation in the triangles of doom or pain"}),
          f("peritonealClosure", "Peritoneal integrity or flap closure", {"type": "text", "required": true, "aiFillable": false, "ph": "TAPP flap closed with running suture, no mesh exposed"})
        ]
      }
    },
    "lap-nissen-fundoplication": {
      base: "operative", title: "Laparoscopic Nissen fundoplication",
      prefill: {"procedure": "Laparoscopic Nissen fundoplication"},
      extra: {
        "Operative detail": [
          f("vagiPreserved", "Anterior and posterior vagi identified and preserved", {"type": "text", "required": true, "aiFillable": false, "ph": "Both seen and preserved"}),
          f("intraAbdoOesophagus", "Intra-abdominal oesophageal length", {"type": "text", "required": true, "aiFillable": true, "ph": "About 3 cm, tension free"}),
          f("cruralRepair", "Crural repair", {"type": "text", "required": true, "aiFillable": true, "ph": "Posterior, 3 interrupted non-absorbable sutures"}),
          f("wrapDetail", "Wrap type, length and calibration", {"type": "text", "required": true, "aiFillable": true, "ph": "360 degree floppy, 2 cm, over 56 Fr bougie"}),
          f("pleuralBreach", "Pleural breach", {"type": "text", "required": false, "aiFillable": false, "ph": "None / left pleura opened, anaesthetist informed"})
        ]
      }
    },
    "lap-ovarian-cystectomy": {
      base: "operative", title: "Laparoscopic ovarian cystectomy",
      prefill: {"procedure": "Laparoscopic ovarian cystectomy"},
      extra: {
        "Operative detail": [
          f("cystDescription", "Cyst side, size, nature and surface", {"type": "text", "required": true, "aiFillable": true, "ph": "Right 6 cm dermoid, smooth surface, no excrescences"}),
          f("spillageAndIrrigation", "Cyst rupture or spillage and irrigation", {"type": "text", "required": true, "aiFillable": false, "ph": "Removed intact in bag / ruptured, irrigated until clear"}),
          f("ovarianPreservation", "Ovarian tissue preserved and haemostasis method", {"type": "text", "required": false, "aiFillable": true, "ph": "Ovary preserved; pressure and haemostatic agent, minimal bipolar"}),
          f("washingsTaken", "Peritoneal washings taken", {"type": "text", "required": false, "aiFillable": false, "ph": "Yes / no"}),
          f("contralateralAdnexa", "Contralateral ovary and tube", {"type": "text", "required": false, "aiFillable": true, "ph": "Normal / findings"})
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
    "lap-sleeve-gastrectomy": {
      base: "operative", title: "Laparoscopic sleeve gastrectomy",
      prefill: {"procedure": "Laparoscopic sleeve gastrectomy"},
      extra: {
        "Operative detail": [
          f("startDistance", "Distance of first firing from pylorus", {"type": "text", "required": true, "aiFillable": true, "ph": "4 cm"}),
          f("bougieSize", "Bougie size", {"type": "text", "required": true, "aiFillable": true, "ph": "36 Fr"}),
          f("staplerLoads", "Stapler loads and reinforcement", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Antrum: 2 thick loads; body/fundus: 4 medium loads; no reinforcement"}),
          f("hiatusFinding", "Hiatus: hernia found and repaired", {"type": "text", "required": true, "aiFillable": true, "ph": "No hiatal hernia / repaired with 2 posterior sutures"}),
          f("leakTest", "Leak test method and result", {"type": "text", "required": true, "aiFillable": false, "ph": "Methylene blue, negative"})
        ]
      }
    },
    "laparoscopic-adrenalectomy": {
      base: "operative", title: "Laparoscopic adrenalectomy note",
      prefill: {"procedure": "Laparoscopic adrenalectomy"},
      extra: {
        "Operative detail": [
          f("operatedSide", "Side", {"type": "text", "required": true, "aiFillable": false, "ph": "Right or left adrenal"}),
          f("functionalDiagnosis", "Functional diagnosis", {"type": "text", "required": true, "aiFillable": true, "ph": "Phaeochromocytoma, aldosteronoma, cortisol-secreting adenoma, non-functioning"}),
          f("adrenalVeinControl", "Adrenal vein control", {"type": "text", "required": true, "aiFillable": false, "ph": "Identified, clipped and divided"}),
          f("haemodynamicEvents", "Intra-operative haemodynamic events", {"type": "textarea", "required": false, "aiFillable": true, "rows": 2, "ph": "Hypertensive episodes on manipulation; hypotension after vein ligation, treated with ..."}),
          f("conversion", "Conversion to open and reason", {"type": "text", "required": false, "aiFillable": false, "ph": "Not converted, or converted because ..."}),
          f("hormonePlan", "Post-operative hormone plan", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Steroid cover and taper, potassium plan, or glucose and BP monitoring"})
        ]
      }
    },
    "lateral-internal-sphincterotomy": {
      base: "operative", title: "Lateral internal sphincterotomy",
      prefill: {"procedure": "Lateral internal sphincterotomy"},
      extra: {
        "Operative detail": [
          f("fissureSite", "Fissure site and features", {"type": "text", "required": true, "aiFillable": true, "ph": "Posterior midline, sentinel tag, typical"}),
          f("sphincterotomySide", "Side and technique (open or closed)", {"type": "text", "required": true, "aiFillable": true, "ph": "Left lateral, closed"}),
          f("divisionLength", "Extent of internal sphincter division", {"type": "text", "required": true, "aiFillable": false, "ph": "To apex of fissure, below dentate line"}),
          f("baselineContinence", "Baseline continence (score) recorded pre-op", {"type": "text", "required": true, "aiFillable": false, "ph": "Wexner 0"})
        ]
      }
    },
    "left-hemicolectomy-sigmoid": {
      base: "operative", title: "Left hemicolectomy / sigmoid colectomy",
      prefill: {"procedure": "Laparoscopic sigmoid colectomy / left hemicolectomy"},
      extra: {
        "Operative detail": [
          f("indicationType", "Indication type", {"type": "text", "required": true, "aiFillable": true, "ph": "Cancer / diverticular (complicated, recurrent) / volvulus / polyp"}),
          f("leftUreter", "Left ureter identified and preserved", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes, before pedicle division / stents used"}),
          f("vascularTie", "Vascular division level", {"type": "text", "required": true, "aiFillable": true, "ph": "High IMA tie / low tie / close to bowel (benign)"}),
          f("distalLevel", "Distal division level", {"type": "text", "required": true, "aiFillable": true, "ph": "Upper rectum below taenial splay / margin from tumour"}),
          f("anastomosisCheck", "Anastomosis: type, doughnuts, air leak test", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Circular stapled colorectal; doughnuts complete; air test negative"}),
          f("stomaDecision", "Stoma decision and reasons", {"type": "text", "required": false, "aiFillable": true, "ph": "None / loop ileostomy / end colostomy (Hartmann's), because..."})
        ]
      }
    },
    "leg-fasciotomy": {
      base: "operative", title: "Fasciotomy of the leg",
      prefill: {"procedure": "Two-incision four-compartment fasciotomy of the leg"},
      extra: {
        "Operative detail": [
          f("compartmentsReleased", "Compartments released", {"type": "text", "required": true, "aiFillable": false, "ph": "Anterior / lateral / superficial posterior / deep posterior", "help": "Confirmed by direct inspection of each compartment."}),
          f("muscleViability", "Muscle viability by compartment", {"type": "textarea", "required": true, "aiFillable": true, "rows": 4, "ph": "Colour, consistency, contractility, bleeding for each compartment"}),
          f("muscleExcised", "Muscle excised", {"type": "text", "required": false, "aiFillable": true, "ph": "or 'None'"}),
          f("secondLook", "Planned second look (date) and plastics discussion", {"type": "text", "required": true, "aiFillable": true})
        ],
        "Accounting": [
          f("tourniquetTime", "Tourniquet time and pressure", {"type": "text", "required": true, "aiFillable": false, "ph": "Inflated / deflated times, pressure, or 'Not inflated'", "help": "Taken from the theatre record."})
        ],
        "Plan": [
          f("nvStatusPostop", "Neurovascular status post-op", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Pulses, capillary refill, motor and sensory function distal to the operation", "help": "A physical examination you performed. Not dictated."}),
          f("renalPlan", "Creatine kinase, renal and urine output monitoring", {"type": "text", "required": true, "aiFillable": true})
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
    "lumbar-laminectomy-stenosis": {
      base: "operative", title: "Lumbar laminectomy for canal stenosis",
      prefill: {"procedure": "Lumbar laminectomy for canal stenosis"},
      extra: {
        "Operative detail": [
          f("levelsDecompressed", "Levels decompressed and image confirmation", {"type": "text", "required": true, "aiFillable": false, "ph": "L3-4, L4-5; level image saved"}),
          f("lateralRecessForamina", "Lateral recess and foraminal decompression (sides)", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2}),
          f("facetParsRemaining", "Facets and pars remaining, stability judgement", {"type": "text", "required": true, "aiFillable": true, "ph": "Facets preserved more than half, pars intact"}),
          f("durotomyRepair", "Durotomy and repair", {"type": "text", "required": true, "aiFillable": false, "ph": "None / site, size, repair, Valsalva tested"}),
          f("mobilisationPlan", "Mobilisation instruction", {"type": "text", "required": false, "aiFillable": true, "ph": "Mobilise day 0 / bed rest per durotomy plan"})
        ]
      }
    },
    "mastoidectomy": {
      base: "operative", title: "Mastoidectomy",
      prefill: {"procedure": "Cortical mastoidectomy / modified radical (canal wall down) mastoidectomy"},
      extra: {
        "Operative detail": [
          f("mastoidType", "Operation performed", {"type": "text", "required": true, "aiFillable": true, "ph": "Cortical (canal wall up) / modified radical (canal wall down); meatoplasty"}),
          f("landmarksIdentified", "Landmarks identified", {"type": "text", "required": true, "aiFillable": false, "ph": "Tegmen, sigmoid sinus, antrum, lateral semicircular canal, facial nerve"}),
          f("cholesteatomaExtent", "Disease extent and clearance", {"type": "textarea", "required": false, "aiFillable": true, "rows": 3, "ph": "Sites involved; residual left (where and why)"}),
          f("ossicularFistula", "Ossicles, fistula and facial canal", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Incus eroded / intact; stapes present, mobile; fistula yes / no; facial canal dehiscence"}),
          f("facialMonitoringUsed", "Facial nerve monitoring", {"type": "text", "required": false, "aiFillable": false, "ph": "Used, tap test confirmed / not used"}),
          f("postopFacialGrade", "Facial function in recovery", {"type": "text", "required": true, "aiFillable": false, "ph": "House-Brackmann grade, time, examiner", "help": "Examined in recovery by a named clinician."})
        ]
      }
    },
    "mcdonald-cerclage": {
      base: "operative", title: "Cervical cerclage (McDonald)",
      prefill: {"procedure": "Transvaginal cervical cerclage (McDonald)"},
      extra: {
        "Operative detail": [
          f("cerclageIndication", "Indication category and gestation", {"type": "text", "required": true, "aiFillable": true, "ph": "History / ultrasound (cervical length) / rescue; gestation"}),
          f("sutureAndKnot", "Suture material, number of bites and knot position", {"type": "text", "required": true, "aiFillable": false, "ph": "Material; 5 bites; knot anterior, ends long"}),
          f("membranesAtEnd", "Membrane status at the end of the procedure", {"type": "text", "required": true, "aiFillable": false, "ph": "Intact, behind the os"}),
          f("fetalHeartCheck", "Fetal heart confirmed after the procedure", {"type": "text", "required": true, "aiFillable": false}),
          f("removalPlan", "Removal plan", {"type": "text", "required": true, "aiFillable": true, "ph": "Removal at 36 to 37 weeks, or earlier with labour or ruptured membranes"})
        ]
      }
    },
    "median-sternotomy": {
      base: "operative", title: "Median sternotomy and closure",
      prefill: {"procedure": "Median sternotomy and closure"},
      extra: {
        "Operative detail": [
          f("redoEntry", "Primary or redo entry", {"type": "text", "required": true, "aiFillable": false, "ph": "Primary / redo, method of re-entry"}),
          f("sternalQuality", "Sternal quality and midline", {"type": "text", "required": false, "aiFillable": true, "ph": "Midline, good bone / osteoporotic / paramedian"}),
          f("wireNumber", "Wires and reinforcement", {"type": "text", "required": true, "aiFillable": false, "ph": "Number of wires, figure-of-eight, plates"}),
          f("pacingWires", "Pacing wires placed", {"type": "text", "required": true, "aiFillable": false, "ph": "Atrial / ventricular, thresholds"}),
          f("chestOpen", "Sternum left open", {"type": "text", "required": false, "aiFillable": false, "ph": "No / yes, membrane, packs left"})
        ]
      }
    },
    "microlaryngoscopy-biopsy": {
      base: "operative", title: "Microlaryngoscopy and biopsy",
      prefill: {"procedure": "Direct laryngoscopy and microlaryngoscopy with biopsy"},
      extra: {
        "Operative detail": [
          f("ventilationTechnique", "Ventilation technique", {"type": "text", "required": true, "aiFillable": true, "ph": "Microlaryngoscopy tube size / jet / tubeless; laser precautions"}),
          f("exposureNote", "Exposure and laryngoscope used", {"type": "text", "required": true, "aiFillable": true, "ph": "Easy / difficult; which laryngoscope; external pressure needed"}),
          f("lesionMap", "Lesion map by subsite", {"type": "textarea", "required": true, "aiFillable": true, "rows": 3, "ph": "Supraglottis, glottis, anterior commissure, subglottis, hypopharynx; photographs taken"}),
          f("dentitionAfter", "Dentition checked at end", {"type": "text", "required": true, "aiFillable": false, "ph": "Unchanged / injury (detail and patient informed)"}),
          f("airwayDisposition", "Airway disposition", {"type": "text", "required": true, "aiFillable": false, "ph": "Extubated / kept intubated / tracheostomy; level of care"})
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
    "modified-radical-neck-dissection": {
      base: "operative", title: "Modified radical neck dissection note",
      prefill: {"procedure": "Modified radical neck dissection"},
      extra: {
        "Operative detail": [
          f("operatedSide", "Side of neck dissection", {"type": "text", "required": true, "aiFillable": false, "ph": "Right or left"}),
          f("levelsCleared", "Levels cleared", {"type": "text", "required": true, "aiFillable": false, "ph": "I, II (IIa and IIb), III, IV, V"}),
          f("structuresPreserved", "Non-lymphatic structures preserved or sacrificed", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Accessory nerve, internal jugular vein, sternocleidomastoid"}),
          f("nervesIdentified", "Nerves identified and status", {"type": "textarea", "required": true, "aiFillable": false, "rows": 3, "ph": "Marginal mandibular, hypoglossal, lingual, vagus, phrenic, brachial plexus"}),
          f("chyleCheck", "Chyle check at base of neck", {"type": "text", "required": true, "aiFillable": false, "ph": "Valsalva: no leak; duct ligated"})
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
    "open-fracture-debridement": {
      base: "operative", title: "Open fracture debridement and external fixation",
      prefill: {"procedure": "Debridement of open fracture, lavage and spanning external fixation"},
      extra: {
        "Operative detail": [
          f("gustilo", "Gustilo-Anderson grade (after debridement)", {"type": "text", "required": true, "aiFillable": true, "ph": "I / II / IIIA / IIIB / IIIC"}),
          f("tissueExcised", "Tissue excised, layer by layer", {"type": "textarea", "required": true, "aiFillable": true, "rows": 4, "ph": "Skin, fat, fascia, muscle by compartment, bone fragments removed"}),
          f("lavageVolume", "Irrigation fluid and volume", {"type": "text", "required": false, "aiFillable": true}),
          f("frameConstruct", "Frame construct and pin sites", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2}),
          f("coverPlan", "Plan and date for definitive fixation and soft-tissue cover", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2})
        ],
        "Accounting": [
          f("implantRegister", "Implant register: make, size, serial / lot number", {"type": "textarea", "required": true, "aiFillable": false, "rows": 3, "ph": "Each implant on its own line", "help": "Copy from the implant stickers. A physical record, never AI-filled."}),
          f("imageIntensifier", "Image intensifier dose and screening time", {"type": "text", "required": true, "aiFillable": false, "ph": "e.g. dose (cGy cm2) and time (s) from the C-arm", "help": "Read from the machine at the end of the case."}),
          f("tourniquetTime", "Tourniquet time and pressure", {"type": "text", "required": false, "aiFillable": false, "ph": "Inflated / deflated times, pressure, or 'Not inflated'", "help": "Taken from the theatre record."})
        ],
        "Plan": [
          f("nvStatusPostop", "Neurovascular status post-op", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Pulses, capillary refill, motor and sensory function distal to the operation", "help": "A physical examination you performed. Not dictated."})
        ]
      }
    },
    "open-myomectomy": {
      base: "operative", title: "Open myomectomy",
      prefill: {"procedure": "Open (abdominal) myomectomy"},
      extra: {
        "Operative detail": [
          f("fibroidsRemoved", "Fibroids removed: number, sites, sizes", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Number; FIGO type and location; largest size"}),
          f("cavityEntered", "Endometrial cavity entered", {"type": "text", "required": true, "aiFillable": false, "ph": "No / yes, closed separately"}),
          f("bloodLossMeasures", "Vasoconstrictor (agent, total dose) and tourniquet time", {"type": "text", "required": true, "aiFillable": false}),
          f("myometrialRepair", "Myometrial repair: depth and layers", {"type": "text", "required": false, "aiFillable": true, "ph": "Deepest defect; layers; dead space closed"}),
          f("futurePregnancyAdvice", "Advice for future pregnancy", {"type": "textarea", "required": false, "aiFillable": true, "rows": 2, "ph": "Interval before conception; mode of birth advice"})
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
    "open-subtotal-cholecystectomy": {
      base: "operative", title: "Open / subtotal cholecystectomy",
      prefill: {"procedure": "Open cholecystectomy / subtotal cholecystectomy", "incision": "Right subcostal"},
      extra: {
        "Operative detail": [
          f("conversionReason", "Reason for open or bail-out operation", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "CVS not achievable: fused hepatocystic triangle, gangrenous gallbladder"}),
          f("operationType", "Operation performed", {"type": "text", "required": true, "aiFillable": true, "ph": "Total / subtotal fenestrating / subtotal reconstituting / cholecystostomy"}),
          f("cysticDuctManagement", "Cystic duct and artery management", {"type": "text", "required": true, "aiFillable": false, "ph": "Ligated / orifice closed from inside / left open and drained"}),
          f("stonesCleared", "All stones removed from remnant and pouch", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes / no (where)"}),
          f("cholangiogram", "Cholangiogram result", {"type": "text", "required": false, "aiFillable": true, "ph": "Not done / normal / filling defect / anatomy"}),
          f("ductInjury", "Bile duct injury suspected and action", {"type": "text", "required": true, "aiFillable": false, "ph": "None / suspected: drained, HPB referral (name, time)"})
        ]
      }
    },
    "open-ventral-hernia-repair": {
      base: "operative", title: "Open umbilical or incisional hernia repair",
      prefill: {"procedure": "Open ventral hernia repair with mesh"},
      extra: {
        "Operative detail": [
          f("herniaClass", "Hernia type and EHS classification", {"type": "text", "required": true, "aiFillable": true, "ph": "Incisional, midline M3, W2"}),
          f("defectSize", "Defect width x length and number of defects", {"type": "text", "required": true, "aiFillable": true, "ph": "6 x 8 cm, single defect"}),
          f("meshPlane", "Mesh plane and overlap", {"type": "text", "required": true, "aiFillable": true, "ph": "Retromuscular, 5 cm overlap all directions"}),
          f("posteriorLayerIntact", "Posterior layer closed with no exposed mesh", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes, two buttonholes repaired"}),
          f("contaminationDecision", "Contamination or enterotomy, and mesh decision", {"type": "textarea", "required": false, "aiFillable": true, "rows": 2, "ph": "None / enterotomy repaired, mesh plan changed to ..."})
        ]
      }
    },
    "paeds-circumcision": {
      base: "operative", title: "Paediatric circumcision",
      prefill: {"procedure": "Circumcision"},
      extra: {
        "Operative detail": [
          f("circIndication", "Indication", {"type": "text", "required": true, "aiFillable": true, "ph": "Lichen sclerosus / recurrent balanoposthitis / non-therapeutic (legal and consent requirements met)"}),
          f("anatomyCheck", "Anatomy check: meatus normal, hypospadias and buried penis excluded", {"type": "text", "required": true, "aiFillable": false}),
          f("meatusFindings", "Meatal findings and any meatal procedure", {"type": "text", "required": false, "aiFillable": true, "ph": "Normal / stenosed, meatotomy performed"}),
          f("frenularHaemostasis", "Frenular artery control", {"type": "text", "required": true, "aiFillable": false, "ph": "Bipolar / ligated; bipolar only used"}),
          f("localAnaesthetic", "Local anaesthetic agent and total dose (no adrenaline)", {"type": "text", "required": true, "aiFillable": false, "help": "Combined surgeon and anaesthetist total, mg/kg"})
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
    "paeds-intussusception-reduction": {
      base: "operative", title: "Operative reduction of intussusception",
      prefill: {"procedure": "Laparotomy and operative reduction of intussusception"},
      extra: {
        "Operative detail": [
          f("enemaHistory", "Pre-operative enema attempts and result", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Air / hydrostatic; number of attempts; how far reduced; perforation"}),
          f("intussusceptionExtent", "Type and extent of intussusception", {"type": "text", "required": false, "aiFillable": true, "ph": "Ileocolic, apex at hepatic flexure"}),
          f("reductionOutcome", "Manual reduction outcome", {"type": "text", "required": true, "aiFillable": true, "ph": "Complete / incomplete, resection required"}),
          f("bowelViabilityAssessment", "Bowel viability after warm packs", {"type": "text", "required": true, "aiFillable": false, "ph": "Viable / serosal splits / non-viable, resected"}),
          f("leadPointAndAppendix", "Lead point found, small bowel run, appendix removed", {"type": "textarea", "required": false, "aiFillable": true, "rows": 2, "ph": "No pathological lead point; Peyer patch; appendix removed"})
        ]
      }
    },
    "paeds-ladd-procedure": {
      base: "operative", title: "Ladd procedure",
      prefill: {"procedure": "Laparotomy for malrotation (Ladd procedure)"},
      extra: {
        "Operative detail": [
          f("volvulusFindings", "Volvulus: present or absent, direction and number of turns", {"type": "text", "required": true, "aiFillable": true, "ph": "Clockwise volvulus, 2 turns, derotated anticlockwise"}),
          f("midgutViability", "Midgut viability after derotation and length resected or remaining", {"type": "text", "required": true, "aiFillable": false, "ph": "All viable / segments resected (length) / doubtful, second look"}),
          f("laddStepsCompleted", "Ladd bands divided, mesentery widened, bowel placed in non-rotation", {"type": "text", "required": true, "aiFillable": true, "ph": "Bands divided; base widened; caecum left upper quadrant"}),
          f("duodenalPatency", "Duodenal patency confirmed", {"type": "text", "required": true, "aiFillable": false, "ph": "Nasogastric tube passed into jejunum"}),
          f("secondLookPlan", "Second-look laparotomy plan", {"type": "text", "required": false, "aiFillable": true, "ph": "Not required / planned within agreed window"})
        ]
      }
    },
    "paeds-orchidopexy": {
      base: "operative", title: "Inguinal orchidopexy",
      prefill: {"procedure": "Inguinal orchidopexy with subdartos pouch"},
      extra: {
        "Operative detail": [
          f("euaPosition", "Testis position on examination under anaesthesia (side, lowest point reached)", {"type": "text", "required": true, "aiFillable": false, "ph": "Left / right; superficial inguinal pouch / canal / suprascrotal"}),
          f("testisAppearance", "Testis size and appearance, epididymis", {"type": "text", "required": false, "aiFillable": true, "ph": "Size compared with the other side; epididymal anomalies"}),
          f("processusLigated", "Patent processus vaginalis separated and ligated", {"type": "text", "required": true, "aiFillable": false, "ph": "Present and ligated at internal ring / not patent"}),
          f("finalTestisPosition", "Final testis position and cord orientation checked", {"type": "text", "required": true, "aiFillable": false, "ph": "Bottom of scrotum, no tension, cord not twisted"}),
          f("stagingPlan", "Second-stage or nubbin plan, if any", {"type": "textarea", "required": false, "aiFillable": true, "rows": 2, "ph": "None / staged, second stage planned / nubbin excised for histology"})
        ]
      }
    },
    "pancreaticoduodenectomy": {
      base: "operative", title: "Pancreaticoduodenectomy",
      prefill: {"procedure": "Pancreaticoduodenectomy (Whipple)"},
      extra: {
        "Operative detail": [
          f("resectability", "Resectability findings", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "No metastases; SMV/PV free / venous resection; SMA free"}),
          f("arterialAnatomy", "Arterial anatomy and GDA test clamp", {"type": "text", "required": true, "aiFillable": false, "ph": "Standard / replaced RHA; hepatic pulse present on GDA clamp"}),
          f("glandDuct", "Gland texture and pancreatic duct diameter", {"type": "text", "required": true, "aiFillable": false, "ph": "Soft / firm; duct x mm", "help": "Main predictors of pancreatic fistula"}),
          f("reconstruction", "Reconstruction", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "PJ duct-to-mucosa with stent / PG; HJ end-to-side; antecolic GJ"}),
          f("frozenSection", "Frozen section margins", {"type": "text", "required": false, "aiFillable": false, "ph": "Neck clear, bile duct clear / not sent"})
        ]
      }
    },
    "parathyroidectomy": {
      base: "operative", title: "Parathyroidectomy note",
      prefill: {"procedure": "Parathyroidectomy"},
      extra: {
        "Operative detail": [
          f("approach", "Approach and any conversion", {"type": "text", "required": true, "aiFillable": true, "ph": "Focused right inferior; converted to bilateral exploration because ..."}),
          f("localisationConcordance", "Pre-operative localisation and concordance", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Ultrasound and sestamibi concordant for right inferior"}),
          f("glandsIdentified", "Glands identified and removed, by position", {"type": "textarea", "required": true, "aiFillable": false, "rows": 3, "ph": "RS normal in situ, RI adenoma excised, LS/LI not explored", "help": "Physical finding: name each gland by side and position."}),
          f("iopthValues", "Intra-operative PTH values and times", {"type": "textarea", "required": false, "aiFillable": false, "rows": 3, "ph": "Baseline, pre-excision, 10 minutes post-excision", "help": "Laboratory values: transcribe, do not estimate."}),
          f("rlnStatus", "Recurrent laryngeal nerve status", {"type": "text", "required": true, "aiFillable": false, "ph": "Identified and preserved on the explored side(s)"})
        ]
      }
    },
    "pilonidal-sinus-excision": {
      base: "operative", title: "Pilonidal sinus excision",
      prefill: {"procedure": "Excision of pilonidal sinus"},
      extra: {
        "Operative detail": [
          f("pitsTracts", "Pits and lateral tracts found", {"type": "text", "required": true, "aiFillable": true, "ph": "4 midline pits, 1 lateral opening left side"}),
          f("woundTechnique", "Wound technique", {"type": "text", "required": true, "aiFillable": true, "ph": "Laid open / Karydakis / cleft lift / Limberg"}),
          f("flapTension", "Flap tension checked with tapes released", {"type": "text", "required": false, "aiFillable": false, "ph": "Yes, no tension"}),
          f("dressingPlan", "Dressing and hair control plan", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "District nurse dressings alternate days; hair removal advised"})
        ]
      }
    },
    "posterior-lumbar-fusion-tlif": {
      base: "operative", title: "Posterior lumbar instrumented fusion (TLIF)",
      prefill: {"procedure": "Posterior lumbar instrumented fusion (TLIF)"},
      extra: {
        "Operative detail": [
          f("levelsTlifSide", "Fused levels and side of TLIF", {"type": "text", "required": true, "aiFillable": false, "ph": "L4-5, TLIF from the left"}),
          f("screwChecks", "Pedicle screw checks (feeler, imaging, triggered EMG)", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "help": "Physical checks: the surgeon enters these."}),
          f("cagePosition", "Cage position on final imaging", {"type": "text", "required": true, "aiFillable": true, "ph": "Recessed from posterior line, central / oblique"}),
          f("monitoringEvents", "Monitoring events and the response", {"type": "text", "required": false, "aiFillable": true, "ph": "None, or time, change and action"}),
          f("durotomyRepair", "Durotomy and repair", {"type": "text", "required": true, "aiFillable": false, "ph": "None / site, repair, Valsalva tested"})
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
    "quinsy-drainage": {
      base: "operative", title: "Quinsy drainage",
      prefill: {"procedure": "Peritonsillar abscess aspiration and drainage under local anaesthetic"},
      extra: {
        "Operative detail": [
          f("quinsySide", "Side and puncture sites", {"type": "text", "required": true, "aiFillable": true, "ph": "Left / right; superior pole; second site if used"}),
          f("aspirationResult", "Aspiration result", {"type": "text", "required": true, "aiFillable": false, "ph": "Volume and character of pus / dry tap"}),
          f("incisionMade", "Incision and drainage", {"type": "text", "required": true, "aiFillable": true, "ph": "Aspiration only / guarded incision and forceps drainage"}),
          f("localAnaestheticUsed", "Local anaesthetic agent and dose", {"type": "text", "required": true, "aiFillable": false, "ph": "Agent, concentration, volume, with or without adrenaline"}),
          f("trismusAfter", "Trismus and swallowing after drainage", {"type": "text", "required": false, "aiFillable": true, "ph": "Improved / unchanged; tolerating saliva"})
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
    "right-hepatectomy": {
      base: "operative", title: "Right hepatectomy",
      prefill: {"procedure": "Right hepatectomy (segments 5 to 8)"},
      extra: {
        "Operative detail": [
          f("iousFindings", "Intra-operative ultrasound findings", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Lesions mapped; no new lesions in remnant; MHV relation"}),
          f("inflowOutflow", "Inflow and outflow control", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "RHA ligated after test clamp; RPV stapled; RHV stapled extrahepatically / intrahepatically"}),
          f("pringleTime", "Pringle: cycles and total ischaemic time", {"type": "text", "required": true, "aiFillable": false, "ph": "x cycles, total y min"}),
          f("transectionMethod", "Transection technique and CVP", {"type": "text", "required": false, "aiFillable": true, "ph": "CUSA / clamp-crush; low CVP maintained"}),
          f("bileLeakTest", "Bile leak test result", {"type": "text", "required": true, "aiFillable": false, "ph": "White test negative / leaks sutured"})
        ]
      }
    },
    "septoplasty": {
      base: "operative", title: "Septoplasty",
      prefill: {"procedure": "Septoplasty"},
      extra: {
        "Operative detail": [
          f("septalApproach", "Incision and approach", {"type": "text", "required": true, "aiFillable": true, "ph": "Killian / hemitransfixion, left / right; endoscopic or headlight"}),
          f("resectionExtent", "Cartilage and bone resected", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Quadrilateral cartilage, perpendicular plate, vomer, maxillary crest spur"}),
          f("lStrutPreserved", "Dorsal and caudal L-strut preserved", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes, about 1 cm dorsal and caudal / No (detail)", "help": "A physical judgement by the operating surgeon."}),
          f("flapTears", "Flap tears and repair", {"type": "text", "required": true, "aiFillable": false, "ph": "None / unilateral / opposing tears repaired with cartilage interposition"}),
          f("splintsPacksPlan", "Splints, packs or quilting, and removal plan", {"type": "text", "required": true, "aiFillable": false, "ph": "Quilting suture; silicone splints, remove day 7; no packs"})
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
    "splenectomy": {
      base: "operative", title: "Splenectomy",
      prefill: {"procedure": "Splenectomy"},
      extra: {
        "Operative detail": [
          f("indicationType", "Indication and approach", {"type": "text", "required": true, "aiFillable": true, "ph": "Trauma (open) / ITP (laparoscopic) / other"}),
          f("salvageDecision", "Splenic salvage considered and why not", {"type": "text", "required": false, "aiFillable": true, "ph": "Trauma: unstable, hilar injury"}),
          f("pancreaticTail", "Pancreatic tail status", {"type": "text", "required": true, "aiFillable": false, "ph": "Seen and intact / injured, drained"}),
          f("accessorySpleens", "Accessory spleens", {"type": "text", "required": false, "aiFillable": false, "ph": "None found / removed (number, site) / left (trauma)"}),
          f("vaccinationPlan", "Vaccination and antibiotic prophylaxis plan", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Elective: given (date). Emergency: due from 2 weeks post-op. Prophylaxis per national guidance; asplenia alert."})
        ]
      }
    },
    "split-skin-graft": {
      base: "operative", title: "Split-thickness skin graft",
      prefill: {"procedure": "Split-thickness skin graft"},
      extra: {
        "Operative detail": [
          f("recipientBed", "Recipient site, size and bed preparation", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2}),
          f("donorSite", "Graft donor site", {"type": "text", "required": true, "aiFillable": false, "ph": "e.g. left anterolateral thigh", "help": "Where the graft was taken from. Recorded by the operating team."}),
          f("graftDetail", "Dermatome setting and meshing ratio", {"type": "text", "required": true, "aiFillable": true, "ph": "e.g. thickness setting, mesh 1:1.5 or sheet"}),
          f("fixation", "Fixation and dressing", {"type": "text", "required": true, "aiFillable": true, "ph": "Staples / sutures / glue; bolster or negative pressure"}),
          f("donorDressing", "Donor site dressing", {"type": "text", "required": false, "aiFillable": true})
        ],
        "Accounting": [
          f("tourniquetTime", "Tourniquet time and pressure", {"type": "text", "required": false, "aiFillable": false, "ph": "Inflated / deflated times, pressure, or 'Not inflated'", "help": "Taken from the theatre record."})
        ],
        "Plan": [
          f("firstInspection", "Date of first graft inspection", {"type": "text", "required": true, "aiFillable": true}),
          f("nvStatusPostop", "Neurovascular status post-op", {"type": "textarea", "required": false, "aiFillable": false, "rows": 2, "ph": "Pulses, capillary refill, motor and sensory function distal to the operation", "help": "A physical examination you performed. Not dictated."})
        ]
      }
    },
    "superficial-parotidectomy": {
      base: "operative", title: "Superficial parotidectomy",
      prefill: {"procedure": "Superficial parotidectomy with facial nerve identification"},
      extra: {
        "Operative detail": [
          f("facialTrunkIdentification", "Facial nerve trunk identification", {"type": "text", "required": true, "aiFillable": false, "ph": "Antegrade, landmarks used (tragal pointer, tympanomastoid suture, digastric); or retrograde from which branch"}),
          f("nerveStimulation", "Stimulation at end", {"type": "text", "required": true, "aiFillable": false, "ph": "Trunk stimulated, all branches responded / which did not"}),
          f("capsuleIntegrity", "Tumour capsule", {"type": "text", "required": true, "aiFillable": false, "ph": "Intact / breached with spillage (irrigated, reported)"}),
          f("greatAuricularNerve", "Great auricular nerve", {"type": "text", "required": false, "aiFillable": true, "ph": "Posterior branch preserved / divided"}),
          f("postopFacialGrade", "Facial function in recovery", {"type": "text", "required": true, "aiFillable": false, "ph": "House-Brackmann grade per branch, time, examiner"})
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
    "tibial-im-nail": {
      base: "operative", title: "Intramedullary nailing of the tibia",
      prefill: {"procedure": "Reamed locked intramedullary nailing of the tibia"},
      extra: {
        "Operative detail": [
          f("entryPoint", "Entry approach", {"type": "text", "required": true, "aiFillable": true, "ph": "Infrapatellar / suprapatellar / parapatellar"}),
          f("reaming", "Reaming and nail size", {"type": "text", "required": true, "aiFillable": true, "ph": "Reamed to x mm, nail diameter and length"}),
          f("locking", "Locking screws (number, site, static or dynamic)", {"type": "text", "required": true, "aiFillable": true}),
          f("alignment", "Alignment and rotation check", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "help": "Compared with the other leg. A physical check."})
        ],
        "Accounting": [
          f("implantRegister", "Implant register: make, size, serial / lot number", {"type": "textarea", "required": true, "aiFillable": false, "rows": 3, "ph": "Each implant on its own line", "help": "Copy from the implant stickers. A physical record, never AI-filled."}),
          f("imageIntensifier", "Image intensifier dose and screening time", {"type": "text", "required": true, "aiFillable": false, "ph": "e.g. dose (cGy cm2) and time (s) from the C-arm", "help": "Read from the machine at the end of the case."}),
          f("tourniquetTime", "Tourniquet time and pressure", {"type": "text", "required": false, "aiFillable": false, "ph": "Inflated / deflated times, pressure, or 'Not inflated'", "help": "Taken from the theatre record."})
        ],
        "Plan": [
          f("nvStatusPostop", "Neurovascular status post-op", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Pulses, capillary refill, motor and sensory function distal to the operation", "help": "A physical examination you performed. Not dictated."}),
          f("compartmentPlan", "Compartment observation plan", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Hourly observations for 48 hours; block in place?"})
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
    "total-abdominal-hysterectomy": {
      base: "operative", title: "Total abdominal hysterectomy",
      prefill: {"procedure": "Total abdominal hysterectomy"},
      extra: {
        "Operative detail": [
          f("hysterectomyExtent", "Extent: total or subtotal; ovaries conserved or removed", {"type": "text", "required": true, "aiFillable": true, "ph": "TAH, bilateral salpingectomy, ovaries conserved / TAH BSO"}),
          f("uretersIdentified", "Ureters identified before pedicle division", {"type": "text", "required": true, "aiFillable": false, "ph": "Both seen at pelvic brim and traced"}),
          f("bladderIntegrity", "Bladder integrity and urine colour at end", {"type": "text", "required": true, "aiFillable": false, "ph": "Bladder intact, clear urine"}),
          f("cervixComplete", "Cervix confirmed completely removed", {"type": "text", "required": true, "aiFillable": false}),
          f("vaultSupport", "Vault closure and support", {"type": "text", "required": false, "aiFillable": true, "ph": "Angle sutures incorporating cardinal and uterosacral pedicles"})
        ]
      }
    },
    "total-hip-replacement": {
      base: "operative", title: "Total hip replacement (posterior approach)",
      prefill: {"procedure": "Primary total hip replacement", "incision": "Posterior approach to the hip"},
      extra: {
        "Operative detail": [
          f("cupPosition", "Cup size, fixation and orientation", {"type": "text", "required": true, "aiFillable": true, "ph": "Size, cemented or uncemented, screws (quadrant), inclination and anteversion estimate"}),
          f("stemDetail", "Stem size, fixation and head/neck", {"type": "text", "required": true, "aiFillable": true, "ph": "Stem size, cemented or press-fit, head diameter and neck length"}),
          f("hipStability", "Stability and leg length at final reduction", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "help": "Positions tested and the leg length reference used. A physical check."}),
          f("posteriorRepair", "Posterior capsule and rotator repair", {"type": "text", "required": true, "aiFillable": true, "ph": "e.g. capsule and rotators repaired through trochanteric drill holes"}),
          f("cementEvent", "Cement safety pause and any cardiovascular event", {"type": "text", "required": false, "aiFillable": false, "ph": "Pause performed; any hypotension or desaturation at cementing"})
        ],
        "Accounting": [
          f("implantRegister", "Implant register: make, size, serial / lot number", {"type": "textarea", "required": true, "aiFillable": false, "rows": 3, "ph": "Each implant on its own line", "help": "Copy from the implant stickers. A physical record, never AI-filled."})
        ]
      }
    },
    "total-knee-replacement": {
      base: "operative", title: "Total knee replacement",
      prefill: {"procedure": "Primary total knee replacement", "incision": "Midline skin incision, medial parapatellar arthrotomy"},
      extra: {
        "Operative detail": [
          f("alignmentCuts", "Alignment targets and bone cuts", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Distal femoral valgus, tibial slope, resection depths"}),
          f("softTissueRelease", "Soft-tissue releases and gap balance", {"type": "textarea", "required": true, "aiFillable": true, "rows": 2, "ph": "Releases performed, final flexion and extension gaps"}),
          f("patellaDetail", "Patella: resurfaced or not, and tracking", {"type": "text", "required": true, "aiFillable": true}),
          f("finalRange", "Final range and stability on table", {"type": "text", "required": true, "aiFillable": false, "ph": "Extension to flexion in degrees, stability in extension and flexion", "help": "A physical examination finding."}),
          f("tourniquetTime", "Tourniquet pressure and time (or none)", {"type": "text", "required": true, "aiFillable": false, "ph": "Pressure (mmHg) and minutes, or WALANT, no tourniquet", "help": "Read from the tourniquet machine; a physical record."})
        ],
        "Accounting": [
          f("implantRegister", "Implant register: make, size, serial / lot number", {"type": "textarea", "required": true, "aiFillable": false, "rows": 3, "ph": "Each implant on its own line", "help": "Copy from the implant stickers. A physical record, never AI-filled."})
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
    "trigger-finger-release": {
      base: "operative", title: "Trigger finger release",
      prefill: {"procedure": "Open A1 pulley release"},
      extra: {
        "Operative detail": [
          f("digitReleased", "Digit(s) released", {"type": "text", "required": true, "aiFillable": false, "ph": "Side and digit, e.g. right ring finger", "help": "Must match the marked site."}),
          f("pulleyFindings", "A1 pulley and tendon findings", {"type": "text", "required": true, "aiFillable": true, "ph": "Thickened A1, nodule, A2 preserved"}),
          f("activeCheckResult", "Active movement check", {"type": "text", "required": true, "aiFillable": false, "ph": "Full fist and extension without triggering, or not possible (anaesthesia)", "help": "Observed in theatre."}),
          f("tourniquetTime", "Tourniquet pressure and time (or none)", {"type": "text", "required": true, "aiFillable": false, "ph": "Pressure (mmHg) and minutes, or WALANT, no tourniquet", "help": "Read from the tourniquet machine; a physical record."})
        ]
      }
    },
    "tympanoplasty-underlay": {
      base: "operative", title: "Tympanoplasty type 1 (underlay)",
      prefill: {"procedure": "Tympanoplasty type 1 (underlay)"},
      extra: {
        "Operative detail": [
          f("perforationDetail", "Perforation size and site", {"type": "text", "required": true, "aiFillable": true, "ph": "e.g. 40 percent, anteroinferior, margins visible after canalplasty"}),
          f("ossicularChainStatus", "Ossicular chain", {"type": "text", "required": true, "aiFillable": false, "ph": "Intact and mobile, round window reflex present", "help": "A physical test by the surgeon."}),
          f("graftDetail", "Graft material and position", {"type": "text", "required": true, "aiFillable": true, "ph": "Temporalis fascia, underlay, medial to malleus handle"}),
          f("chordaTympani", "Chorda tympani", {"type": "text", "required": true, "aiFillable": false, "ph": "Preserved / stretched / divided"}),
          f("postopFacialGrade", "Facial function in recovery", {"type": "text", "required": true, "aiFillable": false, "ph": "House-Brackmann grade, time, examiner"})
        ]
      }
    },
    "uro-adult-circumcision": {
      base: "operative", title: "Adult circumcision",
      prefill: {"procedure": "Adult circumcision"},
      extra: {
        "Operative detail": [
          f("penileBlock", "Penile block: agent and volume, no adrenaline", {"type": "text", "required": true, "aiFillable": false, "ph": "e.g. plain agent, volume, dorsal nerve and ring block"}),
          f("prepuceGlans", "Prepuce, glans and meatus appearance", {"type": "text", "required": true, "aiFillable": true, "ph": "e.g. lichen sclerosus, meatus normal / stenosed, no lesion"}),
          f("frenularArtery", "Frenular artery management", {"type": "text", "required": true, "aiFillable": false, "ph": "Ligated / bipolar; haemostasis confirmed"}),
          f("suspiciousLesion", "Suspicious lesion found", {"type": "text", "required": true, "aiFillable": false, "ph": "None / biopsied and circumcision not completed"})
        ]
      }
    },
    "uro-dj-stent": {
      base: "operative", title: "Retrograde double-J stent insertion",
      prefill: {"procedure": "Retrograde double-J ureteric stent insertion"},
      extra: {
        "Operative detail": [
          f("obstructionLevel", "Level and cause of obstruction on pyelogram", {"type": "text", "required": true, "aiFillable": true, "ph": "e.g. right PUJ, impacted stone at the pelvic brim"}),
          f("pelvicUrine", "Urine from the renal pelvis; cultures sent", {"type": "text", "required": true, "aiFillable": false, "ph": "Clear / cloudy / pus; bladder and pelvic samples sent separately: Yes / No"}),
          f("stentSpec", "Stent type, diameter, length and side", {"type": "text", "required": true, "aiFillable": false, "ph": "e.g. left double-J, diameter Fr, length cm, no string"}),
          f("stentPositionConfirmed", "Both coils confirmed on saved image", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes / No"}),
          f("stentRemovalPlan", "Stent register entry and removal or exchange date", {"type": "text", "required": true, "aiFillable": false, "ph": "Registered: Yes / No; date"}),
          f("decompressionOnly", "Definitive treatment deferred and plan", {"type": "text", "required": false, "aiFillable": true, "ph": "e.g. decompression only for infection; ureteroscopy after antibiotics"})
        ]
      }
    },
    "uro-hydrocele-repair": {
      base: "operative", title: "Hydrocele repair",
      prefill: {"procedure": "Hydrocele repair"},
      extra: {
        "Operative detail": [
          f("usTestisNormal", "Pre-operative ultrasound: testis normal", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes, date / No (then why proceed)"}),
          f("hydroceleTechnique", "Technique", {"type": "text", "required": true, "aiFillable": true, "ph": "Jaboulay eversion (with or without excision) / Lord plication"}),
          f("fluidAndSac", "Fluid character and sac thickness", {"type": "text", "required": true, "aiFillable": true, "ph": "e.g. clear straw fluid, thin sac"}),
          f("testisEpididymis", "Testis and epididymis on inspection", {"type": "text", "required": true, "aiFillable": false, "ph": "Normal / abnormal, describe and action"})
        ]
      }
    },
    "uro-inguinal-orchidectomy": {
      base: "operative", title: "Radical inguinal orchidectomy",
      prefill: {"procedure": "Radical inguinal orchidectomy"},
      extra: {
        "Operative detail": [
          f("preopMarkers", "Pre-operative tumour markers drawn", {"type": "text", "required": true, "aiFillable": false, "ph": "AFP, beta-hCG, LDH: date drawn"}),
          f("spermBanking", "Sperm banking offered and outcome", {"type": "text", "required": true, "aiFillable": false, "ph": "Offered: Yes; banked / declined / not possible"}),
          f("cordLigation", "Cord control and ligation level; marker suture", {"type": "text", "required": true, "aiFillable": false, "ph": "Early clamp at deep ring: Yes; ligation at deep ring; non-absorbable marker: Yes"}),
          f("prosthesisDetail", "Prosthesis", {"type": "text", "required": true, "aiFillable": false, "ph": "Declined / inserted: type, size, batch"}),
          f("contralateralTestis", "Contralateral testis assessment and biopsy", {"type": "text", "required": false, "aiFillable": false, "ph": "Normal on ultrasound / biopsy taken and why"})
        ]
      }
    },
    "uro-pcnl": {
      base: "operative", title: "Percutaneous nephrolithotomy",
      prefill: {"procedure": "Percutaneous nephrolithotomy (PCNL)"},
      extra: {
        "Operative detail": [
          f("pcnlPosition", "Position and puncture guidance", {"type": "text", "required": true, "aiFillable": true, "ph": "Prone / supine; fluoroscopy / ultrasound"}),
          f("accessCalyx", "Calyx punctured and relation to ribs", {"type": "text", "required": true, "aiFillable": false, "ph": "e.g. posterior lower pole calyx, subcostal"}),
          f("tractSize", "Tract dilatation method and sheath size", {"type": "text", "required": true, "aiFillable": false, "ph": "Balloon / serial / one-shot; sheath Fr"}),
          f("stoneFreeStatus", "Stone-free status at the end", {"type": "text", "required": true, "aiFillable": false, "ph": "Stone-free / residual fragments / significant residual stone, and plan"}),
          f("exitStrategy", "Exit: nephrostomy, stent or tubeless", {"type": "text", "required": true, "aiFillable": false, "ph": "Nephrostomy size / double-J / tubeless; image saved"}),
          f("chestCheck", "Chest assessment after access", {"type": "text", "required": true, "aiFillable": false, "ph": "Not needed (subcostal) / fluoroscopy clear / chest X-ray requested"})
        ]
      }
    },
    "uro-radical-nephrectomy": {
      base: "operative", title: "Radical nephrectomy",
      prefill: {"procedure": "Radical nephrectomy"},
      extra: {
        "Operative detail": [
          f("rnApproach", "Approach and conversion", {"type": "text", "required": true, "aiFillable": true, "ph": "Laparoscopic transperitoneal / retroperitoneoscopic / open (incision); converted: No / Yes and reason"}),
          f("hilarVessels", "Renal arteries and veins: number found and how ligated", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "e.g. 1 artery, 1 vein; clips / stapler; vein flattened after artery ligation"}),
          f("adrenalNodes", "Adrenal and lymph node decisions", {"type": "text", "required": true, "aiFillable": true, "ph": "Adrenal spared / removed (reason); nodes not dissected / dissected"}),
          f("venousThrombus", "Renal vein or caval thrombus", {"type": "text", "required": true, "aiFillable": false, "ph": "None / renal vein / caval, level and management"}),
          f("visceralInjury", "Visceral or vascular injury", {"type": "text", "required": true, "aiFillable": false, "ph": "None / organ, recognition and repair"})
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
    "uro-ureteroscopy-laser": {
      base: "operative", title: "Ureteroscopy and laser lithotripsy",
      prefill: {"procedure": "Ureteroscopy with laser lithotripsy"},
      extra: {
        "Operative detail": [
          f("stoneSiteSize", "Stone side, site, size and number", {"type": "text", "required": true, "aiFillable": true, "ph": "e.g. left distal ureter, single stone, size on CT"}),
          f("scopeAccess", "Scopes used and access sheath", {"type": "text", "required": true, "aiFillable": true, "ph": "Semirigid / flexible; sheath size or none"}),
          f("laserSettings", "Laser type and settings", {"type": "text", "required": true, "aiFillable": false, "ph": "Holmium / thulium; fibre size; energy and frequency"}),
          f("stoneFreeStatus", "Stone-free status at the end", {"type": "text", "required": true, "aiFillable": false, "ph": "Stone-free / small residual fragments / significant residual stone"}),
          f("ureteralInjury", "Ureteric injury on withdrawal inspection", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "None / mucosal / perforation / other, and action"}),
          f("stentRemovalPlan", "Stent detail and removal date", {"type": "text", "required": true, "aiFillable": false, "ph": "No stent, or type, size, length, string, removal date booked", "help": "Every stent goes on the register."})
        ]
      }
    },
    "uro-varicocelectomy": {
      base: "operative", title: "Subinguinal microsurgical varicocelectomy",
      prefill: {"procedure": "Subinguinal microsurgical varicocelectomy"},
      extra: {
        "Operative detail": [
          f("variSideGrade", "Side and clinical grade", {"type": "text", "required": true, "aiFillable": true, "ph": "e.g. left, grade III"}),
          f("arteriesPreserved", "Testicular arteries identified and preserved", {"type": "text", "required": true, "aiFillable": false, "ph": "Number; Doppler and vasodilator used: Yes / No"}),
          f("veinsLigated", "Internal and external spermatic veins ligated", {"type": "text", "required": true, "aiFillable": false, "ph": "Number internal / external; gubernacular veins: Yes / No"}),
          f("lymphaticsVas", "Lymphatics and vas with its vessels preserved", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes / No, detail"})
        ]
      }
    },
    "vats-bullectomy-pleurodesis": {
      base: "operative", title: "VATS bullectomy and pleurodesis",
      prefill: {"procedure": "VATS bullectomy with pleurodesis"},
      extra: {
        "Operative detail": [
          f("lungIsolation", "Lung isolation method", {"type": "text", "required": false, "aiFillable": true, "ph": "DLT / blocker; confirmed on bronchoscopy"}),
          f("bullaeResected", "Bullae found and resected", {"type": "text", "required": true, "aiFillable": true, "ph": "Site, number, staple loads"}),
          f("pleurodesisMethod", "Pleurodesis method and extent", {"type": "text", "required": true, "aiFillable": true, "ph": "Abrasion / apical pleurectomy / talc"}),
          f("leakTest", "Air leak test result", {"type": "text", "required": true, "aiFillable": false, "ph": "No leak / leak repaired"}),
          f("conversion", "Conversion to thoracotomy", {"type": "text", "required": false, "aiFillable": false, "ph": "No / yes, reason"})
        ]
      }
    },
    "vp-shunt-insertion": {
      base: "operative", title: "Ventriculoperitoneal shunt insertion",
      prefill: {"procedure": "Ventriculoperitoneal shunt insertion"},
      extra: {
        "Operative detail": [
          f("valveTypeSetting", "Valve make, type and setting", {"type": "text", "required": true, "aiFillable": false, "ph": "Fixed / programmable; setting; anti-siphon or gravitational device", "help": "Read from the packaging and the programmer, not from memory."}),
          f("ventricularCatheter", "Ventricular entry point, passes and catheter length", {"type": "text", "required": true, "aiFillable": false, "ph": "Right Kocher point, 1 pass, 6 cm at outer table"}),
          f("csfOpeningSamples", "CSF appearance, opening pressure and samples sent", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "ph": "Clear / bloodstained / cloudy; cell count, protein, culture sent"}),
          f("distalFlowPeritoneal", "Distal flow confirmed and peritoneal placement method", {"type": "text", "required": true, "aiFillable": false, "ph": "Spontaneous drip seen; open mini-laparotomy / laparoscopic"}),
          f("infectionBundle", "Shunt infection bundle followed", {"type": "text", "required": false, "aiFillable": false, "ph": "First on list, glove change, impregnated catheters, limited traffic"})
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
    },
    "phacoemulsification": {
      base: "operative", title: "Phacoemulsification with foldable lens implant",
      prefill: {"procedure": "Phacoemulsification with foldable intraocular lens implant"},
      extra: {
        "Operative detail": [
          f("operativeEye", "Operative eye", {"type": "text", "required": true, "aiFillable": false, "ph": "Right / Left"}),
          f("anaesthesiaType", "Anaesthesia", {"type": "text", "required": true, "aiFillable": true, "ph": "Topical + intracameral / sub-Tenon / peribulbar / GA"}),
          f("iolImplant", "Implant: model, power, placement, serial / lot number", {"type": "textarea", "required": true, "aiFillable": false, "ph": "Model, power (D), in the bag / sulcus, sticker", "rows": 2, "help": "Copy from the implant sticker. A physical record, never AI-filled."}),
          f("capsuleIntegrity", "Posterior capsule and vitreous", {"type": "text", "required": true, "aiFillable": false, "ph": "Intact / tear, vitreous loss, anterior vitrectomy"}),
          f("intracameralDrug", "Intracameral antibiotic: drug, dose and batch", {"type": "text", "required": true, "aiFillable": false, "ph": "Cefuroxime 1 mg / 0.1 mL, batch"}),
          f("woundSealed", "Wounds sealed, pressure", {"type": "text", "required": false, "aiFillable": true, "ph": "Self-sealing, Seidel negative, pressure normal"})
        ]
      }
    },
    "manual-sics": {
      base: "operative", title: "Manual small-incision cataract surgery (SICS)",
      prefill: {"procedure": "Manual small-incision cataract surgery with intraocular lens implant"},
      extra: {
        "Operative detail": [
          f("operativeEye", "Operative eye", {"type": "text", "required": true, "aiFillable": false, "ph": "Right / Left"}),
          f("tunnelDetail", "Tunnel: site, external length, entry", {"type": "text", "required": true, "aiFillable": true, "ph": "Superior / temporal, 6.5 mm, self-sealing"}),
          f("deliveryMethod", "Nucleus delivery", {"type": "text", "required": true, "aiFillable": true, "ph": "Irrigating vectis / viscoexpression / fish hook"}),
          f("iolImplant", "Implant: model, power, placement, serial / lot number", {"type": "textarea", "required": true, "aiFillable": false, "ph": "Model, power (D), in the bag / sulcus / AC", "rows": 2, "help": "Copy from the implant sticker. A physical record, never AI-filled."}),
          f("capsuleIntegrity", "Posterior capsule and vitreous", {"type": "text", "required": true, "aiFillable": false, "ph": "Intact / tear, vitreous loss, anterior vitrectomy"}),
          f("intracameralDrug", "Intracameral antibiotic: drug, dose and batch", {"type": "text", "required": true, "aiFillable": false})
        ]
      }
    },
    "trabeculectomy": {
      base: "operative", title: "Trabeculectomy with mitomycin C",
      prefill: {"procedure": "Trabeculectomy with mitomycin C"},
      extra: {
        "Operative detail": [
          f("operativeEye", "Operative eye", {"type": "text", "required": true, "aiFillable": false, "ph": "Right / Left"}),
          f("mmcDetail", "Mitomycin C: concentration, time, sponges counted out", {"type": "text", "required": true, "aiFillable": false, "ph": "0.2 mg/mL, 2 min, 3 sponges in and out"}),
          f("flapSutures", "Flap sutures: number, releasable or adjustable", {"type": "text", "required": true, "aiFillable": true, "ph": "2 fixed + 2 releasable 10-0 nylon"}),
          f("conjClosure", "Conjunctival closure and Seidel test", {"type": "text", "required": true, "aiFillable": false, "ph": "Watertight, Seidel negative"}),
          f("endPressure", "Chamber depth and pressure at the end", {"type": "text", "required": false, "aiFillable": true, "ph": "Deep, pressure normal to palpation"})
        ]
      }
    },
    "prk": {
      base: "operative", title: "Photorefractive keratectomy (PRK)",
      prefill: {"procedure": "Photorefractive keratectomy"},
      extra: {
        "Operative detail": [
          f("operativeEye", "Eye(s) treated", {"type": "text", "required": true, "aiFillable": false, "ph": "Right / Left / Both"}),
          f("treatmentProfile", "Laser treatment: refraction entered, optical zone, ablation depth", {"type": "textarea", "required": true, "aiFillable": false, "ph": "Copied from the laser printout", "rows": 2}),
          f("epitheliumMethod", "Epithelial removal", {"type": "text", "required": true, "aiFillable": true, "ph": "Alcohol 20% / brush / transepithelial"}),
          f("mmcDetail", "Mitomycin C: concentration and time (or none)", {"type": "text", "required": true, "aiFillable": false, "ph": "0.02%, 15 s / none"}),
          f("trackingEvents", "Tracking loss or interruption", {"type": "text", "required": false, "aiFillable": true, "ph": "None / percentage completed and action"})
        ]
      }
    },
    "lasik": {
      base: "operative", title: "Laser in situ keratomileusis (LASIK)",
      prefill: {"procedure": "Laser in situ keratomileusis"},
      extra: {
        "Operative detail": [
          f("operativeEye", "Eye(s) treated", {"type": "text", "required": true, "aiFillable": false, "ph": "Right / Left / Both"}),
          f("flapDetail", "Flap: device, thickness, diameter, hinge", {"type": "text", "required": true, "aiFillable": false, "ph": "Femtosecond, 110 microns, 9.0 mm, superior hinge"}),
          f("treatmentProfile", "Laser treatment: refraction entered, optical zone, ablation depth, residual bed", {"type": "textarea", "required": true, "aiFillable": false, "ph": "Copied from the laser printout", "rows": 2}),
          f("flapEvents", "Flap or suction events", {"type": "text", "required": false, "aiFillable": true, "ph": "None / suction loss, action"}),
          f("interfaceCheck", "Flap position and interface at the end", {"type": "text", "required": true, "aiFillable": true, "ph": "Aligned, no striae, clean interface"})
        ]
      }
    },
    "pterygium-excision-autograft": {
      base: "operative", title: "Pterygium excision with conjunctival autograft",
      prefill: {"procedure": "Pterygium excision with conjunctival autograft"},
      extra: {
        "Operative detail": [
          f("operativeEye", "Operative eye and side", {"type": "text", "required": true, "aiFillable": false, "ph": "Right nasal / Left nasal / temporal"}),
          f("cornealExtent", "Extent onto the cornea", {"type": "text", "required": false, "aiFillable": true, "ph": "mm from the limbus"}),
          f("graftDetail", "Graft: size, donor site, fixation", {"type": "text", "required": true, "aiFillable": true, "ph": "8 x 6 mm, superior, fibrin glue"}),
          f("specimenSent", "Specimen sent for histology", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes / No"})
        ]
      }
    },
    "intravitreal-injection": {
      base: "operative", title: "Intravitreal anti-VEGF injection",
      prefill: {"procedure": "Intravitreal injection"},
      extra: {
        "Operative detail": [
          f("operativeEye", "Eye injected", {"type": "text", "required": true, "aiFillable": false, "ph": "Right / Left"}),
          f("drugDose", "Drug, dose and batch number", {"type": "text", "required": true, "aiFillable": false, "ph": "Aflibercept 2 mg / 0.05 mL, batch"}),
          f("injectionSite", "Site and distance from the limbus", {"type": "text", "required": true, "aiFillable": true, "ph": "Inferotemporal, 4.0 mm"}),
          f("postCheck", "Post-injection vision and perfusion", {"type": "text", "required": true, "aiFillable": false, "ph": "Counts fingers, disc perfused"})
        ]
      }
    },
    "external-dcr": {
      base: "operative", title: "External dacryocystorhinostomy",
      prefill: {"procedure": "External dacryocystorhinostomy"},
      extra: {
        "Operative detail": [
          f("operativeSide", "Side", {"type": "text", "required": true, "aiFillable": false, "ph": "Right / Left"}),
          f("ostiumSize", "Ostium size", {"type": "text", "required": true, "aiFillable": true, "ph": "about 15 x 15 mm"}),
          f("flapsTubes", "Flaps sutured and tubes", {"type": "text", "required": true, "aiFillable": true, "ph": "Anterior and posterior flaps; silicone tubes yes / no"}),
          f("packsCount", "Nasal packs and swab count", {"type": "text", "required": true, "aiFillable": false, "ph": "Packs in and out, count correct"}),
          f("sacFindings", "Sac findings and specimen", {"type": "text", "required": false, "aiFillable": false, "ph": "Normal / stone / mass, biopsy sent"})
        ]
      }
    },
    "chalazion-incision-curettage": {
      base: "operative", title: "Chalazion incision and curettage",
      prefill: {"procedure": "Incision and curettage of chalazion"},
      extra: {
        "Operative detail": [
          f("lidSite", "Lid and site", {"type": "text", "required": true, "aiFillable": false, "ph": "Right upper lid, central"}),
          f("contents", "Contents found", {"type": "text", "required": false, "aiFillable": true, "ph": "Gelatinous / firm / atypical"}),
          f("specimenSent", "Specimen sent for histology", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes / No, reason"})
        ]
      }
    },
    "corneal-foreign-body-removal": {
      base: "operative", title: "Corneal and subtarsal foreign body removal",
      prefill: {"procedure": "Removal of corneal or subtarsal foreign body"},
      extra: {
        "Operative detail": [
          f("operativeEye", "Eye", {"type": "text", "required": true, "aiFillable": false, "ph": "Right / Left"}),
          f("mechanism", "Mechanism of injury", {"type": "text", "required": true, "aiFillable": true, "ph": "Grinding metal / wind-blown / unknown"}),
          f("seidelResult", "Seidel test before and after", {"type": "text", "required": true, "aiFillable": false, "ph": "Negative / positive"}),
          f("defectSize", "Site, depth and epithelial defect size", {"type": "text", "required": true, "aiFillable": true, "ph": "Paracentral, superficial, 1 mm"}),
          f("rustRing", "Rust ring", {"type": "text", "required": false, "aiFillable": true, "ph": "None / removed / residual for review"})
        ]
      }
    },
    "evisceration": {
      base: "operative", title: "Evisceration with orbital implant",
      prefill: {"procedure": "Evisceration with orbital implant"},
      extra: {
        "Operative detail": [
          f("operativeEye", "Eye eviscerated (confirmed at time-out)", {"type": "text", "required": true, "aiFillable": false, "ph": "Right / Left"}),
          f("tumourExcluded", "Tumour excluded before surgery", {"type": "text", "required": true, "aiFillable": false, "ph": "B-scan date and result"}),
          f("implantDetail", "Orbital implant: type, size, serial / lot number", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "help": "Copy from the implant sticker."}),
          f("uveaRemoved", "Uveal tissue cleared", {"type": "text", "required": true, "aiFillable": true, "ph": "Complete, alcohol used yes / no"}),
          f("specimenSent", "Specimen sent for histology", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes / No"})
        ]
      }
    },
    "strabismus-recession-resection": {
      base: "operative", title: "Strabismus surgery: rectus recession and resection",
      prefill: {"procedure": "Strabismus surgery"},
      extra: {
        "Operative detail": [
          f("musclePlan", "Muscles and amounts (each eye)", {"type": "textarea", "required": true, "aiFillable": false, "ph": "RE medial rectus recession 5.0 mm; RE lateral rectus resection 6.0 mm", "rows": 2}),
          f("forcedDuction", "Forced duction findings", {"type": "text", "required": true, "aiFillable": true, "ph": "Free / restricted (direction)"}),
          f("sutureTechnique", "Suture and technique", {"type": "text", "required": true, "aiFillable": true, "ph": "6-0 polyglactin, fixed / hang-back / adjustable"}),
          f("ocrEvent", "Oculocardiac reflex", {"type": "text", "required": false, "aiFillable": true, "ph": "None / bradycardia, action"})
        ]
      }
    },
    "pars-plana-vitrectomy": {
      base: "operative", title: "Pars plana vitrectomy for retinal detachment",
      prefill: {"procedure": "Pars plana vitrectomy"},
      extra: {
        "Operative detail": [
          f("operativeEye", "Operative eye", {"type": "text", "required": true, "aiFillable": false, "ph": "Right / Left"}),
          f("maculaStatus", "Macula on or off and the breaks found", {"type": "text", "required": true, "aiFillable": true, "ph": "Macula off; U-tear at 1 o'clock"}),
          f("gauge", "Gauge and ports", {"type": "text", "required": false, "aiFillable": true, "ph": "25G, three ports"}),
          f("tamponade", "Tamponade agent and concentration", {"type": "text", "required": true, "aiFillable": false, "ph": "SF6 20% / C3F8 14% / silicone oil"}),
          f("postureGas", "Posture instructions and gas wristband given", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes, face down 5 days; wristband on"})
        ]
      }
    },
    "kidney-transplant": {
      base: "operative", title: "Kidney transplant (recipient operation)",
      prefill: {"procedure": "Kidney transplant"},
      extra: {
        "Operative detail": [
          f("donorType", "Donor type and organ", {"type": "text", "required": true, "aiFillable": false, "ph": "Deceased (DBD / DCD) / living; left / right kidney"}),
          f("compatibility", "ABO and crossmatch confirmed at time-out", {"type": "text", "required": true, "aiFillable": false, "ph": "ABO compatible, crossmatch negative"}),
          f("ischaemiaTimes", "Cold and warm ischaemia times", {"type": "text", "required": true, "aiFillable": false, "ph": "Cold h:min, anastomosis time min"}),
          f("anastomoses", "Vascular anastomoses", {"type": "textarea", "required": true, "aiFillable": true, "ph": "Vein to EIV end to side; artery with patch to EIA end to side", "rows": 2}),
          f("reperfusion", "Reperfusion quality and urine", {"type": "text", "required": true, "aiFillable": false, "ph": "Uniform, urine on table yes / no"}),
          f("stentRecord", "Ureteric stent and removal date", {"type": "text", "required": true, "aiFillable": false, "ph": "6 Fr 12 cm double-J, remove at 4 to 6 weeks"})
        ]
      }
    },
    "lap-donor-nephrectomy": {
      base: "operative", title: "Laparoscopic living donor nephrectomy",
      prefill: {"procedure": "Laparoscopic living donor nephrectomy"},
      extra: {
        "Operative detail": [
          f("operativeSide", "Kidney removed", {"type": "text", "required": true, "aiFillable": false, "ph": "Left / Right"}),
          f("authorisation", "Authorisation and donor consent documents checked", {"type": "text", "required": true, "aiFillable": false, "ph": "Committee approval reference, consent confirmed on the day"}),
          f("vesselAnatomy", "Arteries, veins and their division", {"type": "textarea", "required": true, "aiFillable": false, "ph": "Single artery, transfixing stapler; vein stapled", "rows": 2}),
          f("warmIschaemia", "Warm ischaemia time", {"type": "text", "required": true, "aiFillable": false, "ph": "minutes"}),
          f("stumpCheck", "Stumps and field inspected at low pressure", {"type": "text", "required": true, "aiFillable": false, "ph": "Dry, spleen and colon intact"})
        ]
      }
    },
    "aortic-valve-replacement": {
      base: "operative", title: "Aortic valve replacement (surgical)",
      prefill: {"procedure": "Surgical aortic valve replacement"},
      extra: {
        "Operative detail": [
          f("prosthesis", "Prosthesis: type, size, serial / lot number", {"type": "textarea", "required": true, "aiFillable": false, "rows": 2, "help": "Copy from the implant sticker. A physical record, never AI-filled."}),
          f("bypassTimes", "Bypass and cross-clamp times", {"type": "text", "required": true, "aiFillable": false, "ph": "Bypass min, cross-clamp min"}),
          f("cardioplegia", "Cardioplegia route and type", {"type": "text", "required": true, "aiFillable": true, "ph": "Antegrade ostial / retrograde, cold blood"}),
          f("echoResult", "Post-bypass echo: gradient, paravalvular leak, function", {"type": "text", "required": true, "aiFillable": false}),
          f("rhythmPacing", "Rhythm and pacing wires", {"type": "text", "required": true, "aiFillable": true, "ph": "Sinus / heart block; atrial and ventricular wires"})
        ]
      }
    },
    "subxiphoid-pericardial-window": {
      base: "operative", title: "Subxiphoid pericardial window",
      prefill: {"procedure": "Subxiphoid pericardial window"},
      extra: {
        "Operative detail": [
          f("fluidVolume", "Fluid drained: volume and appearance", {"type": "text", "required": true, "aiFillable": true, "ph": "mL; serous / blood-stained / purulent"}),
          f("haemodynamicResponse", "Haemodynamic response", {"type": "text", "required": false, "aiFillable": true, "ph": "BP and heart rate before and after"}),
          f("specimenSent", "Specimens sent: fluid and tissue", {"type": "text", "required": true, "aiFillable": false, "ph": "Cytology, culture, TB, histology"}),
          f("drainDetail", "Pericardial drain", {"type": "text", "required": true, "aiFillable": false, "ph": "28 Fr via separate stab"})
        ]
      }
    },
    "escharotomy": {
      base: "operative", title: "Escharotomy for circumferential burns",
      prefill: {"procedure": "Escharotomy"},
      extra: {
        "Operative detail": [
          f("indication", "Indication and evidence of constriction", {"type": "text", "required": true, "aiFillable": true, "ph": "Circumferential FT burn R arm, absent radial Doppler"}),
          f("sitesLines", "Sites and lines released", {"type": "textarea", "required": true, "aiFillable": true, "ph": "R arm mid-lateral and mid-medial; chest shield", "rows": 2}),
          f("perfusionAfter", "Perfusion and ventilation after release", {"type": "text", "required": true, "aiFillable": false, "ph": "Doppler signals returned; airway pressure fell"}),
          f("fasciotomyNeeded", "Fasciotomy needed", {"type": "text", "required": false, "aiFillable": true, "ph": "No / yes, compartments"})
        ]
      }
    },
    "rhomboid-flap": {
      base: "operative", title: "Rhomboid (Limberg) transposition flap",
      prefill: {"procedure": "Excision and rhomboid transposition flap"},
      extra: {
        "Operative detail": [
          f("lesionSite", "Lesion, site and size", {"type": "text", "required": true, "aiFillable": true, "ph": "Suspected BCC, left cheek, 12 mm"}),
          f("margins", "Excision margin", {"type": "text", "required": true, "aiFillable": true, "ph": "4 mm peripheral, to fat"}),
          f("flapDesign", "Flap orientation chosen and why", {"type": "text", "required": true, "aiFillable": true, "ph": "Inferolateral flap, donor in the nasolabial line"}),
          f("flapViability", "Flap colour and refill at the end", {"type": "text", "required": true, "aiFillable": false, "ph": "Pink, brisk refill"}),
          f("specimenOriented", "Specimen sent and orientation stitch", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes, long stitch superior"})
        ]
      }
    },
    "unilateral-cleft-lip-repair": {
      base: "operative", title: "Unilateral cleft lip repair",
      prefill: {"procedure": "Unilateral cleft lip repair"},
      extra: {
        "Operative detail": [
          f("cleftSide", "Cleft side and type", {"type": "text", "required": true, "aiFillable": false, "ph": "Left complete / incomplete"}),
          f("technique", "Technique", {"type": "text", "required": true, "aiFillable": true, "ph": "Anatomical subunit (Fisher) / rotation-advancement"}),
          f("heightsMeasured", "Lip heights measured (cleft and non-cleft side)", {"type": "text", "required": true, "aiFillable": false, "ph": "mm and mm"}),
          f("nasalRepair", "Primary nasal repair", {"type": "text", "required": false, "aiFillable": true, "ph": "Yes, alar cartilage repositioned"}),
          f("throatPack", "Throat pack in and out", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes, counted out"})
        ]
      }
    },
    "uro-flexible-cystoscopy": {
      base: "operative", title: "Flexible cystoscopy (and stent removal)",
      prefill: {"procedure": "Flexible cystoscopy"},
      extra: {
        "Operative detail": [
          f("scopeReason", "Reason for cystoscopy", {"type": "text", "required": true, "aiFillable": true, "ph": "Visible haematuria / surveillance / stent removal"}),
          f("urethra", "Urethra and prostate", {"type": "text", "required": false, "aiFillable": true, "ph": "Normal; prostate occlusive / not"}),
          f("bladderMap", "Bladder findings (including retroflexion)", {"type": "textarea", "required": true, "aiFillable": true, "ph": "Site, size, number, appearance", "rows": 3}),
          f("stent", "Stent removed and register closed", {"type": "text", "required": false, "aiFillable": false, "ph": "Left 6 Fr removed intact; register updated"}),
          f("plan", "Plan", {"type": "textarea", "required": false, "aiFillable": true, "ph": "TURBT, cytology, imaging, discharge", "rows": 2})
        ]
      }
    },
    "uro-transperineal-prostate-biopsy": {
      base: "operative", title: "Transperineal prostate biopsy",
      prefill: {"procedure": "Transperineal prostate biopsy"},
      extra: {
        "Operative detail": [
          f("mri", "MRI result and targets", {"type": "text", "required": true, "aiFillable": true, "ph": "PI-RADS 4 left PZ mid; target 1"}),
          f("targetCores", "Targeted cores per lesion", {"type": "text", "required": true, "aiFillable": false, "ph": "Target 1: 4 cores"}),
          f("systematicCores", "Systematic cores by zone", {"type": "text", "required": true, "aiFillable": false, "ph": "12 cores, template"}),
          f("voided", "Voided before discharge", {"type": "text", "required": false, "aiFillable": false, "ph": "Yes / catheter"})
        ]
      }
    },
    "uro-optical-urethrotomy": {
      base: "operative", title: "Optical internal urethrotomy",
      prefill: {"procedure": "Optical internal urethrotomy"},
      extra: {
        "Operative detail": [
          f("stricture", "Stricture site and length", {"type": "text", "required": true, "aiFillable": true, "ph": "Bulbar, 1 cm"}),
          f("wire", "Guidewire into bladder confirmed", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes, fluoroscopy"}),
          f("cut", "Urethrotomy cut", {"type": "text", "required": false, "aiFillable": true, "ph": "Cold knife 12 o'clock until scope passes"}),
          f("catheterPlan", "Catheter and removal", {"type": "text", "required": true, "aiFillable": false, "ph": "16 Ch, remove day 3"})
        ]
      }
    },
    "uro-cystolitholapaxy": {
      base: "operative", title: "Cystolitholapaxy (bladder stone)",
      prefill: {"procedure": "Cystolitholapaxy"},
      extra: {
        "Operative detail": [
          f("stone", "Stone size and number", {"type": "text", "required": true, "aiFillable": true, "ph": "Single 3 cm"}),
          f("energy", "Lithotripsy method", {"type": "text", "required": false, "aiFillable": true, "ph": "Holmium laser / pneumatic"}),
          f("clearance", "Clearance", {"type": "text", "required": true, "aiFillable": false, "ph": "Complete"}),
          f("cause", "Cause found", {"type": "textarea", "required": false, "aiFillable": true, "ph": "BPO, diverticulum, foreign body", "rows": 2})
        ]
      }
    },
    "uro-holep": {
      base: "operative", title: "Holmium laser enucleation of the prostate (HoLEP)",
      prefill: {"procedure": "HoLEP"},
      extra: {
        "Operative detail": [
          f("prostateVolume", "Prostate volume (preop)", {"type": "text", "required": false, "aiFillable": true, "ph": "80 ml"}),
          f("laserSettings", "Laser settings", {"type": "text", "required": false, "aiFillable": true, "ph": "2 J, 50 Hz"}),
          f("enucleation", "Enucleation technique", {"type": "text", "required": false, "aiFillable": true, "ph": "Three-lobe / two-lobe / en bloc"}),
          f("morcellation", "Morcellation and bladder check", {"type": "text", "required": true, "aiFillable": true, "ph": "Complete, bladder intact"}),
          f("catheterPlan", "Catheter and trial without catheter", {"type": "text", "required": true, "aiFillable": false, "ph": "22 Ch three-way, TWOC day 1"})
        ]
      }
    },
    "uro-vasectomy": {
      base: "operative", title: "No-scalpel vasectomy",
      prefill: {"procedure": "Vasectomy"},
      extra: {
        "Operative detail": [
          f("technique", "Technique", {"type": "text", "required": false, "aiFillable": true, "ph": "No-scalpel, cautery with fascial interposition"}),
          f("bothDivided", "Both vasa divided", {"type": "text", "required": true, "aiFillable": false, "ph": "Right and left confirmed"}),
          f("segments", "Segments sent", {"type": "text", "required": false, "aiFillable": false, "ph": "Yes / no"}),
          f("semenTest", "Semen test date and advice", {"type": "text", "required": true, "aiFillable": true, "ph": "12 weeks; contraception until clear"})
        ]
      }
    },
    "uro-pyeloplasty": {
      base: "operative", title: "Laparoscopic or robotic pyeloplasty (Anderson-Hynes)",
      prefill: {"procedure": "Pyeloplasty"},
      extra: {
        "Operative detail": [
          f("approach", "Approach", {"type": "text", "required": false, "aiFillable": true, "ph": "Laparoscopic / robotic, transperitoneal"}),
          f("crossingVessel", "Crossing vessel", {"type": "text", "required": false, "aiFillable": true, "ph": "Present, transposed / absent"}),
          f("anastomosis", "Anastomosis", {"type": "textarea", "required": false, "aiFillable": true, "ph": "Dismembered, spatulated, 5-0 running", "rows": 2}),
          f("stent", "Stent and removal date", {"type": "text", "required": true, "aiFillable": false, "ph": "4.7 Fr 24 cm, remove 6 weeks"})
        ]
      }
    },
    "uro-partial-nephrectomy": {
      base: "operative", title: "Robotic partial nephrectomy",
      prefill: {"procedure": "Partial nephrectomy"},
      extra: {
        "Operative detail": [
          f("tumour", "Tumour (side, size, score)", {"type": "text", "required": true, "aiFillable": true, "ph": "Left 3.2 cm, RENAL 7"}),
          f("arteries", "Arteries clamped", {"type": "text", "required": false, "aiFillable": false, "ph": "Single main artery"}),
          f("warmIschaemia", "Warm ischaemia time", {"type": "text", "required": true, "aiFillable": false, "ph": "18 min"}),
          f("collecting", "Collecting system", {"type": "text", "required": false, "aiFillable": true, "ph": "Opened and closed / intact"}),
          f("margin", "Margin seen", {"type": "text", "required": false, "aiFillable": true, "ph": "Clear rim on specimen"})
        ]
      }
    },
    "uro-radical-prostatectomy": {
      base: "operative", title: "Robotic radical prostatectomy",
      prefill: {"procedure": "Radical prostatectomy"},
      extra: {
        "Operative detail": [
          f("nerveSparing", "Nerve sparing", {"type": "text", "required": true, "aiFillable": true, "ph": "Bilateral / left / right / none"}),
          f("nodes", "Lymph node dissection", {"type": "text", "required": false, "aiFillable": true, "ph": "Extended bilateral / none"}),
          f("bladderNeck", "Bladder neck", {"type": "text", "required": false, "aiFillable": true, "ph": "Preserved / reconstructed"}),
          f("leakTest", "Anastomosis leak test", {"type": "text", "required": true, "aiFillable": false, "ph": "Watertight at 150 ml"}),
          f("catheterPlan", "Catheter and removal", {"type": "text", "required": true, "aiFillable": false, "ph": "18 Ch, remove day 7"})
        ]
      }
    },
    "uro-radical-cystectomy-ileal-conduit": {
      base: "operative", title: "Radical cystectomy with ileal conduit",
      prefill: {"procedure": "Radical cystectomy with ileal conduit"},
      extra: {
        "Operative detail": [
          f("specimen", "Specimen removed", {"type": "text", "required": true, "aiFillable": false, "ph": "Cystoprostatectomy / anterior exenteration"}),
          f("nodes", "Lymph node dissection", {"type": "text", "required": false, "aiFillable": true, "ph": "Standard / extended bilateral"}),
          f("ureterMargins", "Ureteric margins", {"type": "text", "required": false, "aiFillable": false, "ph": "Sent for frozen section: clear"}),
          f("conduit", "Conduit", {"type": "textarea", "required": false, "aiFillable": true, "ph": "15 cm ileum, 20 cm from ICV; Wallace; stoma RIF", "rows": 2}),
          f("stents", "Ureteric stents and removal date", {"type": "text", "required": true, "aiFillable": false, "ph": "Two single-J, remove day 10"})
        ]
      }
    },
    "uro-nephroureterectomy": {
      base: "operative", title: "Radical nephroureterectomy with bladder cuff",
      prefill: {"procedure": "Nephroureterectomy"},
      extra: {
        "Operative detail": [
          f("tumourSite", "Side and tumour site", {"type": "text", "required": true, "aiFillable": true, "ph": "Left, lower ureter"}),
          f("ureterClipped", "Ureter clipped early", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes"}),
          f("cuff", "Bladder cuff technique", {"type": "text", "required": false, "aiFillable": true, "ph": "Extravesical, two-layer closure"}),
          f("specimenIntact", "Specimen intact, no morcellation", {"type": "text", "required": true, "aiFillable": false, "ph": "Yes"}),
          f("instillation", "Intravesical chemotherapy", {"type": "text", "required": false, "aiFillable": false, "ph": "Mitomycin 40 mg day 1 / not given (reason)"})
        ]
      }
    },
    "uro-buccal-urethroplasty": {
      base: "operative", title: "Bulbar urethroplasty with buccal mucosa graft",
      prefill: {"procedure": "Buccal mucosa graft urethroplasty"},
      extra: {
        "Operative detail": [
          f("stricture", "Stricture site and length", {"type": "text", "required": true, "aiFillable": true, "ph": "Bulbar 4 cm"}),
          f("graft", "Graft size and position", {"type": "text", "required": true, "aiFillable": true, "ph": "4.5 x 2 cm, dorsal onlay"}),
          f("donorSite", "Donor site", {"type": "text", "required": false, "aiFillable": true, "ph": "Right cheek, closed / left open"}),
          f("catheterPlan", "Catheter and urethrogram date", {"type": "text", "required": true, "aiFillable": false, "ph": "16 Ch silicone, urethrogram 3 weeks"})
        ]
      }
    },
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
