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
      help: o.help || ""
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
          f("escalation", "Escalation / who was informed", { rows: 2 })
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
          f("histopathology", "Histopathology", { rows: 2, ph: "or 'Awaited'" })
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
    }
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
