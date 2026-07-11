/* StewardMD - Urology specialty engine (data + deterministic management logic).
   ---------------------------------------------------------------------------
   Registers into window.SMD_WS_ENGINES.urology, consumed by workspaces.js. A
   LIGHTWEIGHT specialty pathway - NOT the Internal Medicine engine and NOT a
   diagnosis generator. For each syndrome it collects focused findings + danger
   signs and returns a conservative MANAGEMENT DECISION: the antibiotic-need
   level (0 none → 5 emergency referral), whether SOURCE CONTROL / a procedure
   (decompression, drainage, catheter, detorsion, debridement) is required, and
   the referral/escalation. Actual drug choice is deferred to the existing
   stewardship engine / Drug Index / local antibiogram + ICMR (never prescribed here).

   The recurring urology theme is SOURCE CONTROL: most true emergencies are not
   solved by antibiotics but by a TIME-CRITICAL procedure - the obstructed infected
   kidney (decompression within hours), acute retention (immediate catheter),
   testicular torsion (theatre within ~6 h), paraphimosis (immediate reduction),
   priapism (emergency aspiration/shunt), clot retention (washout) and Fournier's
   gangrene (immediate debridement). The engine's job is to separate the
   uncomplicated, self-limiting lower UTI from these presentations that must not
   be missed. Urology OWNS these conditions (source control is the point), so they
   are NOT flagged shared:true; where sepsis needs medical/ICU co-management the
   notes say so explicitly.

   Advisory only. Verify against local protocol, imaging, and the individual patient. */
(function () {
  "use strict";
  // ladder index → matches ABX/management ladder in workspaces.js
  // 0 none · 1 topical/local · 2 oral · 3 IV/admission · 4 urgent decompression/drainage/catheter/procedure (source control) · 5 emergency referral
  function has(sel, id) { return sel && sel.has && sel.has(id); }
  function anyOf(sel, ids) { for (var i = 0; i < ids.length; i++) if (has(sel, ids[i])) return true; return false; }

  var UROLOGY = {
    id: "urology",
    name: "Urology",
    syndromes: [
      /* ───────────────────── Uncomplicated cystitis ───────────────────── */
      {
        id: "cystitis", name: "Cystitis (lower UTI)",
        q: [
          { id: "dysuria", label: "Dysuria / frequency / urgency" }, { id: "suprapubic", label: "Suprapubic discomfort" },
          { id: "male", label: "Male patient" }, { id: "pregnant", label: "Pregnant" },
          { id: "catheter", label: "Indwelling catheter" }, { id: "recurrent", label: "Recurrent / structural abnormality / stone" },
          { id: "immuno", label: "Diabetes / immunocompromise" }
        ],
        danger: [
          { id: "flank_fever", label: "Flank pain / fever / rigors (upper tract - not simple cystitis)" },
          { id: "sepsis", label: "Systemic sepsis / haemodynamic instability" }
        ],
        assess: function (sel) {
          if (has(sel, "sepsis")) return { emergency: true, ladder: 3, catg: "UTI with systemic sepsis - admit, exclude obstruction",
            sc: "Urgent imaging (USS/CT KUB) to exclude an obstructed infected system needing decompression; catheterise / monitor output.", ref: "Admit; IM/ICU co-management for sepsis resuscitation; urgent Urology if obstruction.", mgmt: ["IV broad-spectrum antibiotic per local antibiogram/ICMR after cultures - do NOT manage as simple cystitis.", "IM/ICU co-management for sepsis resuscitation; antibiotic choice per ICMR/local."],
            abx: { firstLine: [{ drug: "Piperacillin-tazobactam", dose: "4.5 g", route: "IV q6-8h" }, { drug: "Amikacin", dose: "15 mg/kg", route: "IV once daily", note: "add for severe sepsis / prior resistant organism; monitor renal function" }], alt: [{ drug: "Meropenem", dose: "1 g", route: "IV q8h", note: "if ESBL risk / prior ESBL colonisation / recent hospitalisation" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Manage as urosepsis, not simple cystitis - exclude an obstructed infected system needing decompression." } };
          if (has(sel, "flank_fever")) return { emergency: false, ladder: 3, catg: "Features of upper-tract infection - reassess as pyelonephritis",
            sc: "No lower-tract procedure - image if obstruction / stone suspected.", ref: "Reassess on the pyelonephritis pathway; admit if unwell.", mgmt: ["Flank pain + fever is NOT uncomplicated cystitis - escalate assessment.", "Antibiotic per local urinary guidance once tract level established."],
            abx: { firstLine: [{ drug: "Ceftriaxone", dose: "1-2 g", route: "IV once daily", note: "if unwell / cannot tolerate oral" }, { drug: "Cefixime", dose: "200 mg", route: "PO BID", note: "oral option if systemically well" }], alt: [{ drug: "Meropenem", dose: "1 g", route: "IV q8h", note: "if ESBL risk / prior ESBL / recent hospitalisation" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Treat as pyelonephritis once upper-tract involvement is established - send cultures first; avoid empiric fluoroquinolones." } };
          if (has(sel, "catheter")) return { emergency: false, ladder: 2, catg: "Catheter-related lower UTI - reassess as CAUTI",
            sc: "Source control = remove / change the catheter; treat only if symptomatic.", ref: "Reassess on the CAUTI pathway.", mgmt: ["Do NOT treat asymptomatic bacteriuria in a catheterised patient.", "Antibiotic per local urinary guidance only if symptomatic."],
            abx: { firstLine: [{ drug: "Cefuroxime", dose: "500 mg", route: "PO BID", note: "ONLY if symptomatic; 7 days" }], alt: [{ drug: "Amikacin", dose: "15 mg/kg", route: "IV once daily", note: "if systemically unwell / resistant organism; monitor renal function" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Do NOT treat asymptomatic bacteriuria - antibiotics ONLY if symptomatic; change/remove the catheter (source control) and culture from a freshly placed catheter first." } };
          if (anyOf(sel, ["male", "pregnant", "recurrent", "immuno"])) return { emergency: false, ladder: 2, catg: "Complicated lower UTI (male / pregnancy / structural / immunocompromise)",
            sc: "No procedure; image / Urology referral if recurrent, stone or structural abnormality.", ref: "GP/Urology follow-up; low threshold for review in pregnancy or immunocompromise.", mgmt: ["Send urine culture BEFORE starting antibiotics; oral antibiotic per local urinary guidance - often a longer course than uncomplicated cystitis.", "In pregnancy avoid agents contraindicated by trimester - choose per local guidance; treat even asymptomatic bacteriuria in pregnancy.", "A UTI in a man is complicated by default - think prostate / obstruction / stone and investigate."],
            abx: { firstLine: [{ drug: "Nitrofurantoin", dose: "100 mg", route: "PO BID", note: "7 days; NOT at term (>36 wk) in pregnancy or eGFR <30" }, { drug: "Cefuroxime", dose: "500 mg", route: "PO BID", note: "7 days; pregnancy-safe option" }], alt: [{ drug: "Cefixime", dose: "200 mg", route: "PO BID", note: "pregnancy-safe alternative" }, { drug: "Amoxicillin-clavulanate", dose: "625 mg", route: "PO TID", note: "pregnancy-safe; culture-guided" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Longer course (7-14 d); in pregnancy avoid nitrofurantoin at term, trimethoprim/sulfonamides (1st trimester) and fluoroquinolones, and treat asymptomatic bacteriuria." } };
          if (anyOf(sel, ["dysuria", "suprapubic"])) return { emergency: false, ladder: 2, catg: "Uncomplicated cystitis (non-pregnant woman)",
            sc: "No procedure.", ref: "Safety-net; review if flank pain, fever or rigors develop (upper-tract spread).", mgmt: ["Short oral course per local urinary guidance is first-line - defer the agent/duration to stewardship / Drug Index / local protocol.", "Encourage fluids + analgesia; culture not routinely needed if typical and uncomplicated.", "Return if symptoms escalate to flank pain / fever / systemic upset."],
            abx: { firstLine: [{ drug: "Nitrofurantoin", dose: "100 mg", route: "PO BID", note: "5 days; avoid if eGFR <30 or upper-tract features" }, { drug: "Fosfomycin trometamol", dose: "3 g", route: "PO single dose" }], alt: [{ drug: "Cefixime", dose: "200 mg", route: "PO BID", note: "3-5 days if nitrofurantoin/fosfomycin unsuitable" }, { drug: "Co-trimoxazole", dose: "160/800 mg", route: "PO BID", note: "3 days ONLY where local resistance <20%" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Avoid empiric fluoroquinolones for simple cystitis (high Indian resistance)." } };
          return { emergency: false, ladder: 0, catg: "No clear UTI features - reassess",
            sc: "No procedure.", ref: "Safety-net; culture if diagnosis unclear.", mgmt: ["Antibiotics NOT indicated without symptoms - do not treat asymptomatic bacteriuria (except pregnancy).", "Consider alternative causes of lower urinary symptoms."] };
        }
      },
      /* ───────────────────── Acute pyelonephritis ───────────────────── */
      {
        id: "pyelonephritis", name: "Acute pyelonephritis",
        q: [
          { id: "flank", label: "Flank / loin pain, angle tenderness" }, { id: "fever", label: "Fever / rigors" },
          { id: "lower", label: "Lower-tract symptoms (dysuria / frequency)" }, { id: "nausea", label: "Nausea / vomiting (can't tolerate oral)" },
          { id: "pregnant", label: "Pregnant" }, { id: "comorbid", label: "Diabetes / immunocompromise / elderly" }
        ],
        danger: [
          { id: "obstruction", label: "Known / suspected stone or hydronephrosis (obstructed system?)" },
          { id: "sepsis", label: "Sepsis / hypotension / altered sensorium" }
        ],
        assess: function (sel) {
          if (has(sel, "obstruction")) return { emergency: true, ladder: 5, catg: "⚠ Pyelonephritis + possible obstruction - exclude obstructed infected kidney",
            sc: "URGENT imaging (CT KUB / USS); if obstructed & infected, decompression (nephrostomy or ureteric stent) is the definitive source control and CANNOT wait for antibiotics to work.", ref: "Emergency Urology now; IM/ICU co-management for sepsis resuscitation.", mgmt: ["An obstructed, infected kidney is a urological emergency - antibiotics alone will not save the kidney or the patient.", "IV broad-spectrum antibiotic per local antibiogram/ICMR after cultures, as an ADJUNCT to decompression.", "Definitive stone treatment is deferred until infection is controlled."],
            abx: { firstLine: [{ drug: "Piperacillin-tazobactam", dose: "4.5 g", route: "IV q6-8h" }, { drug: "Meropenem", dose: "1 g", route: "IV q8h", note: "if ESBL risk / prior ESBL / recent hospitalisation" }], alt: [{ drug: "Amikacin", dose: "15 mg/kg", route: "IV once daily", note: "add for severe sepsis; monitor renal function" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Antibiotics are an ADJUNCT to emergency decompression (nephrostomy/stent) - source control, not antibiotics, saves the kidney." } };
          if (anyOf(sel, ["sepsis", "nausea"]) || (has(sel, "fever") && anyOf(sel, ["pregnant", "comorbid"]))) return { emergency: has(sel, "sepsis"), ladder: 3, catg: "Severe / complicated pyelonephritis - admit for IV therapy",
            sc: "Image to exclude obstruction / abscess; decompression if an obstructed infected system is found.", ref: "Admit; Urology if obstruction / no response; IM/ICU co-management if septic.", mgmt: ["IV broad-spectrum antibiotic per local antibiogram/ICMR after blood + urine cultures; step down to oral on improvement.", "Low admission threshold in pregnancy, diabetes, immunocompromise or the elderly.", "If not improving by 48-72 h, re-image for obstruction or renal/perinephric abscess.", "If septic: IM/ICU co-management for sepsis resuscitation; antibiotic choice per ICMR/local."],
            abx: { firstLine: [{ drug: "Ceftriaxone", dose: "1-2 g", route: "IV once daily" }], alt: [{ drug: "Piperacillin-tazobactam", dose: "4.5 g", route: "IV q6-8h", note: "broader Gram-negative cover" }, { drug: "Meropenem", dose: "1 g", route: "IV q8h", note: "if ESBL risk / prior ESBL / recent hospitalisation" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Start IV after blood + urine cultures; step down to a culture-guided oral agent on improvement; total 10-14 d." } };
          if (has(sel, "flank") && has(sel, "fever")) return { emergency: false, ladder: 2, catg: "Uncomplicated pyelonephritis - systemically well",
            sc: "No procedure; image only if not improving at 48-72 h or obstruction suspected.", ref: "Review at 48-72 h; escalate / admit if worsening or vomiting.", mgmt: ["Oral antibiotic per local urinary guidance if tolerating oral and haemodynamically stable - send culture first.", "Safety-net: return for rigors, vomiting, or increasing pain (may need IV / imaging)."],
            abx: { firstLine: [{ drug: "Cefixime", dose: "200 mg", route: "PO BID", note: "10-14 days" }, { drug: "Cefpodoxime", dose: "200 mg", route: "PO BID" }], alt: [{ drug: "Ciprofloxacin", dose: "500 mg", route: "PO BID", note: "7 days - ONLY if local FQ resistance low / culture-confirmed susceptibility" }, { drug: "Ceftriaxone", dose: "1-2 g", route: "IV once daily", note: "single initial IV dose then oral step-down" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Avoid empiric fluoroquinolones unless susceptibility is known - high Indian resistance." } };
          return { emergency: false, ladder: 2, catg: "Suspected pyelonephritis - confirm features",
            sc: "No procedure.", ref: "Reassess; admit if systemic features develop.", mgmt: ["Send urine culture before antibiotics; treat per local urinary guidance based on severity.", "Reassess tract level and complicating factors."],
            abx: { firstLine: [{ drug: "Cefixime", dose: "200 mg", route: "PO BID", note: "if well enough for oral; treat per confirmed severity" }], alt: [{ drug: "Ceftriaxone", dose: "1-2 g", route: "IV once daily", note: "if systemic features develop" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Confirm tract level and send culture before starting; escalate to IV if systemic features appear." } };
        }
      },
      /* ───────── Obstructed infected system (urological emergency) ───────── */
      {
        id: "obstructed_infected_system", name: "Obstructed infected system",
        q: [
          { id: "flank", label: "Flank / loin pain" }, { id: "fever", label: "Fever / rigors" },
          { id: "stone", label: "Known / suspected ureteric stone" }, { id: "hydro", label: "Hydronephrosis on imaging" },
          { id: "single_kidney", label: "Single / transplant kidney" }
        ],
        danger: [
          { id: "sepsis", label: "Sepsis / hypotension / altered sensorium" },
          { id: "anuria", label: "Anuria / rapidly rising creatinine" }
        ],
        assess: function () {
          return { emergency: true, ladder: 5, catg: "⚠ Obstructed, infected kidney - urological emergency",
            sc: "IMMEDIATE decompression is the definitive source control - emergency nephrostomy or ureteric stent; this CANNOT wait for antibiotics to work. Confirm with urgent CT KUB / USS but do NOT delay decompression in a septic obstructed patient.",
            ref: "Emergency Urology + Interventional Radiology NOW; IM/ICU co-management for sepsis resuscitation.",
            mgmt: ["Pus under pressure above an obstruction is like an undrained abscess - antibiotics alone will not clear it and the patient can deteriorate rapidly.", "IV broad-spectrum antibiotic per local antibiogram/ICMR after blood + urine cultures - as an ADJUNCT to decompression, never a substitute.", "IM/ICU co-management for sepsis resuscitation; antibiotic choice per ICMR/local. Definitive stone treatment is deferred until infection is controlled."],
            abx: { firstLine: [{ drug: "Piperacillin-tazobactam", dose: "4.5 g", route: "IV q6-8h" }, { drug: "Meropenem", dose: "1 g", route: "IV q8h", note: "if ESBL risk / prior ESBL / recent hospitalisation / prior resistant organism" }], alt: [{ drug: "Amikacin", dose: "15 mg/kg", route: "IV once daily", note: "add for severe sepsis; monitor renal function" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Antibiotics are an ADJUNCT to IMMEDIATE decompression (nephrostomy/stent) - never a substitute for source control." } };
        }
      },
      /* ───────────────────── Ureteric / renal colic (stone, no infection) ───────────────────── */
      {
        id: "renal_colic", name: "Ureteric / renal colic (stone)",
        q: [
          { id: "loin_groin", label: "Loin-to-groin colicky pain, can't lie still" }, { id: "haematuria", label: "Visible or dipstick haematuria" },
          { id: "nausea", label: "Nausea / vomiting" }, { id: "known_stone", label: "Known stone / previous colic" },
          { id: "smallstone", label: "Small distal stone likely to pass" }
        ],
        danger: [
          { id: "fever", label: "Fever / rigors / systemic upset (infected obstruction?)" },
          { id: "solitary_aki", label: "Single / transplant kidney, bilateral stones or AKI / anuria" },
          { id: "unsure_dx", label: "Age > 60 / first episode - could be leaking AAA" }
        ],
        assess: function (sel) {
          if (has(sel, "fever")) return { emergency: true, ladder: 5, catg: "⚠ Stone + fever = obstructed infected system until excluded",
            sc: "URGENT CT KUB; if an obstructed infected kidney is confirmed, emergency decompression (stent / nephrostomy) is the priority - treat the obstruction, not just the bug.", ref: "Emergency Urology now; reassess on the obstructed-infected-system pathway; IM/ICU if septic.", mgmt: ["A febrile stone patient is a surgical emergency - this is NOT simple colic.", "IV antibiotic per local antibiogram/ICMR after cultures, as an ADJUNCT to decompression."],
            abx: { firstLine: [{ drug: "Piperacillin-tazobactam", dose: "4.5 g", route: "IV q6-8h" }, { drug: "Meropenem", dose: "1 g", route: "IV q8h", note: "if ESBL risk / prior ESBL / recent hospitalisation" }], alt: [{ drug: "Amikacin", dose: "15 mg/kg", route: "IV once daily", note: "add for severe sepsis; monitor renal function" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Antibiotics are an ADJUNCT to emergency decompression of the obstructed infected kidney - this is NOT simple colic." } };
          if (has(sel, "solitary_aki")) return { emergency: true, ladder: 4, catg: "Obstructing stone in solitary kidney / bilateral / AKI",
            sc: "Urgent imaging + renal function; decompression (stent / nephrostomy) if the obstruction threatens the only functioning kidney or causes AKI.", ref: "Urgent Urology; admit for renal function monitoring.", mgmt: ["Obstruction of a single/transplant kidney or bilateral obstruction is limb-of-life for the kidney - decompress early.", "Antibiotics only if concurrent infection - otherwise not indicated."] };
          if (has(sel, "unsure_dx")) return { emergency: true, ladder: 3, catg: "First 'colic' in older patient - EXCLUDE ruptured AAA",
            sc: "Do NOT assume stone - a leaking AAA mimics renal colic; urgent CT / bedside USS before anchoring on colic.", ref: "Urgent assessment; Surgery/Vascular if aneurysm suspected.", mgmt: ["First presentation of 'renal colic' over ~60 is a AAA until imaging proves a stone.", "Antibiotics NOT indicated for uncomplicated stone disease."] };
          if (anyOf(sel, ["loin_groin", "haematuria", "nausea", "known_stone", "smallstone"])) return { emergency: false, ladder: 0, catg: "Uncomplicated ureteric colic - analgesia + imaging",
            sc: "No antibiotics; non-contrast CT KUB confirms; most small distal stones pass spontaneously - medical expulsive therapy / observation.", ref: "Urology follow-up for large or non-passing stones; return if fever develops.", mgmt: ["ANALGESIA is the priority - an NSAID is first-line for colic where not contraindicated (agent/dose per local protocol).", "Antibiotics have NO role in a stone WITHOUT infection - do not co-prescribe reflexively.", "Strain urine, hydrate; SAFETY-NET hard: fever or rigors means possible obstructed infected system - return immediately."] };
          return { emergency: false, ladder: 0, catg: "Suspected renal colic - characterise",
            sc: "Non-contrast CT KUB; assess renal function and for infection.", ref: "Reassess; Urology if confirmed stone needs intervention.", mgmt: ["Confirm the diagnosis before labelling as colic; exclude infection and AAA.", "No antibiotics without an infective picture."] };
        }
      },
      /* ───────────────────── Acute urinary retention ───────────────────── */
      {
        id: "acute_urinary_retention", name: "Acute urinary retention",
        q: [
          { id: "unable", label: "Painful inability to void" }, { id: "palpable", label: "Palpable / percussible bladder" },
          { id: "boo", label: "Known BPH / bladder outlet obstruction" }, { id: "meds", label: "Precipitant (constipation / drugs / post-op / UTI)" },
          { id: "infection", label: "Fever / dysuria (associated UTI)" }
        ],
        danger: [
          { id: "neuro", label: "Saddle anaesthesia / bilateral leg symptoms / back pain (cauda equina?)" },
          { id: "aki", label: "High-pressure retention with AKI / hydronephrosis" }
        ],
        assess: function (sel) {
          if (has(sel, "neuro")) return { emergency: true, ladder: 5, catg: "⚠ Retention with possible cauda equina syndrome",
            sc: "Immediate bladder decompression (catheterise) AND urgent MRI whole spine - a neurosurgical emergency in parallel.", ref: "Emergency Neurosurgery / Spinal + Urology now.", mgmt: ["Retention with saddle anaesthesia or bilateral neurology is cauda equina until proven otherwise - do not just catheterise and discharge.", "Catheterisation relieves the bladder but does not treat the cause."] };
          if (has(sel, "aki")) return { emergency: false, ladder: 4, catg: "High-pressure retention with AKI",
            sc: "Immediate catheterisation is the treatment; monitor for post-obstructive diuresis; admit for renal function + fluid balance.", ref: "Urology; admit for monitoring.", mgmt: ["Watch for large post-obstructive diuresis - replace fluids and monitor electrolytes.", "Antibiotics only if concurrent infection - otherwise not indicated."] };
          return { emergency: false, ladder: 4, catg: "Acute urinary retention",
            sc: "Immediate urethral (or suprapubic) catheterisation to decompress the bladder IS the treatment; record residual volume.", ref: "Urology follow-up / TWOC planning; admit if unwell or renal impairment.", mgmt: ["Catheterisation relieves the retention - antibiotics are NOT routine and only added if there is an associated symptomatic UTI (per local urinary guidance).", "Find and treat the precipitant (constipation, drugs, UTI, post-op, BPH); plan trial without catheter / medical therapy.", "Beware post-obstructive diuresis after decompression.", "Clot retention (frank haematuria + clots) needs a 3-way catheter + washout - see the haematuria pathway."] };
        }
      },
      /* ───────── Testicular torsion (standalone surgical emergency) ───────── */
      {
        id: "testicular_torsion", name: "Testicular torsion",
        q: [
          { id: "sudden", label: "Sudden severe scrotal / lower-abdominal pain" }, { id: "young", label: "Child / adolescent / young man" },
          { id: "vomiting", label: "Nausea / vomiting with the pain" }, { id: "highriding", label: "High-riding / horizontal testis, swollen" },
          { id: "nocremaster", label: "Absent cremasteric reflex" }, { id: "noprehn", label: "No relief on elevation (Prehn negative)" }
        ],
        danger: [{ id: "any", label: "Any acute scrotum in a young male = torsion until proven otherwise" }],
        assess: function () {
          return { emergency: true, ladder: 5, catg: "⚠ Testicular torsion - theatre within ~6 h",
            sc: "IMMEDIATE scrotal exploration & detorsion with bilateral orchidopexy - the testis salvage rate falls sharply after ~6 h. Do NOT wait for an ultrasound or a trial of antibiotics; a normal Doppler does NOT exclude torsion.",
            ref: "Emergency Urology / Surgery NOW; alert theatre and anaesthesia.",
            mgmt: ["ANY painful scrotum in a young male is torsion until proven otherwise - clinical suspicion alone mandates exploration; imaging must never delay theatre.", "Antibiotics have NO role - the treatment is surgery. Keep the patient nil by mouth.", "Manual detorsion may be attempted while arranging theatre but is not a substitute for surgery.", "Consider torsion of a testicular appendage (blue-dot sign) as a differential, but explore if any doubt."] };
        }
      },
      /* ───────── Epididymo-orchitis (torsion must be excluded first) ───────── */
      {
        id: "epididymo_orchitis", name: "Epididymo-orchitis",
        q: [
          { id: "gradual", label: "Gradual-onset scrotal pain / swelling" }, { id: "dysuria", label: "Dysuria / urethral discharge / recent UTI" },
          { id: "relief", label: "Relief on elevation (Prehn +ve), cremasteric reflex present" }, { id: "fever", label: "Fever / systemic upset" },
          { id: "young", label: "Sexually active / younger adult" }, { id: "older", label: "Older / catheter / instrumentation" }
        ],
        danger: [
          { id: "torsion", label: "Sudden severe pain, high-riding testis / absent cremasteric reflex (TORSION)" },
          { id: "abscess", label: "Fluctuant scrotal abscess / necrosis / severe sepsis / crepitus" }
        ],
        assess: function (sel) {
          if (has(sel, "torsion")) return { emergency: true, ladder: 5, catg: "⚠ This is torsion, NOT epididymo-orchitis - surgical emergency",
            sc: "IMMEDIATE scrotal exploration & detorsion - do NOT delay for imaging or antibiotics. Reassess on the testicular torsion pathway.", ref: "Emergency Urology / Surgery NOW.", mgmt: ["Sudden severe pain with a high-riding testis / absent cremasteric reflex is torsion - time-critical surgery, not infection.", "Antibiotics have NO role here."] };
          if (has(sel, "abscess")) return { emergency: true, ladder: 4, catg: "Epididymo-orchitis with abscess / severe infection",
            sc: "Scrotal ultrasound; drainage of abscess ± exploration; if crepitus / necrosis / toxicity, treat as Fournier's - immediate debridement.", ref: "Urgent Urology; admit.", mgmt: ["IV antibiotic per local antibiogram/ICMR after cultures, as an adjunct to drainage.", "A necrotising, crepitant or toxic scrotum is Fournier's - escalate to the surgical-emergency pathway."],
            abx: { firstLine: [{ drug: "Ceftriaxone", dose: "1-2 g", route: "IV once daily" }, { drug: "+ Amikacin", dose: "15 mg/kg", route: "IV once daily", note: "for severe infection; monitor renal function" }], alt: [{ drug: "Piperacillin-tazobactam", dose: "4.5 g", route: "IV q6-8h", note: "broader cover / if ESBL risk consider meropenem 1 g IV q8h" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Antibiotics are an ADJUNCT to drainage/exploration; if crepitus/necrosis/toxicity, treat as Fournier's." } };
          if (anyOf(sel, ["gradual", "dysuria", "relief", "fever", "young", "older"])) return { emergency: false, ladder: 2, catg: "Epididymo-orchitis - torsion excluded",
            sc: "Scrotal support, analgesia; ultrasound if diagnosis uncertain (never let imaging delay treating suspected torsion).", ref: "Urology / GUM as appropriate; review at 48-72 h.", mgmt: ["Oral antibiotic per AGE-APPROPRIATE local guidance - likely-STI vs enteric-organism cover differs by age/risk; send urine ± urethral/STI testing first, treat partners if STI-related.", "Admit / IV if systemically unwell or unable to tolerate oral.", "ALWAYS reconsider torsion if pain is severe and sudden - when in doubt, explore."],
            abx: { firstLine: [{ drug: "Ceftriaxone", dose: "500 mg", route: "IM single dose", note: "younger / sexually active - likely STI (gonorrhoea)" }, { drug: "+ Doxycycline", dose: "100 mg", route: "PO BID", note: "10-14 days - covers Chlamydia; treat partners" }], alt: [{ drug: "Ofloxacin", dose: "200 mg", route: "PO BID", note: "older / enteric-organism (coliform) risk - 10-14 days; only if local FQ susceptibility acceptable" }, { drug: "Co-trimoxazole", dose: "160/800 mg", route: "PO BID", note: "enteric-cover alternative; culture-guided" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Choose by age/risk: sexually active → STI cover (ceftriaxone + doxycycline); older/instrumented → enteric Gram-negative cover; send urine ± urethral/STI testing first." } };
          return { emergency: false, ladder: 0, catg: "Scrotal pain - characterise and EXCLUDE TORSION first",
            sc: "Assess onset, cremasteric reflex, testicular lie; urgent exploration if torsion possible - do NOT wait for a scan.", ref: "Urgent Urology if any torsion features.", mgmt: ["The single most important step in acute scrotal pain is to exclude testicular torsion before diagnosing infection.", "No antibiotics until an infective picture is confirmed and torsion excluded."] };
        }
      },
      /* ───────── Paraphimosis (foreskin trapped - emergency reduction) ───────── */
      {
        id: "paraphimosis", name: "Paraphimosis",
        q: [
          { id: "retracted", label: "Retracted foreskin stuck behind glans, can't reduce" }, { id: "swelling", label: "Oedematous, painful glans / foreskin" },
          { id: "catheter", label: "Recent catheter / examination (foreskin left retracted)" }, { id: "duration", label: "Prolonged (hours) / worsening swelling" }
        ],
        danger: [{ id: "ischaemia", label: "Dusky / dark / blistered glans (ischaemia)" }],
        assess: function (sel) {
          if (has(sel, "ischaemia")) return { emergency: true, ladder: 5, catg: "⚠ Paraphimosis with glans ischaemia - emergency",
            sc: "IMMEDIATE reduction; if manual reduction fails, emergency dorsal slit / decompression by Urology to save the glans - do not delay.", ref: "Emergency Urology NOW.", mgmt: ["A dusky glans is threatened tissue - this is time-critical, treat pain and reduce at once.", "Antibiotics are not the treatment; reduction / decompression is."] };
          return { emergency: true, ladder: 4, catg: "Paraphimosis - reduce urgently",
            sc: "Prompt MANUAL REDUCTION with analgesia/local block: sustained compression to squeeze out oedema, then push the glans back through the ring. If it fails, urgent Urology for dorsal slit.", ref: "Urgent Urology if manual reduction fails.", mgmt: ["Reduce as soon as possible - the constricting ring causes progressive oedema and can threaten the glans.", "ALWAYS reduce a retracted foreskin after catheterisation or examination - leaving it retracted is the commonest cause.", "Antibiotics NOT routinely needed."] };
        }
      },
      /* ───────── Priapism (persistent erection - emergency) ───────── */
      {
        id: "priapism", name: "Priapism",
        q: [
          { id: "prolonged", label: "Painful erection > 4 h, unrelated to arousal" }, { id: "rigid", label: "Rigid tender corpora, soft glans (ischaemic)" },
          { id: "sickle", label: "Sickle cell / haematological cause" }, { id: "drugs", label: "Intracavernosal / erectile-dysfunction drugs / recreational drugs" },
          { id: "trauma", label: "Perineal / genital trauma (possible non-ischaemic)" }
        ],
        danger: [{ id: "low_flow", label: "Ischaemic (low-flow): painful, rigid > 4 h - a compartment emergency" }],
        assess: function (sel) {
          if (has(sel, "trauma") && !anyOf(sel, ["low_flow", "rigid", "prolonged"])) return { emergency: false, ladder: 3, catg: "Possible non-ischaemic (high-flow) priapism",
            sc: "Not usually a surgical emergency - Doppler / blood gas to distinguish; managed by Urology (observation ± selective embolisation).", ref: "Urgent Urology; imaging to characterise.", mgmt: ["High-flow priapism (post-traumatic, non-painful) differs from ischaemic - do not aspirate blindly.", "Antibiotics NOT indicated."] };
          return { emergency: true, ladder: 4, catg: "⚠ Ischaemic (low-flow) priapism - emergency detumescence",
            sc: "TIME-CRITICAL: corporal aspiration ± irrigation and intracavernosal sympathomimetic; if it fails, surgical shunt. Ischaemia > ~4 h risks permanent erectile dysfunction - treat as a compartment emergency.", ref: "Emergency Urology NOW; Haematology if sickle cell.", mgmt: ["A rigid painful erection > 4 h is ischaemic priapism until proven otherwise - do not simply reassure.", "Treat the cause (sickle cell crisis, drugs) in parallel - Haematology co-management for sickle disease.", "Antibiotics NOT the treatment; detumescence is. Confirm ischaemia with cavernosal blood gas if available but do not delay."] };
        }
      },
      /* ───────── Gross haematuria / clot retention ───────── */
      {
        id: "gross_haematuria", name: "Gross haematuria / clot retention",
        q: [
          { id: "visible", label: "Frank (visible) haematuria" }, { id: "clots", label: "Passing clots" },
          { id: "retention", label: "Unable to void / painful distended bladder (clot retention)" }, { id: "anticoag", label: "On anticoagulant / antiplatelet" },
          { id: "painless", label: "Painless haematuria (?malignancy)" }, { id: "recent_uro", label: "Recent instrumentation / catheter / TURP" }
        ],
        danger: [
          { id: "unstable", label: "Haemodynamic instability / large-volume bleed / falling Hb" },
          { id: "sepsis", label: "Fever / sepsis (infected clot retention)" }
        ],
        assess: function (sel) {
          if (has(sel, "unstable")) return { emergency: true, ladder: 4, catg: "⚠ Heavy haematuria with instability - resuscitate + control bleeding",
            sc: "Resuscitate (IV access, group & save/crossmatch, correct coagulopathy); large-bore 3-way catheter with bladder washout + continuous irrigation; theatre/cystoscopy if bleeding uncontrolled.", ref: "Urgent Urology now; admit.", mgmt: ["This is bleeding control, NOT an antibiotic problem - evacuate clot and irrigate.", "Reverse/hold anticoagulation per protocol; transfuse as needed."] };
          if (anyOf(sel, ["clots", "retention"])) return { emergency: false, ladder: 4, catg: "Clot retention",
            sc: "Large-bore (3-way) catheter with manual bladder WASHOUT to evacuate clots, then continuous irrigation to keep the bladder clear; investigate the haematuria source.", ref: "Urology; admit if heavy or ongoing.", mgmt: ["Source control (washout + irrigation), NOT antibiotics, is the priority - a small standard catheter will just block.", "Antibiotics only if associated infection (per local urinary guidance).", "Review anticoagulants/antiplatelets and clotting."] };
          if (has(sel, "sepsis")) return { emergency: true, ladder: 4, catg: "Clot retention with infection",
            sc: "Catheter washout / irrigation for source control; exclude obstructed infected system.", ref: "Urgent Urology; IM/ICU if septic.", mgmt: ["Relieve obstruction/clot AND cover infection - IV antibiotic per local antibiogram/ICMR after cultures.", "Do not treat as simple UTI while the bladder is obstructed by clot."],
            abx: { firstLine: [{ drug: "Piperacillin-tazobactam", dose: "4.5 g", route: "IV q6-8h" }], alt: [{ drug: "Meropenem", dose: "1 g", route: "IV q8h", note: "if ESBL risk / prior ESBL / recent hospitalisation" }, { drug: "+ Amikacin", dose: "15 mg/kg", route: "IV once daily", note: "add for severe sepsis; monitor renal function" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Antibiotics only because infection accompanies the clot retention - source control (washout/irrigation) and excluding an obstructed infected system come first." } };
          return { emergency: false, ladder: 0, catg: "Visible haematuria - investigate (no antibiotics)",
            sc: "No procedure if voiding freely; catheter/washout only if clot retention develops.", ref: "Urgent haematuria clinic (flexible cystoscopy + upper-tract imaging) - do NOT dismiss painless visible haematuria.", mgmt: ["Painless visible haematuria is urological cancer until proven otherwise - refer for cystoscopy + imaging.", "Antibiotics are NOT a treatment for haematuria - only treat a proven concurrent UTI; do not attribute cancerous bleeding to 'a UTI'.", "Anticoagulation does not excuse investigation - it may unmask an underlying lesion."] };
        }
      },
      /* ───────── Fournier's gangrene (necrotising surgical emergency) ───────── */
      {
        id: "fournier_gangrene", name: "Fournier's gangrene",
        q: [
          { id: "pain_oop", label: "Perineal / scrotal pain out of proportion to signs" }, { id: "crepitus", label: "Crepitus / gas in tissues" },
          { id: "necrosis", label: "Skin necrosis / dusky / bullae / foul discharge" }, { id: "diabetes", label: "Diabetes / immunocompromise" },
          { id: "systemic", label: "Systemic toxicity / sepsis" }
        ],
        danger: [{ id: "any", label: "Any of the above in a toxic patient = necrotising surgical emergency" }],
        assess: function () {
          return { emergency: true, ladder: 5, catg: "⚠ Fournier's gangrene - necrotising surgical emergency",
            sc: "IMMEDIATE wide surgical debridement of all necrotic tissue - do NOT delay for imaging; repeated debridements are usually required.",
            ref: "Emergency Urology + General Surgery + critical care NOW; IM/ICU co-management for sepsis resuscitation.",
            mgmt: ["Aggressive resuscitation; broad-spectrum IV antibiotics with anaerobic + Gram-negative + Gram-positive cover (± toxin-suppressing agent) per local protocol/ICMR - as an ADJUNCT to debridement, never a substitute.", "Antibiotics do not reach dead tissue - surgery is the definitive treatment; the diagnosis is clinical, do not delay theatre for a scan.", "ICU-level support; IM/ICU co-management for sepsis resuscitation; antibiotic choice per ICMR/local."],
            abx: { firstLine: [{ drug: "Piperacillin-tazobactam", dose: "4.5 g", route: "IV q6-8h" }, { drug: "+ Clindamycin", dose: "900 mg", route: "IV q8h", note: "anti-toxin / anti-exotoxin effect" }, { drug: "± Vancomycin", dose: "15-20 mg/kg", route: "IV q8-12h", note: "add for MRSA cover in severe sepsis" }], alt: [{ drug: "Meropenem", dose: "1 g", route: "IV q8h", note: "if ESBL risk / prior resistant organism - plus clindamycin" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Broad Gram-positive + Gram-negative + anaerobe cover with a toxin-suppressing agent, as an ADJUNCT to IMMEDIATE wide surgical debridement - antibiotics do not reach dead tissue." } };
        }
      },
      /* ───────────────────── Acute bacterial prostatitis ───────────────────── */
      {
        id: "acute_prostatitis", name: "Acute prostatitis",
        q: [
          { id: "pelvic", label: "Perineal / pelvic / low back pain" }, { id: "luts", label: "LUTS - dysuria / frequency / poor stream" },
          { id: "fever", label: "Fever / rigors / systemic upset" }, { id: "tender", label: "Exquisitely tender prostate on DRE" },
          { id: "recent", label: "Recent catheter / biopsy / instrumentation" }
        ],
        danger: [
          { id: "retention", label: "Acute urinary retention" }, { id: "abscess", label: "No response / swinging fever (prostatic abscess?)" },
          { id: "sepsis", label: "Sepsis / haemodynamic instability" }
        ],
        assess: function (sel) {
          if (has(sel, "sepsis")) return { emergency: true, ladder: 3, catg: "Acute prostatitis with sepsis - admit",
            sc: "Image (CT / transrectal USS) to exclude prostatic abscess needing drainage; suprapubic catheter preferred if retention (avoid transurethral through an infected prostate).", ref: "Admit; Urology; IM/ICU co-management for sepsis resuscitation.", mgmt: ["IV broad-spectrum antibiotic per local antibiogram/ICMR after cultures; prolonged course needed for prostatic penetration.", "IM/ICU co-management for sepsis resuscitation; antibiotic choice per ICMR/local."],
            abx: { firstLine: [{ drug: "Piperacillin-tazobactam", dose: "4.5 g", route: "IV q6-8h" }], alt: [{ drug: "Ceftriaxone", dose: "1-2 g", route: "IV once daily", note: "± amikacin 15 mg/kg IV once daily for severe sepsis" }, { drug: "Meropenem", dose: "1 g", route: "IV q8h", note: "if ESBL risk / prior resistant organism" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Prolonged course (2-4 weeks) for prostatic penetration; step down to an oral agent with good prostate penetration; exclude prostatic abscess." } };
          if (has(sel, "retention")) return { emergency: false, ladder: 4, catg: "Acute prostatitis with retention",
            sc: "Bladder decompression - a SUPRAPUBIC catheter is preferred (avoid passing a urethral catheter through an acutely infected/inflamed prostate).", ref: "Urgent Urology; admit.", mgmt: ["Relieve retention (suprapubic route) and give antibiotic per local urinary guidance after cultures - prolonged course.", "Reassess for prostatic abscess if not improving."],
            abx: { firstLine: [{ drug: "Ceftriaxone", dose: "1-2 g", route: "IV once daily", note: "initial parenteral therapy" }], alt: [{ drug: "Ciprofloxacin", dose: "500 mg", route: "PO BID", note: "excellent prostate penetration - only if local FQ susceptibility acceptable / culture-confirmed" }, { drug: "Co-trimoxazole", dose: "160/800 mg", route: "PO BID", note: "good prostate penetration; culture-guided" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Relieve retention via a SUPRAPUBIC catheter; prolonged course (2-4 weeks) for prostatic penetration." } };
          if (has(sel, "abscess")) return { emergency: false, ladder: 4, catg: "Suspected prostatic abscess",
            sc: "Transrectal USS / CT; drainage of the abscess (transrectal / transperineal) is the source control.", ref: "Urology.", mgmt: ["Antibiotic per local antibiogram/ICMR as adjunct to drainage; de-escalate on culture."],
            abx: { firstLine: [{ drug: "Piperacillin-tazobactam", dose: "4.5 g", route: "IV q6-8h", note: "as adjunct to drainage" }], alt: [{ drug: "Ceftriaxone", dose: "1-2 g", route: "IV once daily" }, { drug: "Meropenem", dose: "1 g", route: "IV q8h", note: "if ESBL risk" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Antibiotics are an ADJUNCT to drainage of the abscess; de-escalate on culture; prolonged course." } };
          if (anyOf(sel, ["pelvic", "luts", "fever", "tender", "recent"])) return { emergency: false, ladder: 2, catg: "Acute bacterial prostatitis - systemically well",
            sc: "No procedure; watch for retention (needing decompression) and abscess (needing drainage).", ref: "Urology follow-up; admit if septic, retaining or not improving.", mgmt: ["Oral antibiotic per local urinary guidance after culture - a PROLONGED course is needed for prostatic penetration; defer agent/duration to stewardship / Drug Index / local protocol.", "Analgesia, fluids; avoid vigorous prostatic massage.", "Safety-net for retention, swinging fever or systemic deterioration."],
            abx: { firstLine: [{ drug: "Ciprofloxacin", dose: "500 mg", route: "PO BID", note: "good prostate penetration - 2-4 weeks; only if local FQ susceptibility acceptable / culture-confirmed" }, { drug: "Co-trimoxazole", dose: "160/800 mg", route: "PO BID", note: "good prostate penetration - 2-4 weeks; culture-guided" }], alt: [{ drug: "Levofloxacin", dose: "500 mg", route: "PO once daily", note: "alternative fluoroquinolone; susceptibility-dependent" }, { drug: "Cefixime", dose: "200 mg", route: "PO BID", note: "if fluoroquinolone unsuitable - longer course, poorer prostate penetration" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Prolonged course (2-4 weeks) for prostatic penetration; send culture first; fluoroquinolones remain preferred for penetration but confirm local susceptibility; watch for retention/abscess." } };
          return { emergency: false, ladder: 0, catg: "Prostatic symptoms - characterise",
            sc: "No procedure.", ref: "Reassess; Urology if recurrent or chronic.", mgmt: ["Send culture before antibiotics; distinguish acute bacterial prostatitis from chronic/non-bacterial pelvic pain (different management).", "No blind antibiotics without an infective picture."] };
        }
      },
      /* ───────── Catheter-associated UTI (CAUTI) ───────── */
      {
        id: "cauti", name: "Catheter-associated UTI",
        q: [
          { id: "catheter", label: "Indwelling / recent urinary catheter" }, { id: "symptomatic", label: "New fever, suprapubic/flank pain, rigors or systemic upset" },
          { id: "bacteriuria", label: "Positive culture but NO symptoms (asymptomatic)" }, { id: "longterm", label: "Long-term / blocked / encrusted catheter" },
          { id: "immuno", label: "Diabetes / immunocompromise" }
        ],
        danger: [
          { id: "sepsis", label: "Sepsis / hypotension / altered sensorium" },
          { id: "obstruction", label: "Blocked catheter / obstruction with fever (obstructed infected system?)" }
        ],
        assess: function (sel) {
          if (has(sel, "obstruction")) return { emergency: true, ladder: 4, catg: "Blocked catheter with infection - relieve obstruction",
            sc: "Source control = unblock / CHANGE the catheter immediately (relieves obstruction and removes the infected biofilm); image if upper-tract obstruction suspected.", ref: "Urgent Urology if not resolved by catheter change; IM/ICU co-management if septic.", mgmt: ["A blocked catheter with fever is an obstructed infected system - decompress first.", "IV/oral antibiotic per local urinary guidance after cultures, guided by severity."],
            abx: { firstLine: [{ drug: "Piperacillin-tazobactam", dose: "4.5 g", route: "IV q6-8h", note: "if systemically unwell" }, { drug: "Cefuroxime", dose: "500 mg", route: "PO BID", note: "if mild/stable after catheter change" }], alt: [{ drug: "Meropenem", dose: "1 g", route: "IV q8h", note: "if ESBL risk / prior resistant organism" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Source control first - unblock/CHANGE the catheter; choose route by severity; culture from a freshly placed catheter." } };
          if (has(sel, "sepsis")) return { emergency: true, ladder: 3, catg: "Catheter-associated UTI with sepsis - admit",
            sc: "REMOVE or change the catheter (source control) before / with starting antibiotics - an old catheter is an infected foreign body; exclude obstruction.", ref: "Admit; Urology if obstruction; IM/ICU co-management for sepsis resuscitation.", mgmt: ["IV broad-spectrum antibiotic per local antibiogram/ICMR after cultures.", "IM/ICU co-management for sepsis resuscitation; antibiotic choice per ICMR/local. Catheter change is integral to clearing the infection."],
            abx: { firstLine: [{ drug: "Piperacillin-tazobactam", dose: "4.5 g", route: "IV q6-8h" }], alt: [{ drug: "Meropenem", dose: "1 g", route: "IV q8h", note: "if ESBL risk / prior ESBL / recent hospitalisation" }, { drug: "+ Amikacin", dose: "15 mg/kg", route: "IV once daily", note: "add for severe sepsis; monitor renal function" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. REMOVE/change the catheter (infected foreign body) with antibiotic start; exclude obstruction." } };
          if (has(sel, "symptomatic")) return { emergency: false, ladder: 2, catg: "Symptomatic CAUTI",
            sc: "Source control = remove the catheter if no longer needed, or CHANGE it before treating (replace the colonised device).", ref: "Review; Urology if recurrent or structural cause.", mgmt: ["Treat only because there are SYMPTOMS - send culture from a freshly placed catheter, then antibiotic per local urinary guidance.", "Reassess ongoing need for catheterisation; shortest effective course."],
            abx: { firstLine: [{ drug: "Cefuroxime", dose: "500 mg", route: "PO BID", note: "7 days" }, { drug: "Cefixime", dose: "200 mg", route: "PO BID", note: "7 days" }], alt: [{ drug: "Amikacin", dose: "15 mg/kg", route: "IV once daily", note: "if resistant organism / cannot tolerate oral; monitor renal function" }, { drug: "Nitrofurantoin", dose: "100 mg", route: "PO BID", note: "ONLY for catheter-associated cystitis without upper-tract/systemic features" }], ref: "ICMR AMRSN 2024 / Sanford", note: "Empiric - adjust to local antibiogram/ICMR (high E. coli resistance), cultures, renal function & allergy. Treat only because SYMPTOMATIC; remove/CHANGE the catheter first and culture from a fresh catheter; shortest effective course (7 d)." } };
          if (has(sel, "bacteriuria")) return { emergency: false, ladder: 0, catg: "Asymptomatic bacteriuria in a catheterised patient - do NOT treat",
            sc: "No antibiotics; source control if catheter no longer needed (remove) - do not screen or treat asymptomatic bacteriuria.", ref: "No referral for bacteriuria alone.", mgmt: ["Every long-term catheter is colonised - treating asymptomatic bacteriuria drives resistance and does NOT help the patient (exception: pregnancy or before urological instrumentation).", "Reassess whether the catheter is still needed and remove if possible."] };
          return { emergency: false, ladder: 0, catg: "Catheter present - assess for symptoms",
            sc: "Review need for the catheter and remove if possible (source control).", ref: "Review if new fever or systemic features develop.", mgmt: ["Do not treat a positive culture without symptoms.", "Antibiotics only for a symptomatic, catheter-associated infection."] };
        }
      }
    ]
  };

  window.SMD_WS_ENGINES = window.SMD_WS_ENGINES || {};
  window.SMD_WS_ENGINES.urology = UROLOGY;
})();
