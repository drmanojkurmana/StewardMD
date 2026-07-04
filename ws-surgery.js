/* StewardMD — Surgery specialty engine (data + deterministic management logic).
   ---------------------------------------------------------------------------
   Registers into window.SMD_WS_ENGINES.surgery, consumed by workspaces.js. This is
   a LIGHTWEIGHT specialty pathway — NOT the Internal Medicine engine and NOT a
   diagnosis generator. For each syndrome it collects focused findings + danger
   signs and returns a conservative MANAGEMENT DECISION: the antibiotic-need level
   (0 none → 5 emergency referral), whether SOURCE CONTROL / a procedure is required,
   and the referral/escalation. Actual drug choice is deferred to the existing
   stewardship engine / Drug Index / local antibiogram + ICMR (never prescribed here).

   The recurring SURGICAL theme: antibiotics are an ADJUNCT to source control, not a
   substitute for it. A collection is drained, dead tissue is debrided, a perforation
   is closed, an obstruction is decompressed — antibiotics only support that. Blind
   antibiotics in an undifferentiated abdomen mask the picture and delay the knife.

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

  // Shared necrotising-infection result (surgical emergency).
  function necFashResult() {
    return { emergency: true, ladder: 5, catg: "⚠ Necrotising soft-tissue infection — surgical emergency",
      sc: "IMMEDIATE surgical exploration & debridement — the diagnosis is surgical, do NOT delay for imaging or a normal-looking surface.",
      ref: "Emergency surgery + critical care NOW.",
      mgmt: [
        "Pain out of proportion, rapid spread, crepitus, bullae or dishwater fluid = operate first, investigate later.",
        "Aggressive resuscitation; broad-spectrum IV cover (Gram-positive + Gram-negative + anaerobe) plus a protein-synthesis inhibitor (e.g. clindamycin) for toxin suppression — agent per local antibiogram / ICMR.",
        "Do NOT rely on a single debridement — plan re-look at 24–48 h; ICU / high-dependency care."
      ] };
  }

  var SURGERY = {
    id: "surgery",
    name: "Surgery",
    syndromes: [
      /* ───────────────────────── Acute abdomen ───────────────────────── */
      {
        id: "acute_abdomen", name: "Acute abdomen",
        q: [
          { id: "loc_ruq", label: "RUQ pain" }, { id: "epigastric", label: "Epigastric pain" },
          { id: "loc_rlq", label: "RLQ / McBurney pain" }, { id: "loc_llq", label: "LLQ pain" },
          { id: "generalised", label: "Generalised pain" }, { id: "vomiting", label: "Vomiting / obstipation" },
          { id: "distension", label: "Distension" }, { id: "prior_surgery", label: "Prior abdominal surgery" },
          { id: "female_repro", label: "Woman of childbearing age" }, { id: "fever", label: "Fever / systemic features" }
        ],
        danger: [
          { id: "peritonism", label: "Guarding / rebound / rigid abdomen" },
          { id: "free_air", label: "Free air / perforation on imaging" },
          { id: "unstable", label: "Haemodynamic instability / shock" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["peritonism", "free_air", "unstable"])) {
            return { emergency: true, ladder: 5, catg: "Surgical abdomen — peritonitis / perforation until proven otherwise",
              sc: "Resuscitate + urgent theatre for source control. NBM, wide-bore IV access, fluids, analgesia, NG tube if vomiting/distended, urinary catheter to guide resuscitation.",
              ref: "Emergency surgical referral now.",
              mgmt: [
                "Do NOT wait for imaging if peritonitic or unstable — resuscitate and call theatre.",
                "Broad-spectrum IV cover for enteric Gram-negatives + anaerobes as an ADJUNCT to source control — agent per local antibiogram / ICMR / stewardship.",
                "An erect CXR misses up to a third of perforations — a normal film does NOT exclude one."
              ] };
          }
          var pts = [];
          if (has(sel, "loc_ruq")) pts.push("RUQ → cholecystitis, cholangitis, hepatitis, peptic disease");
          if (has(sel, "epigastric")) pts.push("Epigastric → pancreatitis, peptic ulcer, gastritis, inferior MI");
          if (has(sel, "loc_rlq")) pts.push("RLQ → appendicitis; in India also ileocaecal TB, typhoid, amoebiasis; ovarian/ectopic in women");
          if (has(sel, "loc_llq")) pts.push("LLQ → diverticulitis, colitis, ureteric colic");
          if (has(sel, "generalised") || has(sel, "distension") || has(sel, "vomiting")) pts.push("Generalised / distended / vomiting → obstruction, perforation, mesenteric ischaemia");
          var hints = pts.length ? "Likely by region — " + pts.join(" · ") + "." : "Localise the pain, do a PR/hernial-orifice exam, and dip the urine.";
          var extra = has(sel, "female_repro") ? ["Woman of childbearing age → do a urine/serum β-hCG in EVERY case and think ectopic, ovarian torsion, PID."] : [];
          return { emergency: false, ladder: 3, catg: "Undifferentiated acute abdomen — needs surgical evaluation",
            sc: "Source control depends on the cause — resuscitate, NBM, analgesia; image (erect CXR + USS, CT if unclear) and reassess with serial examination.",
            ref: "Surgical review; admit for serial examination + bloods (include lipase).",
            mgmt: [
              hints,
              "Do NOT give blind antibiotics — start only once an infective/surgical source is identified; empirical cover masks the picture and delays diagnosis.",
              "Adequate analgesia does NOT hide peritonism — never withhold it to 'preserve the signs'.",
              "Exclude the medical mimics: inferior MI, DKA, lower-lobe pneumonia, ruptured AAA."
            ].concat(extra) };
        }
      },
      /* ───────────────────── Acute cholecystitis ───────────────────── */
      {
        id: "cholecystitis", name: "Acute cholecystitis",
        q: [
          { id: "murphy", label: "RUQ pain / Murphy positive" }, { id: "stones", label: "Known gallstones / USS confirmed" },
          { id: "fever", label: "Fever / raised WCC" }, { id: "vomiting", label: "Vomiting / can't tolerate orally" },
          { id: "jaundice", label: "Jaundice / dark urine (CBD stone?)" }, { id: "unfit", label: "Frail / high surgical risk" }
        ],
        danger: [
          { id: "sepsis", label: "Systemic sepsis / instability" },
          { id: "gangrene", label: "Emphysematous / gangrenous GB or perforation" },
          { id: "peritonism", label: "Generalised peritonism" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["sepsis", "gangrene", "peritonism"])) return { emergency: true, ladder: 4, catg: "Complicated cholecystitis (gangrene / perforation / sepsis)",
            sc: "Urgent source control — emergency cholecystectomy, or percutaneous cholecystostomy if unfit/unstable. Resuscitate, NBM.",
            ref: "Emergency surgical referral; admit.",
            mgmt: [
              "IV broad-spectrum cover (enteric Gram-negatives + anaerobes) per local antibiogram/ICMR as an adjunct — it does NOT replace drainage.",
              "Emphysematous cholecystitis (gas in GB wall, often diabetic men) is rapidly fatal — do not sit on it."
            ] };
          if (has(sel, "jaundice")) return { emergency: false, ladder: 3, catg: "Cholecystitis with obstructive jaundice — exclude CBD stone / cholangitis",
            sc: "Admit, NBM, IV fluids; USS then MRCP/ERCP to clear the duct; cholecystectomy once settled.",
            ref: "Surgical + GI review; open the Cholangitis pathway if fever + jaundice + RUQ pain (Charcot).",
            mgmt: [
              "Jaundice + fever + RUQ pain = cholangitis, not simple cholecystitis — that is an IM-primary emergency needing biliary drainage.",
              "IV antibiotics per local guidance; deranged LFTs point to a CBD stone."
            ] };
          return { emergency: false, ladder: 3, catg: "Acute (calculous) cholecystitis",
            sc: "Admit, NBM, IV fluids, analgesia; USS is first-line. Definitive source control = early laparoscopic cholecystectomy (same admission / within ~1 week beats delayed).",
            ref: "Surgical admission.",
            mgmt: [
              "Antibiotics are supportive — cholecystectomy is the cure; do not discharge on antibiotics alone expecting it to settle for good.",
              "Acalculous cholecystitis occurs in the critically ill / fasted / diabetic — no stones does not exclude it.",
              "IV cover per local antibiogram/ICMR; de-escalate as the patient settles."
            ] };
        }
      },
      /* ───────────────────── Bowel obstruction ───────────────────── */
      {
        id: "bowel_obstruction", name: "Bowel obstruction",
        q: [
          { id: "colicky", label: "Colicky pain" }, { id: "vomiting", label: "Vomiting (bilious / feculent)" },
          { id: "obstipation", label: "Absolute constipation (no flatus)" }, { id: "distension", label: "Distension" },
          { id: "adhesions", label: "Prior surgery (adhesions?)" }, { id: "hernia", label: "Hernia / groin lump" },
          { id: "malignancy", label: "Altered bowel habit / weight loss (LBO?)" }
        ],
        danger: [
          { id: "ischaemia", label: "Constant pain / focal tenderness (strangulation)" },
          { id: "peritonism", label: "Peritonism / free air" }, { id: "unstable", label: "Sepsis / instability" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["ischaemia", "peritonism", "unstable"])) return { emergency: true, ladder: 5, catg: "Obstruction with strangulation / ischaemia — surgical emergency",
            sc: "Urgent theatre — resect non-viable bowel. Resuscitate aggressively, NBM, NG decompression, urinary catheter.",
            ref: "Emergency surgical referral now.",
            mgmt: [
              "Continuous (not colicky) pain, tenderness, rising lactate or fever = strangulation — do NOT persist with conservative treatment.",
              "IV cover for enteric Gram-negatives + anaerobes per local antibiogram/ICMR, as an adjunct to resection."
            ] };
          if (has(sel, "hernia")) return { emergency: false, ladder: 3, catg: "Obstruction with an external hernia — likely mechanical cause",
            sc: "Examine every hernial orifice. NBM, NG, IV fluids; a tender irreducible hernia needs urgent surgery — open the Hernia pathway.",
            ref: "Urgent surgical review.",
            mgmt: [
              "A groin lump + obstruction = incarcerated/strangulated hernia until proven otherwise; do not force reduction of a tender/dusky hernia.",
              "Antibiotics not needed for simple mechanical obstruction — reserve for strangulation/perforation."
            ] };
          if (has(sel, "malignancy")) return { emergency: false, ladder: 3, catg: "Suspected large-bowel obstruction — exclude malignancy / volvulus",
            sc: "NBM, NG, IV fluids; CT to define level & cause. LBO is less likely to settle and often needs surgery/stent; a competent ileocaecal valve risks caecal blow-out.",
            ref: "Surgical admission; imaging urgently.",
            mgmt: [
              "Do NOT assume adhesions in LBO — colorectal cancer, sigmoid volvulus and stricture are the common causes here.",
              "Antibiotics only if perforation/strangulation supervenes."
            ] };
          return { emergency: false, ladder: 0, catg: "Simple / adhesive small-bowel obstruction",
            sc: "'Drip and suck' — NBM, NG decompression, IV fluids, correct electrolytes, catheter + fluid balance; water-soluble contrast study can be therapeutic & prognostic.",
            ref: "Surgical admission; serial examination.",
            mgmt: [
              "Antibiotics are NOT indicated for uncomplicated obstruction — it is a mechanical, not infective, problem.",
              "Escalate to theatre if pain becomes constant, tenderness develops, or it fails to resolve in ~48 h.",
              "Adhesions are the commonest cause after prior surgery, but always exclude a hernia and malignancy."
            ] };
        }
      },
      /* ───────────────── Incarcerated / strangulated hernia ───────────────── */
      {
        id: "hernia", name: "Incarcerated / strangulated hernia",
        q: [
          { id: "irreducible", label: "Lump now irreducible" }, { id: "tender", label: "Tender / painful lump" },
          { id: "obstruction", label: "Vomiting / distension (obstructed)" }, { id: "femoral", label: "Femoral site / woman" },
          { id: "reducible", label: "Previously reducible" }
        ],
        danger: [
          { id: "strangulation", label: "Tense, tender, dusky/red overlying skin" },
          { id: "sepsis", label: "Systemic sepsis / peritonism" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["strangulation", "sepsis"])) return { emergency: true, ladder: 5, catg: "Strangulated hernia — ischaemic bowel, surgical emergency",
            sc: "Emergency theatre — reduce & assess viability, resect if non-viable. Resuscitate, NBM, NG.",
            ref: "Emergency surgical referral now.",
            mgmt: [
              "Do NOT attempt forceful reduction of a tender/discoloured hernia — you risk reducing dead bowel en-masse into the abdomen.",
              "IV cover for enteric organisms + anaerobes per local antibiogram/ICMR, as an adjunct to resection."
            ] };
          if (anyOf(sel, ["irreducible", "obstruction", "tender"])) return { emergency: false, ladder: 3, catg: "Incarcerated hernia — needs urgent repair",
            sc: "Analgesia, NBM, IV fluids; gentle taxis may be attempted ONLY if non-tender and no strangulation signs, otherwise prep for urgent surgery.",
            ref: "Urgent surgical review; admit.",
            mgmt: [
              "Femoral hernias (often in women) have a high strangulation risk — low threshold for surgery.",
              "Antibiotics not needed unless bowel is compromised — this is a mechanical problem needing repair."
            ] };
          return { emergency: false, ladder: 0, catg: "Reducible hernia — no acute complication",
            sc: "No procedure now; confirms fully reducible with a cough impulse.",
            ref: "Elective surgical referral for repair.",
            mgmt: [
              "No antibiotics.",
              "Safety-net: return immediately if the lump becomes painful, irreducible, or vomiting starts."
            ] };
        }
      },
      /* ───────────────────── GI perforation ───────────────────── */
      {
        id: "gi_perforation", name: "GI perforation",
        q: [
          { id: "sudden", label: "Sudden severe pain" }, { id: "peptic", label: "Peptic ulcer / NSAID / steroid use" },
          { id: "rigid", label: "Board-like rigid abdomen" }, { id: "free_air", label: "Free air on CXR / CT" },
          { id: "typhoid", label: "Prolonged fever (enteric / typhoid?)" }, { id: "malignancy", label: "Known diverticular / colonic disease" }
        ],
        danger: [
          { id: "sepsis", label: "Sepsis / shock" }, { id: "peritonism", label: "Generalised peritonitis" }
        ],
        assess: function () {
          return { emergency: true, ladder: 5, catg: "GI perforation — peritonitis, surgical emergency",
            sc: "Resuscitate + urgent theatre for source control (repair / omental patch / resection ± washout). NBM, wide-bore IV, fluids, NG, urinary catheter.",
            ref: "Emergency surgical referral now.",
            mgmt: [
              "IV broad-spectrum cover (enteric Gram-negatives + anaerobes; add antifungal thinking in upper-GI/immunocompromised per local protocol) — ADJUNCT to source control, per local antibiogram/ICMR.",
              "In India think enteric (typhoid) terminal-ileal perforation and ileocaecal TB, not just peptic ulcer.",
              "A normal erect CXR does NOT exclude perforation — get a CT if stable and the diagnosis is in doubt.",
              "Only highly selected, stable, contained/sealed perforations are managed non-operatively — the default is theatre."
            ] };
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
          if (has(sel, "necrosis")) return necFashResult();
          if (has(sel, "evisceration")) return { emergency: true, ladder: 5, catg: "Fascial dehiscence with evisceration",
            sc: "Cover the bowel with saline-soaked gauze, do NOT push it back; NBM, urgent theatre for closure.",
            ref: "Emergency surgical referral.",
            mgmt: ["Resuscitate; IV antibiotics per local protocol as an adjunct — the treatment is operative re-closure."] };
          if (anyOf(sel, ["deep", "sepsis"])) return { emergency: false, ladder: 4, catg: "Deep / organ-space surgical site infection",
            sc: "Source control — drain the collection (image-guided or open); send pus for culture. Retained infected mesh may need removal.",
            ref: "Surgical review; imaging for a collection.",
            mgmt: [
              "IV cover (Gram-positive + enteric, per local antibiogram) once drained; de-escalate on culture.",
              "Antibiotics without draining a deep collection will fail — find and drain the source."
            ] };
          if (has(sel, "purulent")) return { emergency: false, ladder: 2, catg: "Superficial surgical site infection",
            sc: "Open the wound / release pus, lay it open for dressings; swab only if not responding.",
            ref: "Nursing wound care; surgical review if worsening.",
            mgmt: [
              "The treatment is opening the wound, NOT reflex antibiotics — a drained superficial SSI often needs no systemic cover.",
              "Add oral antibiotics only for surrounding cellulitis or systemic features; reassess at 48 h."
            ] };
          return { emergency: false, ladder: 1, catg: "Wound concern — reassess",
            sc: "Wound care, keep clean and dry.",
            ref: "Review if discharge, spreading erythema or fever develop.",
            mgmt: ["No antibiotics without signs of infection."] };
        }
      },
      /* ───────────────────── Cellulitis / soft-tissue ───────────────────── */
      {
        id: "cellulitis", name: "Cellulitis / soft-tissue infection",
        q: [
          { id: "erythema", label: "Warm, spreading erythema" }, { id: "portal", label: "Portal of entry (crack / ulcer / bite)" },
          { id: "purulent", label: "Purulent / fluctuant (abscess?)" }, { id: "systemic", label: "Fever / systemic features" },
          { id: "diabetes", label: "Diabetes / immunosuppression" }, { id: "bilateral", label: "Bilateral leg redness (mimic?)" }
        ],
        danger: [
          { id: "oop", label: "Pain out of proportion to signs" }, { id: "crepitus", label: "Crepitus / bullae / dusky skin" },
          { id: "rapid", label: "Rapidly advancing margin" }, { id: "sepsis", label: "Systemic sepsis / instability" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["oop", "crepitus", "rapid"])) return necFashResult();
          if (has(sel, "purulent")) return { emergency: false, ladder: 4, catg: "Purulent SSTI — likely abscess",
            sc: "Incision & drainage is the primary treatment; culture the pus.",
            ref: "Surgical / minor-ops.",
            mgmt: ["Antibiotics are the adjunct — add for surrounding cellulitis, systemic features, immunocompromise or diabetes; cover S. aureus (MRSA per local rates)."] };
          if (has(sel, "sepsis")) return { emergency: false, ladder: 3, catg: "Cellulitis with systemic features",
            sc: "Rule out a drainable collection (USS if in doubt); mark the margin.",
            ref: "Admit; surgical review if a collection is found.",
            mgmt: ["IV anti-streptococcal / anti-staphylococcal cover per local antibiogram; reassess the marked margin."] };
          if (has(sel, "bilateral")) return { emergency: false, ladder: 0, catg: "Bilateral lower-leg redness — likely NOT cellulitis",
            sc: "No collection to drain; elevate, emollients, treat venous disease.",
            ref: "Review; reconsider the diagnosis.",
            mgmt: [
              "Bilateral, symmetrical, non-tender leg redness is usually venous stasis / lipodermatosclerosis, NOT infection — a very common over-treatment trap.",
              "True cellulitis is almost always unilateral and acutely tender — do not start antibiotics for stasis."
            ] };
          return { emergency: false, ladder: 2, catg: "Uncomplicated cellulitis",
            sc: "No collection to drain — mark the margin, elevate the limb, treat the portal of entry.",
            ref: "Review at 48 h; escalate if spreading.",
            mgmt: ["Oral anti-streptococcal / anti-staphylococcal antibiotic per local guidance; lower threshold for IV in diabetes / immunosuppression."] };
        }
      },
      /* ───────────────────────── Abscess (incl. perianal / pilonidal) ───────────────────────── */
      {
        id: "abscess", name: "Abscess (incl. perianal / pilonidal)",
        q: [
          { id: "fluctuant", label: "Fluctuant / localised collection" }, { id: "perianal", label: "Perianal / perineal site" },
          { id: "pilonidal", label: "Natal cleft (pilonidal)" }, { id: "large", label: "Large / deep collection" },
          { id: "cellulitis", label: "Surrounding cellulitis" }, { id: "systemic", label: "Fever / systemic features" },
          { id: "immuno", label: "Diabetes / immunosuppression" }
        ],
        danger: [
          { id: "fournier", label: "Severe perineal pain / crepitus / necrosis (Fournier?)" },
          { id: "sepsis", label: "Systemic sepsis" }
        ],
        assess: function (sel) {
          if (has(sel, "fournier")) return necFashResult();
          if (has(sel, "perianal")) return { emergency: false, ladder: 4, catg: "Perianal abscess — needs drainage",
            sc: "Incision & drainage (theatre / EUA) is the definitive treatment; do NOT wait for it to 'point'. Send pus for culture.",
            ref: "Surgical drainage; image (MRI) for suspected ischiorectal / supralevator / horseshoe extension.",
            mgmt: [
              "Antibiotics do NOT drain an abscess — pain out of proportion demands EUA; deep pain with a normal-looking outside suggests a supralevator collection.",
              "Diabetics have a high risk of Fournier's gangrene — reassess for spreading necrosis.",
              "Do not chase a fistula acutely; add antibiotics only for cellulitis, systemic sepsis or immunocompromise, per local antibiogram."
            ] };
          if (has(sel, "pilonidal")) return { emergency: false, ladder: 4, catg: "Pilonidal abscess — needs drainage",
            sc: "Incision & drainage off the midline for the acute abscess; definitive excision is a planned later procedure.",
            ref: "Surgical drainage; elective follow-up for definitive surgery.",
            mgmt: ["Drainage is the treatment; antibiotics are adjunct only if surrounding cellulitis or systemic features — per local guidance."] };
          return { emergency: false, ladder: 4, catg: "Abscess — needs drainage",
            sc: "Incision & drainage / image-guided drainage is definitive; send pus for culture.",
            ref: "Surgical drainage (theatre if deep / large).",
            mgmt: ["Antibiotics are adjunct to drainage — add for surrounding cellulitis, systemic features or immunocompromise; choose per local antibiogram and de-escalate on culture."] };
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
            sc: "Urgent surgical debridement / drainage; decompress the deep spaces of the foot; assess for revascularisation.",
            ref: "Emergency surgical + vascular referral; admit.",
            mgmt: [
              "The deep-space infection tracks along tendons — drain it early; do not be reassured by a small skin opening.",
              "Broad-spectrum IV cover (Gram-positive + Gram-negative ± anaerobic) per local antibiogram/ICMR; tight glycaemic control; de-escalate on deep culture."
            ] };
          if (anyOf(sel, ["purulent", "probe_bone"])) return { emergency: false, ladder: 3, catg: "Moderate diabetic foot infection ± osteomyelitis",
            sc: "Drain/debride collections; probe-to-bone + plain X-ray (then MRI) for osteomyelitis; offload.",
            ref: "Surgical + podiatry/vascular; consider admission.",
            mgmt: [
              "Probe-to-bone positive strongly suggests osteomyelitis — send a deep/bone specimen, not a superficial swab, to guide therapy.",
              "IV then oral antibiotics guided by deep culture; always assess perfusion — infection won't clear an ischaemic foot."
            ] };
          if (has(sel, "erythema")) return { emergency: false, ladder: 2, catg: "Mild diabetic foot infection",
            sc: "Debride callus / dead tissue; offload pressure; wound care.",
            ref: "Podiatry / diabetic foot clinic.",
            mgmt: [
              "Diabetics mount a blunted inflammatory response — modest signs can hide serious infection, so review closely.",
              "Oral antibiotics targeting Gram-positives per local guidance."
            ] };
          return { emergency: false, ladder: 1, catg: "Diabetic foot — no active infection",
            sc: "Offloading, wound care, vascular assessment.",
            ref: "Diabetic foot clinic.",
            mgmt: ["No antibiotics without signs of infection — a colonised ulcer is not an infected one."] };
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
            sc: severe ? "URGENT biliary decompression (ERCP; PTC if ERCP not feasible) — an obstructed infected duct will not respond to antibiotics alone, source control cannot wait." : "Biliary drainage (ERCP) is the definitive source control — arrange early; timing per severity grade.",
            ref: "Internal Medicine leads sepsis + antibiotics (per ICMR/local); GI/Surgery/IR for drainage.",
            shared: true,
            mgmt: [
              "SHARED condition: open the Internal Medicine pathway for the full diagnostic + antibiotic assessment (ICMR precedence preserved).",
              "Surgery/IR role here = source control (drainage), not antibiotic selection — a decompensating patient needs the duct drained now."
            ] };
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
            sc: drain ? "Percutaneous (image-guided) drainage indicated; surgical drainage if ruptured or not amenable." : "Small abscesses may respond to medical therapy — IM leads; drain if large or not improving.",
            ref: "Internal Medicine for pyogenic-vs-amoebic work-up + antibiotics; IR/Surgery for drainage.",
            mgmt: [
              "SHARED condition — the Internal Medicine pathway owns diagnosis + antimicrobial choice (ICMR/local); amoebic (common in India) is treated medically first.",
              "Surgery/IR role = drainage / source control, especially large left-lobe or non-responding abscesses."
            ] };
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
            mgmt: [
              "SHARED condition — IM owns the diagnostic pathway (infective vs IBD vs ischaemic) + antibiotics/therapy.",
              "Surgery escalates only for toxic megacolon, perforation, or an acute abdomen — track colonic diameter and lactate."
            ] };
        }
      }
    ]
  };

  window.SMD_WS_ENGINES = window.SMD_WS_ENGINES || {};
  window.SMD_WS_ENGINES.surgery = SURGERY;
})();
