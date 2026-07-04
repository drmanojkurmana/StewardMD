/* StewardMD — Surgery specialty engine (data + deterministic management logic).
   ---------------------------------------------------------------------------
   Registers into window.SMD_WS_ENGINES.surgery, consumed by workspaces.js. This is
   a LIGHTWEIGHT specialty pathway — NOT the Internal Medicine engine and NOT a
   diagnosis generator. For each syndrome it collects focused findings + danger
   signs and returns a conservative MANAGEMENT DECISION: the antibiotic-need level
   (0 none → 5 emergency referral), whether SOURCE CONTROL / a procedure is required,
   and the referral/escalation. Actual drug choice is deferred to the existing
   stewardship engine / Drug Index / local antibiogram + ICMR (never prescribed here).

   Shared conditions (cholangitis, liver abscess, colitis) keep Internal Medicine as
   the PRIMARY pathway and show a Surgery consult / source-control overlay — they never
   duplicate or overwrite the IM assessment.

   Advisory only. Verify against local protocol, imaging, and the individual patient. */
(function () {
  "use strict";
  // ladder index → matches ABX/management ladder in workspaces.js
  // 0 none · 1 topical/local · 2 oral · 3 IV/admission · 4 urgent drainage/source control · 5 emergency referral
  function has(sel, id) { return sel && sel.has && sel.has(id); }
  function anyOf(sel, ids) { for (var i = 0; i < ids.length; i++) if (has(sel, ids[i])) return true; return false; }

  var SURGERY = {
    id: "surgery",
    name: "Surgery",
    syndromes: [
      /* ───────────────────────── Acute abdomen ───────────────────────── */
      {
        id: "acute_abdomen", name: "Acute abdomen",
        q: [
          { id: "loc_ruq", label: "RUQ pain" }, { id: "loc_rlq", label: "RLQ / McBurney pain" },
          { id: "loc_llq", label: "LLQ pain" }, { id: "generalised", label: "Generalised pain" },
          { id: "vomiting", label: "Vomiting / obstipation" }, { id: "distension", label: "Distension" },
          { id: "prior_surgery", label: "Prior abdominal surgery" }, { id: "fever", label: "Fever / systemic features" }
        ],
        danger: [
          { id: "peritonism", label: "Guarding / rebound / rigid abdomen" },
          { id: "free_air", label: "Free air / perforation on imaging" },
          { id: "unstable", label: "Haemodynamic instability / shock" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["peritonism", "free_air", "unstable"])) {
            return { emergency: true, ladder: 5, catg: "Surgical abdomen — likely peritonitis / perforation",
              sc: "Urgent source control — theatre for perforation/peritonitis; NBM, resuscitate, urinary catheter.",
              ref: "Emergency surgical referral now.",
              mgmt: ["Broad-spectrum IV antibiotics covering enteric Gram-negatives + anaerobes — choose per local antibiogram / ICMR AMRSN & stewardship.", "Do not delay theatre for imaging if peritonitic/unstable."] };
          }
          return { emergency: false, ladder: 3, catg: "Undifferentiated acute abdomen — needs surgical evaluation",
            sc: "Source control depends on cause (appendicitis, obstruction, perforation) — image (erect CXR / CT) and reassess.",
            ref: "Surgical review; admit, serial examination.",
            mgmt: ["Antibiotics only once an infective/surgical source is identified — avoid blind cover.", "Consider IM review for medical mimics (DKA, MI, lower-lobe pneumonia, AAA)."] };
        }
      },
      /* ───────────────────── Wound / post-op infection ───────────────────── */
      {
        id: "wound_infection", name: "Wound / post-op infection",
        q: [
          { id: "purulent", label: "Purulent discharge" }, { id: "erythema", label: "Peri-wound erythema / warmth" },
          { id: "fever", label: "Fever / systemic features" }, { id: "deep", label: "Deep / organ-space signs" },
          { id: "implant", label: "Implant / mesh in situ" }, { id: "dehiscence", label: "Wound dehiscence" }
        ],
        danger: [
          { id: "necrosis", label: "Crepitus / rapidly spreading erythema / skin necrosis" },
          { id: "sepsis", label: "Systemic sepsis" }, { id: "evisceration", label: "Dehiscence with evisceration" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["necrosis"])) return necFashResult();
          if (has(sel, "evisceration")) return { emergency: true, ladder: 5, catg: "Fascial dehiscence / evisceration",
            sc: "Cover with saline gauze, urgent theatre for closure.", ref: "Emergency surgical referral.", mgmt: ["Resuscitate; IV antibiotics per local protocol."] };
          if (anyOf(sel, ["deep", "sepsis"])) return { emergency: false, ladder: 4, catg: "Deep / organ-space surgical site infection",
            sc: "Source control — open/drain collection; send pus for culture.", ref: "Surgical review.", mgmt: ["IV antibiotics (Gram-positive + enteric cover per local antibiogram) once drained; de-escalate on culture."] };
          if (has(sel, "purulent")) return { emergency: false, ladder: 2, catg: "Superficial surgical site infection",
            sc: "Open the wound / release pus; regular dressings; swab if not responding.", ref: "Nursing wound care; surgical review if worsening.", mgmt: ["Often NO systemic antibiotics for a drained superficial SSI unless surrounding cellulitis or systemic features — then oral cover.", "Reassess at 48 h."] };
          return { emergency: false, ladder: 1, catg: "Wound concern — reassess", sc: "Wound care, keep clean/dry.", ref: "Review if discharge, spreading erythema or fever develop.", mgmt: ["No antibiotics without infection signs."] };
        }
      },
      /* ───────────────────── Cellulitis / soft-tissue ───────────────────── */
      {
        id: "cellulitis", name: "Cellulitis / soft-tissue infection",
        q: [
          { id: "erythema", label: "Warm, spreading erythema" }, { id: "portal", label: "Portal of entry (crack / ulcer / bite)" },
          { id: "purulent", label: "Purulent / fluctuant (abscess?)" }, { id: "systemic", label: "Fever / systemic features" },
          { id: "diabetes", label: "Diabetes / immunosuppression" }, { id: "lymphangitis", label: "Lymphangitis / lymphadenitis" }
        ],
        danger: [
          { id: "oop", label: "Pain out of proportion to signs" }, { id: "crepitus", label: "Crepitus / bullae / dusky skin" },
          { id: "rapid", label: "Rapidly advancing margin" }, { id: "sepsis", label: "Systemic sepsis / instability" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["oop", "crepitus", "rapid"])) return necFashResult();
          if (has(sel, "purulent")) return { emergency: false, ladder: 4, catg: "Purulent SSTI — likely abscess",
            sc: "Incision & drainage is the primary treatment; culture pus.", ref: "Surgical / minor-ops.", mgmt: ["Antibiotics are adjunct — add if surrounding cellulitis, systemic features, immunocompromise or diabetes; cover S. aureus (MRSA per local rates)."] };
          if (has(sel, "sepsis")) return { emergency: false, ladder: 3, catg: "Cellulitis with systemic features",
            sc: "Rule out drainable collection (USS if in doubt).", ref: "Admit; surgical review if collection.", mgmt: ["IV anti-streptococcal / anti-staphylococcal cover per local antibiogram; mark the margin and reassess."] };
          return { emergency: false, ladder: 2, catg: "Uncomplicated cellulitis",
            sc: "No collection to drain — mark margin, elevate, treat portal of entry.", ref: "Review at 48 h; escalate if spreading.", mgmt: ["Oral anti-streptococcal / anti-staphylococcal antibiotic per local guidance; lower threshold for IV in diabetes/immunosuppression."] };
        }
      },
      /* ───────────────────────────── Abscess ───────────────────────────── */
      {
        id: "abscess", name: "Abscess",
        q: [
          { id: "fluctuant", label: "Fluctuant / localised collection" }, { id: "site_perianal", label: "Perianal / perineal site" },
          { id: "large", label: "Large / deep collection" }, { id: "cellulitis", label: "Surrounding cellulitis" },
          { id: "systemic", label: "Fever / systemic features" }, { id: "immuno", label: "Diabetes / immunosuppression" }
        ],
        danger: [
          { id: "necrosis", label: "Crepitus / necrosis / severe perianal pain (Fournier?)" }, { id: "sepsis", label: "Systemic sepsis" }
        ],
        assess: function (sel) {
          if (has(sel, "necrosis")) return necFashResult();
          return { emergency: false, ladder: 4, catg: "Abscess — needs drainage",
            sc: "Incision & drainage / image-guided drainage is the definitive treatment; send pus for culture.",
            ref: "Surgical drainage (theatre if deep/perianal/large).",
            mgmt: ["Antibiotics are adjunct to drainage — add if surrounding cellulitis, systemic features or immunocompromise; choose per local antibiogram, de-escalate on culture."] };
        }
      },
      /* ───────────────────── Diabetic foot infection ───────────────────── */
      {
        id: "diabetic_foot", name: "Diabetic foot infection",
        q: [
          { id: "ulcer", label: "Ulcer / break in skin" }, { id: "purulent", label: "Purulence / abscess" },
          { id: "probe_bone", label: "Probe-to-bone positive" }, { id: "erythema", label: "Erythema / warmth > 2 cm" },
          { id: "ischaemia", label: "Ischaemia / absent pulses" }, { id: "systemic", label: "Fever / systemic features" }
        ],
        danger: [
          { id: "wet_gangrene", label: "Wet gangrene / crepitus" }, { id: "ascending", label: "Rapidly ascending infection" }, { id: "sepsis", label: "Systemic sepsis" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["wet_gangrene", "ascending", "sepsis"])) return { emergency: true, ladder: 4, catg: "Severe / limb-threatening diabetic foot infection",
            sc: "Urgent surgical debridement / drainage; assess for revascularisation.", ref: "Emergency surgical + vascular referral; admit.", mgmt: ["Broad-spectrum IV antibiotics (Gram-positive + Gram-negative ± anaerobic) per local antibiogram/ICMR; glycaemic control; de-escalate on culture."] };
          if (anyOf(sel, ["purulent", "probe_bone"])) return { emergency: false, ladder: 3, catg: "Moderate diabetic foot infection ± osteomyelitis",
            sc: "Drain/debride collections; image for osteomyelitis if probe-to-bone.", ref: "Surgical + podiatry/vascular; consider admission.", mgmt: ["IV then oral antibiotics guided by deep culture; assess perfusion."] };
          if (has(sel, "erythema")) return { emergency: false, ladder: 2, catg: "Mild diabetic foot infection",
            sc: "Debride callus/dead tissue; offload; wound care.", ref: "Podiatry / diabetic foot clinic.", mgmt: ["Oral antibiotics targeting Gram-positives per local guidance; close review."] };
          return { emergency: false, ladder: 1, catg: "Diabetic foot — no active infection", sc: "Offloading, wound care, vascular assessment.", ref: "Diabetic foot clinic.", mgmt: ["No antibiotics without infection signs."] };
        }
      },
      /* ───────────── Necrotising soft-tissue infection (red-flag) ───────────── */
      {
        id: "nec_sti", name: "Necrotising soft-tissue infection",
        q: [
          { id: "oop", label: "Pain out of proportion" }, { id: "rapid", label: "Rapid spread over hours" },
          { id: "bullae", label: "Bullae / skin necrosis / dusky skin" }, { id: "crepitus", label: "Crepitus / gas" }, { id: "systemic", label: "Systemic toxicity / shock" }
        ],
        danger: [{ id: "any", label: "Any of the above = surgical emergency" }],
        assess: function () { return necFashResult(); }
      },
      /* ───────────────── Cholangitis — SHARED (IM primary) ───────────────── */
      {
        id: "cholangitis", name: "Acute cholangitis", primary: "internal_medicine",
        shared: { primary: "Internal Medicine", role: "Surgery / GI / IR consult — biliary drainage & source control" },
        q: [
          { id: "charcot", label: "Charcot triad (fever + jaundice + RUQ pain)" }, { id: "stones", label: "Known stones / stent / prior ERCP" },
          { id: "reynolds", label: "+ Hypotension &/or confusion (Reynolds pentad)" }
        ],
        danger: [{ id: "reynolds", label: "Reynolds pentad / septic shock" }, { id: "nondrain", label: "No improvement on antibiotics" }],
        assess: function (sel) {
          var severe = anyOf(sel, ["reynolds", "nondrain"]);
          return { emergency: severe, ladder: severe ? 4 : 3, catg: "Acute cholangitis — Internal Medicine primary",
            sc: severe ? "URGENT biliary decompression (ERCP; PTC if ERCP not feasible) — source control cannot wait." : "Biliary drainage (ERCP) is the definitive source control — arrange early; timing per severity.",
            ref: "Internal Medicine leads sepsis + antibiotics (per ICMR/local); GI/Surgery/IR for drainage.",
            shared: true,
            mgmt: ["This is a SHARED condition: open the Internal Medicine pathway for the full diagnostic + antibiotic assessment (ICMR precedence preserved).", "Surgery/IR role here = source control (drainage), not antibiotic selection."] };
        }
      },
      /* ───────────────── Liver abscess — SHARED (IM primary) ───────────────── */
      {
        id: "liver_abscess", name: "Liver abscess", primary: "internal_medicine",
        shared: { primary: "Internal Medicine", role: "Surgery / IR consult — drainage / source control" },
        q: [
          { id: "large", label: "Large (> 5 cm) / multiloculated" }, { id: "nonresponse", label: "No response to medical therapy" },
          { id: "rupture_risk", label: "Peritoneal signs / impending rupture" }
        ],
        danger: [{ id: "rupture_risk", label: "Impending rupture / peritonitis" }],
        assess: function (sel) {
          var drain = anyOf(sel, ["large", "nonresponse", "rupture_risk"]);
          return { emergency: has(sel, "rupture_risk"), ladder: 4, catg: "Liver abscess — Internal Medicine primary", shared: true,
            sc: drain ? "Percutaneous (image-guided) drainage indicated; surgical drainage if rupture / not amenable." : "Small abscesses may respond to medical therapy — IM leads; drain if large or not improving.",
            ref: "Internal Medicine for pyogenic-vs-amoebic work-up + antibiotics; IR/Surgery for drainage.",
            mgmt: ["Shared condition — the Internal Medicine pathway owns diagnosis + antimicrobial choice (ICMR/local).", "Surgery/IR role = drainage / source control."] };
        }
      },
      /* ───────────────── Colitis — SHARED (IM primary) ───────────────── */
      {
        id: "colitis", name: "Colitis (surgical escalation)", primary: "internal_medicine",
        shared: { primary: "Internal Medicine", role: "Surgery consult — complications / acute abdomen escalation" },
        q: [
          { id: "diarrhoea", label: "Bloody / severe diarrhoea" }, { id: "distension", label: "Marked colonic distension" }
        ],
        danger: [
          { id: "toxic_megacolon", label: "Toxic megacolon (dilated colon + toxicity)" }, { id: "perforation", label: "Perforation / peritonitis" }, { id: "unstable", label: "Haemodynamic instability" }
        ],
        assess: function (sel) {
          var surg = anyOf(sel, ["toxic_megacolon", "perforation", "unstable"]);
          return { emergency: surg, ladder: surg ? 5 : 3, catg: "Colitis — Internal Medicine primary", shared: true,
            sc: surg ? "Surgical emergency — consider colectomy for toxic megacolon / perforation; resuscitate, NBM." : "No surgical target yet — Internal Medicine leads medical management; monitor for complications.",
            ref: surg ? "Emergency surgical referral." : "Internal Medicine primary; surgical review if deteriorating.",
            mgmt: ["Shared condition — IM owns the diagnostic pathway (infective vs IBD vs ischaemic) + antibiotics/therapy.", "Surgery escalates only for toxic megacolon, perforation, or acute abdomen."] };
        }
      }
    ]
  };

  // Shared necrotising-infection result (surgical emergency).
  function necFashResult() {
    return { emergency: true, ladder: 5, catg: "⚠ Necrotising soft-tissue infection — surgical emergency",
      sc: "IMMEDIATE surgical exploration & debridement — do NOT delay for imaging.",
      ref: "Emergency surgery + critical care NOW.",
      mgmt: ["Aggressive resuscitation; broad-spectrum IV antibiotics with anaerobic + MRSA cover and a protein-synthesis inhibitor (e.g. clindamycin) for toxin suppression — per local protocol/ICMR.", "Repeated debridement usually required; ICU."] };
  }

  window.SMD_WS_ENGINES = window.SMD_WS_ENGINES || {};
  window.SMD_WS_ENGINES.surgery = SURGERY;
})();
