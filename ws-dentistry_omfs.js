/* StewardMD — Dentistry / OMFS (oral & maxillofacial) specialty engine.
   ---------------------------------------------------------------------------
   Registers into window.SMD_WS_ENGINES.dentistry_omfs, consumed by workspaces.js.
   A LIGHTWEIGHT specialty pathway — NOT the Internal Medicine engine and NOT a
   diagnosis generator. For each syndrome it collects focused findings + danger
   signs and returns a conservative MANAGEMENT DECISION: the antibiotic-need
   level (0 none → 5 emergency referral), whether SOURCE CONTROL / a procedure
   (drainage, extraction, endodontics) is required, and the referral/escalation.
   Actual drug choice is deferred to the existing stewardship engine / Drug Index /
   local antibiogram + ICMR (never prescribed here).

   THE KEY DENTAL PRINCIPLE: the definitive treatment of most odontogenic
   infection is DRAINAGE + treating the tooth (extraction / endodontics), NOT
   antibiotics. Antibiotics are an ADJUNCT — indicated mainly for SPREADING
   infection, systemic features, or immunocompromise. A localised infection with
   a drainable source needs drainage; antibiotics are often NOT required. The
   engine's job is to separate localised source-controllable disease from the
   true red flags: spreading fascial-space infection, and Ludwig's angina / deep-
   space spread that threaten the AIRWAY (co-managed with ENT/maxfax + anaesthesia).

   Advisory only. Verify against local protocol, imaging, and the individual patient. */
(function () {
  "use strict";
  // ladder index → matches ABX/management ladder in workspaces.js
  // 0 none · 1 topical/local (irrigation, dressing, local measures) · 2 oral · 3 IV/admission · 4 urgent drainage/source control (extraction/drainage) · 5 emergency referral (airway)
  function has(sel, id) { return sel && sel.has && sel.has(id); }
  function anyOf(sel, ids) { for (var i = 0; i < ids.length; i++) if (has(sel, ids[i])) return true; return false; }

  // Shared airway-emergency result (Ludwig's / deep-space spread — do not lie flat).
  function airwayEmergency(catg, extra) {
    return { emergency: true, ladder: 5, catg: catg,
      sc: "SECURE THE AIRWAY FIRST — controlled setting (theatre/ICU) with senior anaesthesia + ENT/maxillofacial. Do NOT lie the patient flat and do NOT sedate; keep sitting up. Urgent surgical drainage of the deep-space collection follows airway control.",
      ref: "Emergency ENT / maxillofacial + anaesthesia / critical care NOW — co-managed airway.",
      mgmt: (["IV broad-spectrum antibiotics (aerobic + anaerobic) per local antibiogram/ICMR — only AFTER the airway is secured; antibiotics do NOT replace drainage.", "Keep the patient calm, sitting up, humidified O₂; nil by mouth; treat the causative tooth once stable."]).concat(extra || []) };
  }

  var DENTAL = {
    id: "dentistry_omfs",
    name: "Dentistry / OMFS",
    syndromes: [
      /* ───────────────────── Dental abscess (periapical / periodontal) ───────────────────── */
      {
        id: "dental_abscess", name: "Dental abscess (periapical / periodontal)",
        q: [
          { id: "localised", label: "Localised swelling / fluctuant collection at tooth" },
          { id: "toothpain", label: "Severe throbbing tooth pain / tender to percussion" },
          { id: "drainable", label: "Drainable via tooth / gingiva (accessible collection)" },
          { id: "spreading", label: "Spreading cellulitis / facial swelling beyond the tooth" },
          { id: "systemic", label: "Fever / systemic upset" },
          { id: "immuno", label: "Diabetes / immunocompromise" }
        ],
        danger: [
          { id: "planes", label: "Swelling crossing tissue planes / rapidly enlarging" },
          { id: "trismus", label: "Trismus / difficulty swallowing" },
          { id: "airway", label: "Floor-of-mouth swelling / tongue elevation / drooling / stridor" }
        ],
        assess: function (sel) {
          if (has(sel, "airway")) return airwayEmergency("Dental abscess with airway compromise — exclude Ludwig's / deep-space spread", ["Do not lie flat; this is no longer a simple dental abscess."]);
          if (anyOf(sel, ["planes", "trismus"])) return { emergency: true, ladder: 4, catg: "Dental abscess with spreading fascial-space involvement",
            sc: "Drainage of the collection + treat the source tooth (extraction / endodontic drainage) is the definitive treatment; image (OPG ± CT) and watch the airway.", ref: "Urgent maxillofacial / OMFS; admit — co-manage ENT + anaesthesia if airway concern.", mgmt: ["IV broad-spectrum antibiotics (aerobic + anaerobic) per local antibiogram/ICMR as ADJUNCT to drainage — not a substitute.", "Escalate immediately if floor-of-mouth swelling, trismus worsening or airway symptoms appear."] };
          if (anyOf(sel, ["localised", "drainable"]) && !anyOf(sel, ["spreading", "systemic", "immuno"])) return { emergency: false, ladder: 4, catg: "Localised dental abscess with a drainable source",
            sc: "DRAINAGE + definitive dental treatment (incision/drainage, extraction or endodontics) is the treatment. This is the key dental principle — source control, not antibiotics.", ref: "Dentist / OMFS for drainage and definitive care.", mgmt: ["Antibiotics usually NOT needed for a localised abscess with a drainable source — drain the tooth and manage pain.", "Add antibiotics only if spreading cellulitis, systemic features or immunocompromise develop.", "Analgesia is the mainstay for pain."] };
          if (anyOf(sel, ["spreading", "systemic", "immuno"])) return { emergency: false, ladder: 2, catg: "Dental abscess with spreading cellulitis / systemic or host risk",
            sc: "Still drain + treat the tooth (extraction / endodontics) — source control remains definitive.", ref: "Dentist / OMFS promptly; lower threshold to admit if not settling.", mgmt: ["Add an oral antibiotic per local guidance — indicated here because of spreading cellulitis, systemic features or immunocompromise.", "Antibiotics are an adjunct to drainage, never a replacement; review at 48–72 h and escalate if worsening."] };
          return { emergency: false, ladder: 1, catg: "Suspected early / localised dental infection",
            sc: "Local measures + arrange definitive dental assessment (drainage / extraction / endodontics) as the source control.", ref: "Dentist for definitive care; safety-net for spreading swelling, trismus or airway symptoms.", mgmt: ["Analgesia + local measures; antibiotics usually NOT needed if localised and drainable.", "Antibiotics do not fix a tooth — arrange the dental procedure; antibiotics only if spreading, systemic or immunocompromised.", "Floor-of-mouth swelling or trismus = escalate, not another antibiotic course."] };
        }
      },
      /* ───────────── Spreading odontogenic infection (fascial-space) ───────────── */
      {
        id: "spreading_odontogenic_infection", name: "Spreading odontogenic infection",
        q: [
          { id: "facial_swelling", label: "Facial swelling crossing tissue planes" },
          { id: "trismus", label: "Trismus / limited mouth opening" },
          { id: "dysphagia", label: "Dysphagia / odynophagia" },
          { id: "systemic", label: "Fever / systemic sepsis features" },
          { id: "source_tooth", label: "Identifiable source tooth" },
          { id: "immuno", label: "Diabetes / immunocompromise" }
        ],
        danger: [
          { id: "airway", label: "Floor-of-mouth swelling / tongue elevation / drooling / stridor" },
          { id: "sepsis", label: "Septic shock / haemodynamic instability" },
          { id: "eye", label: "Peri-orbital / eye involvement (cavernous-sinus risk)" }
        ],
        assess: function (sel) {
          if (has(sel, "airway")) return airwayEmergency("Spreading odontogenic infection with airway compromise — Ludwig's / deep-space spread", ["Deep-space spread — secure airway before any manipulation."]);
          if (anyOf(sel, ["sepsis", "eye"])) return { emergency: true, ladder: 4, catg: "Spreading odontogenic infection with sepsis / orbital-cavernous spread",
            sc: "Urgent surgical drainage of the collection + treat the source tooth; contrast CT to map spaces; watch the airway.", ref: "Emergency maxillofacial / OMFS + critical care; involve ENT + ophthalmology if orbital / cavernous spread.", mgmt: ["Resuscitate; IV broad-spectrum antibiotics (aerobic + anaerobic) per local antibiogram/ICMR as adjunct to urgent drainage.", "Antibiotics do NOT replace drainage and source-tooth treatment."] };
          return { emergency: true, ladder: 4, catg: "Spreading odontogenic infection — needs drainage + admission",
            sc: "Surgical drainage of the collection + definitive treatment of the source tooth (extraction / endodontics) is the definitive management; image (OPG ± contrast CT) to map fascial spaces.", ref: "Urgent maxillofacial / OMFS; admit. Co-manage ENT + anaesthesia if any airway concern.", mgmt: ["Admit for IV broad-spectrum antibiotics (aerobic + anaerobic) per local antibiogram/ICMR — ADJUNCT to drainage, not a substitute.", "Monitor closely for airway / deep-space spread (Ludwig's) and escalate at once if it develops."] };
        }
      },
      /* ───────────── Ludwig's angina (airway red-flag) ───────────── */
      {
        id: "ludwig_angina", name: "Ludwig's angina",
        q: [
          { id: "bilateral", label: "Bilateral submandibular + floor-of-mouth swelling" },
          { id: "tongue", label: "Tongue elevation / protrusion" },
          { id: "drooling", label: "Drooling / can't swallow saliva" },
          { id: "voice", label: "Muffled 'hot-potato' voice / dysphonia" },
          { id: "systemic", label: "Fever / toxic / systemic sepsis" }
        ],
        danger: [{ id: "airway", label: "Stridor / respiratory distress — any = airway emergency" }],
        assess: function () {
          return airwayEmergency("⚠ Ludwig's angina — AIRWAY EMERGENCY (bilateral submandibular / floor-of-mouth spread)", ["Do NOT lie the patient flat; keep sitting up, do not sedate.", "Airway is secured FIRST in a controlled setting; urgent surgical drainage follows; IV antibiotics only after the airway.", "Co-managed: ENT / maxillofacial + anaesthesia at the bedside; treat the causative tooth once stable."]);
        }
      },
      /* ───────────── Pericoronitis (partially-erupted tooth) ───────────── */
      {
        id: "pericoronitis", name: "Pericoronitis",
        q: [
          { id: "operculum", label: "Inflamed operculum over partially-erupted tooth (usually lower 3rd molar)" },
          { id: "localpain", label: "Localised pain / bad taste / food trapping" },
          { id: "trismus", label: "Trismus / difficulty opening" },
          { id: "spreading", label: "Spreading swelling / cheek or neck involvement" },
          { id: "systemic", label: "Fever / systemic upset" }
        ],
        danger: [
          { id: "airway", label: "Floor-of-mouth swelling / tongue elevation / drooling / stridor" },
          { id: "dysphagia", label: "Marked dysphagia / can't swallow saliva" }
        ],
        assess: function (sel) {
          if (has(sel, "airway")) return airwayEmergency("Pericoronitis with airway compromise — exclude spreading deep-space infection", ["Progression beyond simple pericoronitis — secure airway first."]);
          if (anyOf(sel, ["spreading", "systemic", "trismus", "dysphagia"])) return { emergency: false, ladder: 2, catg: "Pericoronitis with spreading / systemic features",
            sc: "Irrigation under the operculum + local debridement; definitive care = treat the tooth (operculectomy / extraction) once acute phase settles.", ref: "Dentist / OMFS promptly; escalate if swelling spreads or airway symptoms appear.", mgmt: ["Add an oral antibiotic per local guidance — indicated here because of spreading swelling, trismus or systemic features.", "Local measures + analgesia remain the mainstay; antibiotics are an adjunct."] };
          return { emergency: false, ladder: 1, catg: "Localised pericoronitis",
            sc: "Local measures — irrigation under the operculum, gentle debridement, warm saline rinses; definitive care = dental treatment of the tooth (operculectomy / extraction).", ref: "Dentist for definitive management; safety-net for spreading swelling, trismus or airway symptoms.", mgmt: ["Antibiotics usually NOT needed for localised pericoronitis — local measures + analgesia are first-line.", "Antibiotics only if spreading infection, systemic features or marked trismus."] };
        }
      },
      /* ───────────── Dry socket (alveolar osteitis) ───────────── */
      {
        id: "dry_socket", name: "Dry socket (alveolar osteitis)",
        q: [
          { id: "postextraction", label: "Severe pain 2–4 days after extraction" },
          { id: "emptysocket", label: "Empty socket / lost clot / exposed bone" },
          { id: "halitosis", label: "Bad taste / halitosis" },
          { id: "radiating", label: "Pain radiating to ear / face" }
        ],
        danger: [
          { id: "swelling", label: "Facial swelling / pus / spreading cellulitis (suggests infection, not simple dry socket)" },
          { id: "systemic", label: "Fever / systemic features" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["swelling", "systemic"])) return { emergency: false, ladder: 2, catg: "Post-extraction socket with signs of spreading infection",
            sc: "Irrigate / debride the socket; drain any collection and treat the source — reassess: this is beyond simple dry socket.", ref: "Dentist / OMFS promptly.", mgmt: ["Add an oral antibiotic per local guidance ONLY because of spreading infection / systemic features.", "Simple dry socket does NOT need antibiotics — escalate here because of infective signs."] };
          return { emergency: false, ladder: 1, catg: "Dry socket (alveolar osteitis) — local treatment",
            sc: "LOCAL treatment — gentle irrigation of the socket + medicated (obtundent) dressing; repeat as needed. This is the definitive management.", ref: "Dentist for dressing and review.", mgmt: ["Antibiotics are NOT indicated for dry socket — it is inflammatory, not infective.", "Manage with socket irrigation, medicated dressing and analgesia."] };
        }
      },
      /* ───────────── Acute necrotising ulcerative gingivitis (ANUG) ───────────── */
      {
        id: "anug", name: "Acute necrotising ulcerative gingivitis (ANUG)",
        q: [
          { id: "ulcerated", label: "Painful, bleeding, ulcerated / 'punched-out' interdental papillae" },
          { id: "halitosis", label: "Halitosis / foul metallic taste" },
          { id: "greyslough", label: "Grey pseudomembrane / slough" },
          { id: "systemic", label: "Fever / malaise / lymphadenopathy" },
          { id: "immuno", label: "Immunocompromise (e.g. HIV) / heavy smoker / malnourished" }
        ],
        danger: [
          { id: "noma", label: "Spread to bone / cheek / cancrum oris (noma) — tissue necrosis beyond gingiva" },
          { id: "systemic_sepsis", label: "Systemic sepsis" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["noma", "systemic_sepsis"])) return { emergency: true, ladder: 4, catg: "Necrotising infection spreading beyond gingiva (noma / systemic sepsis)",
            sc: "Debridement of necrotic tissue + source control; assess extent; nutritional support.", ref: "Urgent maxillofacial / OMFS + medical team; admit — particularly if immunocompromised.", mgmt: ["IV antibiotics (with anaerobic cover) per local antibiogram/ICMR as adjunct to debridement.", "Investigate and treat the underlying immunocompromise / malnutrition."] };
          if (anyOf(sel, ["systemic", "immuno"])) return { emergency: false, ladder: 2, catg: "ANUG with systemic features / immunocompromise",
            sc: "Professional debridement (ultrasonic / gentle mechanical) + oral-hygiene instruction is the mainstay.", ref: "Dentist / OMFS; investigate for underlying immunocompromise if severe or recurrent.", mgmt: ["Add an oral antibiotic (metronidazole-class / anaerobic cover) per local guidance — indicated here for systemic features or immunocompromise.", "Debridement + chlorhexidine rinses + analgesia + smoking cessation remain central; antibiotics are an adjunct."] };
          return { emergency: false, ladder: 1, catg: "Localised ANUG",
            sc: "Professional debridement (remove plaque / calculus) + meticulous oral hygiene; antiseptic (e.g. chlorhexidine) mouthrinse.", ref: "Dentist for debridement and follow-up.", mgmt: ["Antibiotics usually NOT needed for localised ANUG without systemic features — debridement + oral hygiene are first-line.", "Add a metronidazole-class antibiotic per local guidance only if systemic upset or immunocompromise; analgesia + smoking cessation."] };
        }
      },
      /* ───────────── Dental trauma / avulsed tooth (TIME-CRITICAL) ───────────── */
      {
        id: "dental_trauma", name: "Dental trauma / avulsed tooth",
        q: [
          { id: "avulsed_perm", label: "PERMANENT tooth knocked completely out (avulsed)" },
          { id: "avulsed_primary", label: "It is a baby / deciduous tooth (child)" },
          { id: "luxation", label: "Tooth loosened / displaced / pushed in (luxation)" },
          { id: "fracture", label: "Crown fracture ± exposed pink pulp / bleeding from tooth" },
          { id: "softtissue", label: "Lip / gingival laceration; dirty wound (tetanus risk)" }
        ],
        danger: [
          { id: "aspiration", label: "Tooth / fragment not found — could be inhaled (cough, wheeze, ↓air entry)" },
          { id: "headinjury", label: "LOC / vomiting / amnesia — head injury features" },
          { id: "mandible", label: "Malocclusion / mandibular step / can't close teeth (facial #)" }
        ],
        assess: function (sel) {
          if (has(sel, "aspiration")) return { emergency: true, ladder: 5, catg: "Missing tooth / fragment — exclude aspiration into the airway",
            sc: "Account for every fragment. If not found and not swallowed, assume inhaled — CXR (chest ± soft-tissue neck) to locate it; bronchoscopy if in the airway.", ref: "Emergency — resuscitation/airway team; ENT/respiratory for retrieval.", mgmt: ["An unaccounted tooth is inhaled until proven otherwise — image before assuming it was swallowed.", "Reimplantation is irrelevant until the airway is cleared."] };
          if (anyOf(sel, ["headinjury", "mandible"])) return { emergency: true, ladder: 4, catg: "Dental trauma with head injury / facial fracture",
            sc: "Treat as trauma: assess ABC / C-spine / GCS first. Image facial skeleton (OPG ± CT) before definitive dental care.", ref: "Emergency / maxillofacial — dental injury is secondary to the head/facial injury.", mgmt: ["Do not focus on the tooth while a head injury or airway is unaddressed.", "Reimplant an avulsed permanent tooth in parallel if feasible (still time-critical), but ABC comes first."] };
          if (has(sel, "avulsed_primary")) return { emergency: false, ladder: 1, catg: "Avulsed PRIMARY (deciduous) tooth — do NOT reimplant",
            sc: "Do NOT reimplant a baby tooth — it risks damaging the developing permanent successor. Local measures for the socket; find the tooth (exclude aspiration).", ref: "Dentist / paediatric dental review.", mgmt: ["Reimplantation applies to PERMANENT teeth only — never reimplant a deciduous tooth.", "Reassure; soft diet; safety-net for aspiration and infection."] };
          if (has(sel, "avulsed_perm")) return { emergency: true, ladder: 4, catg: "Avulsed PERMANENT tooth — REIMPLANT ASAP (time-critical)",
            sc: "REIMPLANT IMMEDIATELY — success falls sharply after ~30–60 min dry. Hold by the CROWN, do NOT touch/scrub the root, rinse gently in saline/milk if dirty, reseat into the socket and have the patient bite on gauze. If you can't reimplant, STORE in milk (or the patient's own saliva / cheek, or HBSS) — never dry, never water. Then splint at the dentist.", ref: "Immediate dentist / OMFS for splinting; time is the outcome.", mgmt: ["Store in MILK or saliva, never dry or in water — dry time is what kills the tooth.", "Update tetanus; add antibiotics per local guidance as an adjunct after reimplantation (contaminated wound), not instead of the procedure.", "Reimplantation is the emergency; splinting and endodontics follow."] };
          return { emergency: false, ladder: 1, catg: "Dental fracture / luxation / soft-tissue injury",
            sc: "Reposition a luxated tooth and splint; cover an exposed pulp / dentine; clean and close soft-tissue lacerations; account for all fragments.", ref: "Prompt dentist / OMFS for splinting and pulp management.", mgmt: ["Pulp exposure (bleeding from the tooth) needs urgent dental care to save the tooth.", "Update tetanus for dirty wounds; antibiotics only for contaminated soft-tissue wounds per local guidance.", "Analgesia; soft diet; avoid biting on the injured tooth."] };
        }
      },
      /* ───────────── Post-extraction bleeding ───────────── */
      {
        id: "post_extraction_bleeding", name: "Post-extraction bleeding",
        q: [
          { id: "oozing", label: "Bleeding / oozing from socket after extraction" },
          { id: "anticoag", label: "On anticoagulant / antiplatelet" },
          { id: "bleeddis", label: "Known bleeding disorder / liver disease" },
          { id: "persistent", label: "Continues despite biting on gauze ≥ 20 min" }
        ],
        danger: [
          { id: "unstable", label: "Large-volume bleed / haemodynamic instability / pallor" },
          { id: "airway", label: "Aspiration / can't manage blood in mouth / airway concern" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["unstable", "airway"])) return { emergency: true, ladder: 5, catg: "Uncontrolled post-extraction bleeding — resuscitate",
            sc: "Resuscitate (ABC, IV access, group & save); firm local pressure; correct/reverse coagulopathy per protocol while arranging definitive local haemostasis.", ref: "Emergency + maxillofacial / OMFS now.", mgmt: ["This is bleeding control, not an infection — antibiotics are NOT the treatment.", "Reverse anticoagulation per protocol; check FBC / clotting; do not stop lifelong anticoagulants without advice."] };
          if (anyOf(sel, ["persistent", "anticoag", "bleeddis"])) return { emergency: false, ladder: 1, catg: "Post-extraction bleeding needing local haemostasis",
            sc: "Local measures: sustained firm bite on a gauze (or tea-bag) pack ~20 min; if it continues — LA with vasoconstrictor, pack the socket with a haemostatic dressing, and SUTURE; tranexamic acid mouthwash helps. Review anticoagulation with the prescriber, don't just stop it.", ref: "Dentist / OMFS if bleeding persists after local measures.", mgmt: ["Firm pressure is first-line and usually enough — reassure and re-pack rather than reach for antibiotics.", "Assess anticoagulant/antiplatelet drugs and bleeding history; check clotting if a disorder is suspected.", "Antibiotics NOT indicated for bleeding itself."] };
          return { emergency: false, ladder: 0, catg: "Expected minor post-extraction ooze",
            sc: "Sustained firm bite on a rolled gauze pack over the socket for ~20 min; sit up, avoid rinsing, spitting, smoking or hot fluids for 24 h.", ref: "Safety-net; return if bleeding is heavy or persistent.", mgmt: ["Minor oozing settles with pressure and clot-protection advice — antibiotics NOT indicated.", "Avoid disturbing the clot (no vigorous rinsing/spitting) for 24 h."] };
        }
      },
      /* ───────────── TMJ (jaw) dislocation ───────────── */
      {
        id: "tmj_dislocation", name: "TMJ (jaw) dislocation",
        q: [
          { id: "openlock", label: "Jaw locked OPEN / can't close the mouth" },
          { id: "difficulty", label: "Difficulty speaking / swallowing / drooling" },
          { id: "bilateral", label: "Bilateral (jaw deviated forward) vs unilateral (chin to opposite side)" },
          { id: "recurrent", label: "Recurrent / prior dislocations" },
          { id: "spontaneous", label: "After yawning / laughing / dental work (non-traumatic)" }
        ],
        danger: [
          { id: "trauma", label: "Significant trauma / suspected mandibular fracture (malocclusion, step, numbness)" },
          { id: "chronic", label: "Dislocated > 24–48 h / repeated failed reductions" }
        ],
        assess: function (sel) {
          if (has(sel, "trauma")) return { emergency: true, ladder: 4, catg: "Jaw dislocation with suspected fracture — do NOT blindly reduce",
            sc: "IMAGE FIRST (OPG / facial CT) — do not attempt reduction if a fracture is possible. Fracture-dislocation needs surgical management.", ref: "Urgent maxillofacial / OMFS.", mgmt: ["A traumatic 'locked jaw' may be a fracture, not a simple dislocation — image before manipulating.", "Antibiotics NOT relevant unless there is an open fracture / wound."] };
          if (has(sel, "chronic")) return { emergency: false, ladder: 0, catg: "Chronic / recurrent TMJ dislocation — specialist reduction",
            sc: "May need reduction under sedation/GA; recurrent cases may need definitive OMFS management. Simple bedside reduction often fails.", ref: "Maxillofacial / OMFS.", mgmt: ["Antibiotics NOT indicated.", "Recurrent dislocation warrants specialist assessment for definitive treatment."] };
          return { emergency: false, ladder: 0, catg: "Acute non-traumatic TMJ dislocation — reduce",
            sc: "MANUAL REDUCTION: thumbs (gauze-wrapped) on the lower molars, press DOWN and BACK to relocate the condyles; analgesia ± muscle relaxation aids relaxation. Support the jaw after; soft diet; avoid wide mouth opening (support the chin when yawning) for a few weeks.", ref: "Dentist / OMFS if reduction fails or it recurs.", mgmt: ["This is a mechanical problem — reduction is the treatment; antibiotics NOT indicated.", "After reduction advise against wide opening; refer for recurrent dislocations.", "If bedside reduction fails, do not persist — refer for reduction under sedation."] };
        }
      }
    ]
  };

  window.SMD_WS_ENGINES = window.SMD_WS_ENGINES || {};
  window.SMD_WS_ENGINES.dentistry_omfs = DENTAL;
})();
