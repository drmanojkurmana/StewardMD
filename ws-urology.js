/* StewardMD — Urology specialty engine (data + deterministic management logic).
   ---------------------------------------------------------------------------
   Registers into window.SMD_WS_ENGINES.urology, consumed by workspaces.js. A
   LIGHTWEIGHT specialty pathway — NOT the Internal Medicine engine and NOT a
   diagnosis generator. For each syndrome it collects focused findings + danger
   signs and returns a conservative MANAGEMENT DECISION: the antibiotic-need
   level (0 none → 5 emergency referral), whether SOURCE CONTROL / a procedure
   (decompression, drainage, catheter, debridement) is required, and the
   referral/escalation. Actual drug choice is deferred to the existing
   stewardship engine / Drug Index / local antibiogram + ICMR (never prescribed here).

   The recurring urology theme is SOURCE CONTROL: most true emergencies are not
   solved by antibiotics but by relieving obstruction or draining pus — the
   obstructed infected kidney (urgent decompression), acute retention (immediate
   catheterisation), testicular torsion masquerading as epididymo-orchitis
   (surgical exploration) and Fournier's gangrene (immediate debridement). The
   engine's job is to separate the uncomplicated, self-limiting lower UTI from
   these time-critical presentations. Urology OWNS these conditions (source
   control is the point), so they are NOT flagged shared:true; where sepsis needs
   medical/ICU co-management the notes say so explicitly.

   Advisory only. Verify against local protocol, imaging, and the individual patient. */
(function () {
  "use strict";
  // ladder index → matches ABX/management ladder in workspaces.js
  // 0 none · 1 topical/local · 2 oral · 3 IV/admission · 4 urgent decompression/drainage/catheter (source control) · 5 emergency referral
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
          { id: "flank_fever", label: "Flank pain / fever / rigors (upper tract — not simple cystitis)" },
          { id: "sepsis", label: "Systemic sepsis / haemodynamic instability" }
        ],
        assess: function (sel) {
          if (has(sel, "sepsis")) return { emergency: true, ladder: 3, catg: "UTI with systemic sepsis — admit, exclude obstruction",
            sc: "Urgent imaging (USS/CT KUB) to exclude an obstructed infected system needing decompression; catheterise / monitor output.", ref: "Admit; IM/ICU co-management for sepsis resuscitation; urgent Urology if obstruction.", mgmt: ["IV broad-spectrum antibiotic per local antibiogram/ICMR after cultures — do not manage as simple cystitis.", "IM/ICU co-management for sepsis resuscitation; antibiotic choice per ICMR/local."] };
          if (has(sel, "flank_fever")) return { emergency: false, ladder: 3, catg: "Features of upper-tract infection — reassess as pyelonephritis",
            sc: "No lower-tract procedure — image if obstruction / stone suspected.", ref: "Reassess on the pyelonephritis pathway; admit if unwell.", mgmt: ["Flank pain + fever is NOT uncomplicated cystitis — escalate assessment.", "Antibiotic per local urinary guidance once tract level established."] };
          if (has(sel, "catheter")) return { emergency: false, ladder: 2, catg: "Catheter-related lower UTI — reassess as CAUTI",
            sc: "Source control = remove / change the catheter; treat only if symptomatic.", ref: "Reassess on the CAUTI pathway.", mgmt: ["Do NOT treat asymptomatic bacteriuria in a catheterised patient.", "Antibiotic per local urinary guidance only if symptomatic."] };
          if (anyOf(sel, ["male", "pregnant", "recurrent", "immuno"])) return { emergency: false, ladder: 2, catg: "Complicated lower UTI (male / pregnancy / structural / immunocompromise)",
            sc: "No procedure; image / Urology referral if recurrent, stone or structural abnormality.", ref: "GP/Urology follow-up; low threshold for review in pregnancy or immunocompromise.", mgmt: ["Send urine culture BEFORE starting antibiotics; oral antibiotic per local urinary guidance — often a longer course than uncomplicated cystitis.", "In pregnancy avoid agents contraindicated by trimester — choose per local guidance; treat even asymptomatic bacteriuria in pregnancy.", "Investigate the complicating factor (imaging / Urology for recurrent, stone or structural cause)."] };
          if (anyOf(sel, ["dysuria", "suprapubic"])) return { emergency: false, ladder: 2, catg: "Uncomplicated cystitis (non-pregnant woman)",
            sc: "No procedure.", ref: "Safety-net; review if flank pain, fever or rigors develop (upper-tract spread).", mgmt: ["Short oral course per local urinary guidance is first-line — defer the agent/duration to stewardship / Drug Index / local protocol.", "Encourage fluids + analgesia; culture not routinely needed if typical and uncomplicated.", "Return if symptoms escalate to flank pain / fever / systemic upset."] };
          return { emergency: false, ladder: 0, catg: "No clear UTI features — reassess",
            sc: "No procedure.", ref: "Safety-net; culture if diagnosis unclear.", mgmt: ["Antibiotics NOT indicated without symptoms — do not treat asymptomatic bacteriuria (except pregnancy).", "Consider alternative causes of lower urinary symptoms."] };
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
          if (has(sel, "obstruction")) return { emergency: true, ladder: 5, catg: "Pyelonephritis with possible obstruction — exclude obstructed infected kidney",
            sc: "URGENT imaging (CT KUB / USS); if obstructed & infected, decompression (nephrostomy or ureteric stent) is the definitive source control and cannot wait.", ref: "Emergency Urology now; IM/ICU co-management for sepsis resuscitation.", mgmt: ["An obstructed, infected kidney is a urological emergency — antibiotics alone will not save the kidney or the patient.", "IV broad-spectrum antibiotic per local antibiogram/ICMR after cultures; antibiotic choice per ICMR/local."] };
          if (anyOf(sel, ["sepsis", "nausea"]) || (has(sel, "fever") && anyOf(sel, ["pregnant", "comorbid"]))) return { emergency: has(sel, "sepsis"), ladder: 3, catg: "Severe / complicated pyelonephritis — admit for IV therapy",
            sc: "Image to exclude obstruction / abscess; decompression if an obstructed infected system is found.", ref: "Admit; Urology if obstruction / no response; IM/ICU co-management if septic.", mgmt: ["IV broad-spectrum antibiotic per local antibiogram/ICMR after blood + urine cultures; step down to oral on improvement.", "Low admission threshold in pregnancy, diabetes, immunocompromise or the elderly.", "If septic: IM/ICU co-management for sepsis resuscitation; antibiotic choice per ICMR/local."] };
          if (has(sel, "flank") && has(sel, "fever")) return { emergency: false, ladder: 2, catg: "Uncomplicated pyelonephritis — systemically well",
            sc: "No procedure; image only if not improving at 48–72 h or obstruction suspected.", ref: "Review at 48–72 h; escalate / admit if worsening or vomiting.", mgmt: ["Oral antibiotic per local urinary guidance if tolerating oral and haemodynamically stable — send culture first.", "Safety-net: return for rigors, vomiting, or increasing pain (may need IV / imaging)."] };
          return { emergency: false, ladder: 2, catg: "Suspected pyelonephritis — confirm features",
            sc: "No procedure.", ref: "Reassess; admit if systemic features develop.", mgmt: ["Send urine culture before antibiotics; treat per local urinary guidance based on severity.", "Reassess tract level and complicating factors."] };
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
          return { emergency: true, ladder: 5, catg: "⚠ Obstructed, infected kidney — urological emergency",
            sc: "IMMEDIATE decompression is the definitive source control — emergency nephrostomy or ureteric stent; this CANNOT wait for antibiotics to work. Confirm with urgent CT KUB / USS but do not delay decompression in a septic obstructed patient.",
            ref: "Emergency Urology + Interventional Radiology NOW; IM/ICU co-management for sepsis resuscitation.",
            mgmt: ["Pus under pressure above an obstruction is like an undrained abscess — antibiotics alone will not clear it and the patient can deteriorate rapidly.", "IV broad-spectrum antibiotic per local antibiogram/ICMR after blood + urine cultures — as an ADJUNCT to decompression, not a substitute.", "IM/ICU co-management for sepsis resuscitation; antibiotic choice per ICMR/local. Definitive stone treatment is deferred until infection is controlled."] };
        }
      },
      /* ───────────────────── Acute urinary retention ───────────────────── */
      {
        id: "acute_urinary_retention", name: "Acute urinary retention",
        q: [
          { id: "unable", label: "Painful inability to void" }, { id: "palpable", label: "Palpable / percussible bladder" },
          { id: "boo", label: "Known BPH / bladder outlet obstruction" }, { id: "meds", label: "Precipitant (constipation / drugs / post-op / UTI)" },
          { id: "haematuria", label: "Clot retention / frank haematuria" }, { id: "infection", label: "Fever / dysuria (associated UTI)" }
        ],
        danger: [
          { id: "neuro", label: "Saddle anaesthesia / bilateral leg symptoms / back pain (cauda equina?)" },
          { id: "aki", label: "High-pressure retention with AKI / hydronephrosis" }
        ],
        assess: function (sel) {
          if (has(sel, "neuro")) return { emergency: true, ladder: 5, catg: "Retention with possible cauda equina syndrome",
            sc: "Immediate bladder decompression (catheterise) AND urgent MRI whole spine — a neurosurgical emergency in parallel.", ref: "Emergency Neurosurgery / Spinal + Urology now.", mgmt: ["Retention with saddle anaesthesia or bilateral neurology is cauda equina until proven otherwise — do not just catheterise and discharge.", "Catheterisation relieves the bladder but does not treat the cause."] };
          if (has(sel, "aki")) return { emergency: false, ladder: 4, catg: "High-pressure chronic retention with AKI",
            sc: "Immediate catheterisation is the treatment; monitor for post-obstructive diuresis; admit for renal function + fluid balance.", ref: "Urology; admit for monitoring.", mgmt: ["Watch for large post-obstructive diuresis — replace fluids and monitor electrolytes.", "Antibiotics only if concurrent infection — otherwise not indicated."] };
          if (has(sel, "haematuria")) return { emergency: false, ladder: 4, catg: "Clot retention",
            sc: "Large-bore / 3-way catheter with bladder washout and irrigation is the treatment; investigate the haematuria source.", ref: "Urology.", mgmt: ["Source control (washout / irrigation), not antibiotics, is the priority.", "Antibiotics only if associated infection; investigate cause of haematuria."] };
          return { emergency: false, ladder: 4, catg: "Acute urinary retention",
            sc: "Immediate urethral (or suprapubic) catheterisation to decompress the bladder IS the treatment; record residual volume.", ref: "Urology follow-up / TWOC planning; admit if unwell or renal impairment.", mgmt: ["Catheterisation relieves the retention — antibiotics are NOT routine and only added if there is an associated symptomatic UTI (per local urinary guidance).", "Find and treat the precipitant (constipation, drugs, UTI, post-op, BPH); plan trial without catheter / medical therapy.", "Beware post-obstructive diuresis after decompression."] };
        }
      },
      /* ───────── Epididymo-orchitis (MUST exclude torsion) ───────── */
      {
        id: "epididymo_orchitis", name: "Epididymo-orchitis",
        q: [
          { id: "gradual", label: "Gradual-onset scrotal pain / swelling" }, { id: "dysuria", label: "Dysuria / urethral discharge / recent UTI" },
          { id: "relief", label: "Relief on elevation (Prehn +ve) / present cremasteric reflex" }, { id: "fever", label: "Fever / systemic upset" },
          { id: "young", label: "Sexually active / younger adult" }, { id: "older", label: "Older / catheter / instrumentation" }
        ],
        danger: [
          { id: "torsion", label: "Sudden severe pain, young patient, high-riding testis / absent cremasteric reflex (TORSION)" },
          { id: "abscess", label: "Fluctuant scrotal abscess / necrosis / severe sepsis" }
        ],
        assess: function (sel) {
          if (has(sel, "torsion")) return { emergency: true, ladder: 5, catg: "⚠ Suspected testicular torsion — surgical emergency (NOT epididymo-orchitis)",
            sc: "IMMEDIATE scrotal exploration & detorsion — the testis is salvageable only within hours. Do NOT delay for imaging or a trial of antibiotics.", ref: "Emergency Urology / Surgery NOW.", mgmt: ["Sudden severe pain in a young patient with a high-riding testis is torsion until proven otherwise — this is time-critical, not an infection.", "Antibiotics have NO role here — the treatment is surgery."] };
          if (has(sel, "abscess")) return { emergency: true, ladder: 4, catg: "Epididymo-orchitis with abscess / severe infection",
            sc: "Scrotal ultrasound; drainage of abscess ± exploration; exclude Fournier's if necrosis / crepitus.", ref: "Urgent Urology; admit.", mgmt: ["IV antibiotic per local antibiogram/ICMR after cultures, as an adjunct to drainage.", "Watch for progression to Fournier's gangrene."] };
          if (anyOf(sel, ["gradual", "dysuria", "relief", "fever", "young", "older"])) return { emergency: false, ladder: 2, catg: "Epididymo-orchitis — torsion excluded",
            sc: "Scrotal support, analgesia; ultrasound if diagnosis uncertain (never let imaging delay treating suspected torsion).", ref: "Urology / GUM as appropriate; review at 48–72 h.", mgmt: ["Oral antibiotic per AGE-APPROPRIATE local guidance — likely-STI vs enteric-organism cover differs by age/risk; send urine ± urethral/STI testing first, treat partners if STI-related.", "Admit / IV if systemically unwell or unable to tolerate oral.", "ALWAYS reconsider torsion if the pain is severe and sudden — when in doubt, explore."] };
          return { emergency: false, ladder: 0, catg: "Scrotal pain — characterise and EXCLUDE TORSION first",
            sc: "Assess onset, cremasteric reflex, testicular lie; urgent ultrasound / exploration if torsion possible.", ref: "Urgent Urology if any torsion features.", mgmt: ["The single most important step in acute scrotal pain is to exclude testicular torsion before diagnosing infection.", "No antibiotics until an infective picture is confirmed and torsion excluded."] };
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
          return { emergency: true, ladder: 5, catg: "⚠ Fournier's gangrene — necrotising surgical emergency",
            sc: "IMMEDIATE wide surgical debridement of all necrotic tissue — do NOT delay for imaging; repeated debridements are usually required.",
            ref: "Emergency Urology + General Surgery + critical care NOW; IM/ICU co-management for sepsis resuscitation.",
            mgmt: ["Aggressive resuscitation; broad-spectrum IV antibiotics with anaerobic + Gram-negative + Gram-positive cover (± toxin-suppressing agent) per local protocol/ICMR — as an ADJUNCT to debridement, never a substitute.", "Antibiotics do not reach dead tissue — surgery is the definitive treatment.", "ICU-level support; IM/ICU co-management for sepsis resuscitation; antibiotic choice per ICMR/local."] };
        }
      },
      /* ───────────────────── Acute bacterial prostatitis ───────────────────── */
      {
        id: "acute_prostatitis", name: "Acute prostatitis",
        q: [
          { id: "pelvic", label: "Perineal / pelvic / low back pain" }, { id: "luts", label: "LUTS — dysuria / frequency / poor stream" },
          { id: "fever", label: "Fever / rigors / systemic upset" }, { id: "tender", label: "Exquisitely tender prostate on DRE" },
          { id: "recent", label: "Recent catheter / biopsy / instrumentation" }
        ],
        danger: [
          { id: "retention", label: "Acute urinary retention" }, { id: "abscess", label: "No response / swinging fever (prostatic abscess?)" },
          { id: "sepsis", label: "Sepsis / haemodynamic instability" }
        ],
        assess: function (sel) {
          if (has(sel, "sepsis")) return { emergency: true, ladder: 3, catg: "Acute prostatitis with sepsis — admit",
            sc: "Image (CT / transrectal USS) to exclude prostatic abscess needing drainage; suprapubic catheter preferred if retention (avoid transurethral through infected prostate).", ref: "Admit; Urology; IM/ICU co-management for sepsis resuscitation.", mgmt: ["IV broad-spectrum antibiotic per local antibiogram/ICMR after cultures; prolonged course needed for prostatic penetration.", "IM/ICU co-management for sepsis resuscitation; antibiotic choice per ICMR/local."] };
          if (has(sel, "retention")) return { emergency: false, ladder: 4, catg: "Acute prostatitis with retention",
            sc: "Bladder decompression — a SUPRAPUBIC catheter is preferred (avoid passing a urethral catheter through an acutely infected/inflamed prostate).", ref: "Urgent Urology; admit.", mgmt: ["Relieve retention (suprapubic route) and give antibiotic per local urinary guidance after cultures — prolonged course.", "Reassess for prostatic abscess if not improving."] };
          if (has(sel, "abscess")) return { emergency: false, ladder: 4, catg: "Suspected prostatic abscess",
            sc: "Transrectal USS / CT; drainage of the abscess (transrectal / transperineal) is the source control.", ref: "Urology.", mgmt: ["Antibiotic per local antibiogram/ICMR as adjunct to drainage; de-escalate on culture."] };
          if (anyOf(sel, ["pelvic", "luts", "fever", "tender", "recent"])) return { emergency: false, ladder: 2, catg: "Acute bacterial prostatitis — systemically well",
            sc: "No procedure; watch for retention (needing decompression) and abscess (needing drainage).", ref: "Urology follow-up; admit if septic, retaining or not improving.", mgmt: ["Oral antibiotic per local urinary guidance after culture — a PROLONGED course is needed for prostatic penetration; defer agent/duration to stewardship / Drug Index / local protocol.", "Analgesia, fluids; avoid vigorous prostatic massage.", "Safety-net for retention, swinging fever or systemic deterioration."] };
          return { emergency: false, ladder: 0, catg: "Prostatic symptoms — characterise",
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
          if (has(sel, "obstruction")) return { emergency: true, ladder: 4, catg: "Blocked catheter with infection — relieve obstruction",
            sc: "Source control = unblock / CHANGE the catheter immediately (relieves obstruction and removes the infected biofilm); image if upper-tract obstruction suspected.", ref: "Urgent Urology if not resolved by catheter change; IM/ICU co-management if septic.", mgmt: ["A blocked catheter with fever is an obstructed infected system — decompress first.", "IV/oral antibiotic per local urinary guidance after cultures, guided by severity."] };
          if (has(sel, "sepsis")) return { emergency: true, ladder: 3, catg: "Catheter-associated UTI with sepsis — admit",
            sc: "REMOVE or change the catheter (source control) before / with starting antibiotics — an old catheter is an infected foreign body; exclude obstruction.", ref: "Admit; Urology if obstruction; IM/ICU co-management for sepsis resuscitation.", mgmt: ["IV broad-spectrum antibiotic per local antibiogram/ICMR after cultures.", "IM/ICU co-management for sepsis resuscitation; antibiotic choice per ICMR/local. Catheter change is integral to clearing the infection."] };
          if (has(sel, "symptomatic")) return { emergency: false, ladder: 2, catg: "Symptomatic CAUTI",
            sc: "Source control = remove the catheter if no longer needed, or CHANGE it before treating (replace the colonised device).", ref: "Review; Urology if recurrent or structural cause.", mgmt: ["Treat only because there are SYMPTOMS — send culture from a freshly placed catheter, then antibiotic per local urinary guidance.", "Reassess ongoing need for catheterisation; shortest effective course."] };
          if (has(sel, "bacteriuria")) return { emergency: false, ladder: 0, catg: "Asymptomatic bacteriuria in a catheterised patient — do NOT treat",
            sc: "No antibiotics; source control if catheter no longer needed (remove) — do not screen or treat asymptomatic bacteriuria.", ref: "No referral for bacteriuria alone.", mgmt: ["Every long-term catheter is colonised — treating asymptomatic bacteriuria drives resistance and does NOT help the patient (exception: pregnancy or before urological instrumentation).", "Reassess whether the catheter is still needed and remove if possible."] };
          return { emergency: false, ladder: 0, catg: "Catheter present — assess for symptoms",
            sc: "Review need for the catheter and remove if possible (source control).", ref: "Review if new fever or systemic features develop.", mgmt: ["Do not treat a positive culture without symptoms.", "Antibiotics only for a symptomatic, catheter-associated infection."] };
        }
      }
    ]
  };

  window.SMD_WS_ENGINES = window.SMD_WS_ENGINES || {};
  window.SMD_WS_ENGINES.urology = UROLOGY;
})();
