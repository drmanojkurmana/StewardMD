/* StewardMD — Obstetrics & Gynaecology specialty engine.
   ---------------------------------------------------------------------------
   Registers into window.SMD_WS_ENGINES.obstetrics_gynaecology, consumed by
   workspaces.js. A LIGHTWEIGHT specialty pathway — NOT the Internal Medicine
   engine and NOT a diagnosis generator. For each syndrome it collects focused
   findings + danger signs and returns a conservative MANAGEMENT DECISION: the
   antibiotic-need level (0 none → 5 emergency referral), whether SOURCE CONTROL
   / a procedure (drainage, evacuation of the uterus, delivery, I&D) is required,
   and the referral/escalation. Actual drug choice is deferred to the existing
   stewardship engine / Drug Index / local antibiogram + ICMR (never prescribed
   here).

   The recurring OBGYN theme is separating mild, self-limiting disease
   (uncomplicated vaginitis, outpatient PID) from the true obstetric / gynae
   EMERGENCIES. Several of the killers are NOT infective and antibiotics are NOT
   the answer — ruptured ectopic and postpartum haemorrhage are BLEEDING, eclampsia
   is SEIZURE + severe HYPERTENSION (magnesium + BP control + delivery), ovarian
   torsion is a SURGICAL emergency. Others are infective and need source control
   as much as antibiotics: chorioamnionitis, septic abortion, endometritis and
   tubo-ovarian abscess. For every woman of reproductive age with abdominal pain,
   DO A PREGNANCY TEST. When sepsis needs critical-care or medical co-management
   the notes flag IM/ICU involvement — OBGYN remains the primary owner of all
   conditions here.

   Advisory only. Verify against local protocol, imaging, and the individual patient. */
(function () {
  "use strict";
  // ladder index → matches ABX/management ladder in workspaces.js
  // 0 none · 1 topical/local · 2 oral · 3 IV/admission · 4 urgent drainage/source control/procedure (drainage, evacuation of uterus, delivery) · 5 emergency referral
  function has(sel, id) { return sel && sel.has && sel.has(id); }
  function anyOf(sel, ids) { for (var i = 0; i < ids.length; i++) if (has(sel, ids[i])) return true; return false; }

  var OBGYN = {
    id: "obstetrics_gynaecology",
    name: "Obstetrics & Gynaecology",
    syndromes: [
      /* ───────────────────── Pelvic inflammatory disease ───────────────────── */
      {
        id: "pid", name: "Pelvic inflammatory disease",
        q: [
          { id: "pelvic_pain", label: "Lower abdominal / pelvic pain" }, { id: "discharge", label: "Abnormal vaginal / cervical discharge" },
          { id: "cmt", label: "Cervical motion / adnexal tenderness" }, { id: "fever", label: "Fever / systemic upset" },
          { id: "no_oral", label: "Vomiting / unable to tolerate oral therapy" }, { id: "pregnant", label: "Pregnant / IUD in situ / immunocompromise" }
        ],
        danger: [
          { id: "mass", label: "Adnexal mass / suspected tubo-ovarian abscess" },
          { id: "peritonism", label: "Peritonism / guarding / rebound" }, { id: "sepsis", label: "Septic shock / haemodynamic instability" }
        ],
        assess: function (sel) {
          if (has(sel, "sepsis")) return { emergency: true, ladder: 5, catg: "PID with septic shock",
            sc: "Resuscitate; urgent imaging (USS/CT) to exclude abscess needing drainage; laparoscopy if diagnosis unclear or deteriorating.",
            ref: "Emergency OBGYN; admit. IM/ICU co-management for sepsis.",
            mgmt: ["IV broad-spectrum antibiotics per local PID guidance / ICMR immediately (cover gonorrhoea, chlamydia + anaerobes).", "Escalate to critical care; look for a drainable collection."] };
          if (has(sel, "mass")) return { emergency: true, ladder: 4, catg: "PID with suspected tubo-ovarian abscess",
            sc: "Image (USS/CT); drainage of the abscess if large / not responding — see the tubo-ovarian abscess pathway.",
            ref: "Urgent OBGYN; admit.",
            mgmt: ["IV broad-spectrum antibiotics per local PID guidance / ICMR.", "Open the tubo-ovarian abscess pathway for source-control detail."] };
          if (anyOf(sel, ["peritonism", "fever", "no_oral", "pregnant"])) return { emergency: false, ladder: 3, catg: "Moderate–severe PID — admit for IV therapy",
            sc: "No procedure if no collection — image to exclude abscess; reassess.",
            ref: "OBGYN admission; gynae review.",
            mgmt: ["IV antibiotics per local PID guidance / ICMR, switch to oral once improving.", "Low threshold to treat empirically; test for STIs and offer partner notification.", "Remove/review IUD per local guidance if no response."] };
          if (anyOf(sel, ["pelvic_pain", "discharge", "cmt"])) return { emergency: false, ladder: 2, catg: "Mild PID — outpatient oral therapy",
            sc: "No procedure.",
            ref: "Gynae / sexual-health follow-up; review at 48–72 h.",
            mgmt: ["Do a pregnancy test FIRST in any reproductive-age woman with pelvic pain — a positive test means EXCLUDE ectopic (a bleeding/surgical emergency) before labelling this PID.", "Oral regimen per local PID guidance (empirical cover for gonorrhoea, chlamydia + anaerobes) — low threshold to treat on clinical suspicion.", "Test for STIs incl. HIV; partner notification and treatment; safety-net to re-attend if worsening."] };
          return { emergency: false, ladder: 0, catg: "PID unlikely on current findings",
            sc: "No procedure.",
            ref: "Safety-net; reassess if pelvic pain, discharge or fever develop.",
            mgmt: ["Do a pregnancy test before reassuring — a positive test with pelvic pain/bleeding means EXCLUDE ectopic, not PID.", "Insufficient features for empirical PID treatment now — reassess and test for STIs.", "Have a low threshold to treat if minimal criteria appear."] };
        }
      },
      /* ───────────────────── Tubo-ovarian abscess ───────────────────── */
      {
        id: "tubo_ovarian_abscess", name: "Tubo-ovarian abscess",
        q: [
          { id: "mass", label: "Adnexal mass / complex collection on imaging" }, { id: "pid_hx", label: "PID features / known/treated PID" },
          { id: "fever", label: "Fever / systemic upset" }, { id: "nonresponse", label: "No response to IV antibiotics (48–72 h)" },
          { id: "large", label: "Large abscess (> 5–7 cm)" }
        ],
        danger: [
          { id: "rupture", label: "Suspected rupture / peritonism / acute abdomen" },
          { id: "sepsis", label: "Septic shock / haemodynamic instability" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["rupture", "sepsis"])) return { emergency: true, ladder: 5, catg: "Ruptured / septic tubo-ovarian abscess",
            sc: "Resuscitate; EMERGENCY surgical drainage / washout (laparoscopy or laparotomy) — source control cannot wait.",
            ref: "Emergency OBGYN; admit. IM/ICU co-management for sepsis; Surgery/IR for drainage.",
            mgmt: ["IV broad-spectrum antibiotics per local guidance / ICMR (aerobic + anaerobic cover) as adjunct to drainage.", "This is a surgical / source-control emergency."] };
          if (anyOf(sel, ["nonresponse", "large"])) return { emergency: false, ladder: 4, catg: "Tubo-ovarian abscess — needs drainage",
            sc: "Image-guided (USS/CT) or surgical drainage is the definitive treatment when large or not responding to antibiotics; send pus for culture.",
            ref: "Urgent OBGYN; consider IR / Surgery consult for drainage. Admit.",
            mgmt: ["IV broad-spectrum antibiotics per local guidance / ICMR — drainage is the source control, antibiotics are adjunct.", "De-escalate on culture; OBGYN remains primary."] };
          return { emergency: false, ladder: 3, catg: "Tubo-ovarian abscess — trial of IV antibiotics",
            sc: "Small unruptured abscesses may respond medically — image and reassess; drain if no improvement at 48–72 h or if it enlarges.",
            ref: "OBGYN admission; gynae review.",
            mgmt: ["IV broad-spectrum antibiotics per local guidance / ICMR with close monitoring.", "Have a plan for drainage (IR / Surgery) if it fails to improve."] };
        }
      },
      /* ───────────────────── Ectopic pregnancy ───────────────────── */
      {
        id: "ectopic_pregnancy", name: "Ectopic pregnancy",
        q: [
          { id: "positive", label: "Positive pregnancy test / raised β-hCG" }, { id: "pain", label: "Unilateral / pelvic pain" },
          { id: "pv_bleed", label: "PV bleeding / spotting" }, { id: "amenorrhoea", label: "Amenorrhoea / late period" },
          { id: "risk", label: "Risk factors (prior ectopic, tubal surgery, IUD, ART)" }
        ],
        danger: [
          { id: "shock", label: "Shock / collapse / haemodynamic instability" },
          { id: "peritonism", label: "Peritonism / shoulder-tip pain / rebound (rupture)" }, { id: "syncope", label: "Syncope / severe sudden pain" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["shock", "peritonism", "syncope"])) return { emergency: true, ladder: 5, catg: "Ruptured ectopic pregnancy — SURGICAL / BLEEDING EMERGENCY (not infective)",
            sc: "Resuscitate (ABC, large-bore IV access, group & crossmatch, activate massive-haemorrhage protocol); EMERGENCY laparoscopy/laparotomy for surgical control of bleeding.",
            ref: "Emergency OBGYN + anaesthesia NOW.",
            mgmt: ["This is intra-abdominal HAEMORRHAGE, not an infection — antibiotics are NOT the treatment; do not delay theatre.", "Correct coagulopathy; transfuse per protocol; give anti-D if Rh-negative per local policy."] };
          if (has(sel, "positive")) return { emergency: false, ladder: 0, catg: "Suspected ectopic pregnancy — bleeding / surgical problem, not infective",
            sc: "Urgent transvaginal USS + serial β-hCG; management (expectant / medical / surgical) per OBGYN — antibiotics are NOT indicated for an uncomplicated ectopic.",
            ref: "Urgent OBGYN / early-pregnancy unit; admit if pain or instability.",
            mgmt: ["Positive pregnancy test + pain/bleeding = exclude ectopic until proven otherwise — this is a bleeding/surgical risk, not an infection.", "Safety-net firmly: return immediately for severe pain, shoulder-tip pain, dizziness or collapse.", "Give anti-D if Rh-negative per local policy where indicated."] };
          return { emergency: false, ladder: 0, catg: "Pregnancy not confirmed — check β-hCG",
            sc: "Perform a pregnancy test; if positive with pain/bleeding, treat as suspected ectopic and image.",
            ref: "Early-pregnancy unit / OBGYN if pregnancy confirmed.",
            mgmt: ["Antibiotics are not relevant here — the concern is early-pregnancy bleeding.", "Confirm pregnancy status before proceeding."] };
        }
      },
      /* ───────────────────── Miscarriage (threatened / incomplete) ───────────────────── */
      {
        id: "miscarriage", name: "Miscarriage (early-pregnancy bleeding)",
        q: [
          { id: "positive", label: "Positive pregnancy test / known early pregnancy" }, { id: "bleeding", label: "PV bleeding / spotting" },
          { id: "cramping", label: "Cramping / lower abdominal pain" }, { id: "tissue", label: "Passed products / tissue" },
          { id: "os_open", label: "Cervical os open / products in os" }, { id: "rh_neg", label: "Rh-negative mother" }
        ],
        danger: [
          { id: "shock", label: "Heavy bleeding / shock / haemodynamic instability" },
          { id: "sepsis", label: "Fever / offensive discharge (septic abortion)" }, { id: "severe_pain", label: "Severe / unilateral pain (exclude ectopic)" }
        ],
        assess: function (sel) {
          if (has(sel, "shock")) return { emergency: true, ladder: 4, catg: "Incomplete miscarriage with heavy bleeding — BLEEDING emergency",
            sc: "Resuscitate (IV access, group & crossmatch); remove products from the os; urgent surgical / medical uterine evacuation stops the bleeding — antibiotics are NOT the treatment.",
            ref: "Emergency OBGYN NOW.",
            mgmt: ["Bleeding is from retained products — evacuate; transfuse per protocol.", "Give anti-D if Rh-negative per local policy."] };
          if (has(sel, "sepsis")) return { emergency: true, ladder: 4, catg: "Septic miscarriage — open the septic abortion pathway",
            sc: "Do NOT delay uterine evacuation of retained products; resuscitate + IV antibiotics.",
            ref: "Urgent OBGYN; admit.",
            mgmt: ["Fever + bleeding after/during miscarriage = septic abortion until proven otherwise.", "Open the septic abortion pathway for detail."] };
          if (has(sel, "severe_pain")) return { emergency: false, ladder: 0, catg: "Early-pregnancy pain + bleeding — EXCLUDE ectopic first",
            sc: "Urgent transvaginal USS + serial β-hCG before calling it a miscarriage — see the ectopic pathway.",
            ref: "Urgent OBGYN / early-pregnancy unit.",
            mgmt: ["Never diagnose miscarriage on symptoms alone — a ruptured ectopic can look identical and kills.", "Give anti-D if Rh-negative per local policy where indicated."] };
          if (anyOf(sel, ["tissue", "os_open"])) return { emergency: false, ladder: 4, catg: "Incomplete miscarriage — needs evacuation",
            sc: "USS to confirm retained products; expectant / medical / surgical evacuation per OBGYN — no antibiotics unless infected.",
            ref: "OBGYN / early-pregnancy unit.",
            mgmt: ["Antibiotics not routine — only if signs of infection.", "Give anti-D if Rh-negative per local policy."] };
          if (has(sel, "positive")) return { emergency: false, ladder: 0, catg: "Threatened miscarriage (os closed) — supportive",
            sc: "USS to confirm viability + location (exclude ectopic); no procedure if os closed.",
            ref: "Early-pregnancy unit; safety-net.",
            mgmt: ["Reassure but confirm intrauterine pregnancy on USS.", "Safety-net firmly for heavy bleeding, severe pain, dizziness or fever; anti-D if Rh-negative per local policy."] };
          return { emergency: false, ladder: 0, catg: "Confirm pregnancy first",
            sc: "Do a pregnancy test; if positive, image to locate and assess viability.",
            ref: "Early-pregnancy unit if pregnancy confirmed.",
            mgmt: ["A pregnancy test is mandatory in any reproductive-age woman with bleeding or pelvic pain."] };
        }
      },
      /* ───────────────────── Chorioamnionitis ───────────────────── */
      {
        id: "chorioamnionitis", name: "Chorioamnionitis",
        q: [
          { id: "fever", label: "Intrapartum / antepartum maternal fever" }, { id: "uterine_tender", label: "Uterine tenderness" },
          { id: "fetal_tachy", label: "Fetal tachycardia" }, { id: "mat_tachy", label: "Maternal tachycardia" },
          { id: "discharge", label: "Foul / purulent amniotic fluid or discharge" }, { id: "prom", label: "Prolonged / preterm rupture of membranes" }
        ],
        danger: [
          { id: "sepsis", label: "Maternal septic shock / instability" }, { id: "fetal_distress", label: "Non-reassuring / abnormal fetal status" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["sepsis", "fetal_distress"])) return { emergency: true, ladder: 5, catg: "Chorioamnionitis with maternal sepsis / fetal compromise — obstetric emergency",
            sc: "Resuscitate mother; EXPEDITE DELIVERY urgently (do not delay); continuous fetal monitoring; neonatal team present.",
            ref: "Emergency OBGYN + anaesthesia + neonatology. IM/ICU co-management for maternal sepsis.",
            mgmt: ["IV broad-spectrum antibiotics per local guidance / ICMR immediately (do not wait for delivery).", "Delivery is the definitive source control."] };
          return { emergency: true, ladder: 4, catg: "Chorioamnionitis — IV antibiotics + expedite delivery",
            sc: "Delivery is the source control — expedite delivery once maternal condition allows; continuous fetal monitoring; involve neonatology.",
            ref: "Urgent OBGYN; admit to labour ward.",
            mgmt: ["Start IV broad-spectrum antibiotics per local guidance / ICMR promptly — do not delay for delivery.", "Monitor mother and fetus closely; antipyretics; escalate if sepsis develops."] };
        }
      },
      /* ───────────────────── Pre-eclampsia / eclampsia ───────────────────── */
      {
        id: "pre_eclampsia", name: "Pre-eclampsia / eclampsia",
        q: [
          { id: "high_bp", label: "Raised BP (≥ 20 wk or postpartum)" }, { id: "proteinuria", label: "Proteinuria / new oedema" },
          { id: "headache", label: "Severe headache" }, { id: "visual", label: "Visual disturbance / flashing lights" },
          { id: "epigastric", label: "Epigastric / RUQ pain" }, { id: "brisk", label: "Brisk reflexes / clonus" }
        ],
        danger: [
          { id: "seizure", label: "Seizure / loss of consciousness (eclampsia)" }, { id: "severe_htn", label: "Severe hypertension (crisis)" },
          { id: "hellp", label: "Signs of HELLP / pulmonary oedema / oliguria" }, { id: "fetal_distress", label: "Non-reassuring fetal status" }
        ],
        assess: function (sel) {
          if (has(sel, "seizure")) return { emergency: true, ladder: 5, catg: "ECLAMPSIA — magnesium + BP control + delivery (NOT an infection)",
            sc: "Protect airway, left lateral, high-flow O₂; magnesium sulphate (per protocol, no dose here) to stop/prevent seizures; control severe BP (labetalol / nifedipine / hydralazine class); DELIVER once mother is stabilised — delivery is the definitive treatment.",
            ref: "Emergency OBGYN + anaesthesia + neonatology NOW. IM/ICU for organ support.",
            mgmt: ["Antibiotics are irrelevant — this is seizure + BP control, then delivery.", "Magnesium is standard for eclampsia (and severe pre-eclampsia prophylaxis); continue postpartum per protocol.", "Do not give too much fluid — risk of pulmonary oedema; monitor for HELLP."] };
          if (anyOf(sel, ["severe_htn", "hellp", "fetal_distress"])) return { emergency: true, ladder: 5, catg: "Severe pre-eclampsia — urgent BP control + magnesium + plan delivery",
            sc: "Urgent control of severe hypertension (labetalol / nifedipine / hydralazine class, per protocol); magnesium sulphate for seizure prophylaxis; expedite delivery per OBGYN; continuous fetal monitoring.",
            ref: "Emergency OBGYN + anaesthesia; admit to labour ward. IM/ICU if HELLP / pulmonary oedema.",
            mgmt: ["This is a hypertensive / obstetric emergency, not infective — no antibiotics.", "Magnesium prevents eclampsia; give steroids for fetal lung maturity if preterm, per protocol.", "Bloods for HELLP (platelets, LFTs, LDH, haemolysis); careful fluid balance."] };
          if (anyOf(sel, ["headache", "visual", "epigastric", "brisk"])) return { emergency: true, ladder: 3, catg: "Pre-eclampsia with warning symptoms — admit",
            sc: "Admit; monitor BP, urine protein, reflexes, bloods (HELLP screen) and fetus; low threshold for magnesium and delivery if it progresses.",
            ref: "Urgent OBGYN; admit.",
            mgmt: ["Symptomatic pre-eclampsia can progress to eclampsia fast — do not send home.", "Antibiotics not indicated; BP control and monitoring are the priority."] };
          if (anyOf(sel, ["high_bp", "proteinuria"])) return { emergency: false, ladder: 0, catg: "Suspected pre-eclampsia — investigate",
            sc: "Confirm BP, check urine protein and bloods; assess fetus; arrange close follow-up.",
            ref: "OBGYN / antenatal review promptly.",
            mgmt: ["Not infective — no antibiotics.", "Safety-net firmly for headache, visual symptoms, epigastric pain, reduced fetal movements or seizure."] };
          return { emergency: false, ladder: 0, catg: "Check BP and urine in any pregnant woman",
            sc: "Measure BP and dip urine — pre-eclampsia is often silent.",
            ref: "Antenatal review.",
            mgmt: ["Always check BP and urine in pregnancy ≥ 20 wk or postpartum."] };
        }
      },
      /* ───────────────────── Postpartum haemorrhage ───────────────────── */
      {
        id: "postpartum_haemorrhage", name: "Postpartum haemorrhage",
        q: [
          { id: "heavy_bleed", label: "Heavy PV bleeding after delivery" }, { id: "atony", label: "Soft / poorly contracted uterus (atony)" },
          { id: "retained", label: "Retained placenta / products" }, { id: "trauma", label: "Genital tract tear / trauma" },
          { id: "risk", label: "Risk factors (prolonged / augmented labour, multiple pregnancy, previous PPH)" }
        ],
        danger: [
          { id: "shock", label: "Shock / collapse / ongoing massive bleeding" },
          { id: "coag", label: "Coagulopathy / oozing from puncture sites (DIC)" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["shock", "coag"])) return { emergency: true, ladder: 5, catg: "Massive postpartum haemorrhage — BLEEDING emergency (NOT infective)",
            sc: "Activate massive-haemorrhage protocol: ABC, two large-bore cannulae, group & crossmatch, transfuse + tranexamic acid; uterine massage + uterotonics; find & treat the cause (atony, retained tissue, trauma, thrombin); escalate to bimanual compression, balloon tamponade, EUA/evacuation, surgical control (B-Lynch, ligation, hysterectomy).",
            ref: "Emergency OBGYN + anaesthesia + haematology NOW. IM/ICU for resuscitation.",
            mgmt: ["Antibiotics are NOT the treatment — this is bleeding control (4 T's: Tone, Tissue, Trauma, Thrombin).", "Uterotonics + uterine massage first-line for atony; give tranexamic acid early.", "Correct coagulopathy; transfuse per protocol."] };
          if (anyOf(sel, ["retained", "trauma"])) return { emergency: true, ladder: 4, catg: "PPH with retained tissue / genital tract trauma — source control",
            sc: "Retained products → uterine evacuation; genital tract tear → suture/repair; examine under anaesthesia if needed — this is the definitive treatment.",
            ref: "Urgent OBGYN; theatre.",
            mgmt: ["Find the cause among the 4 T's; uterotonics + massage while arranging source control.", "Give prophylactic antibiotics around manual removal / evacuation per local policy — antibiotics are adjunct, not the treatment."] };
          if (anyOf(sel, ["heavy_bleed", "atony", "risk"])) return { emergency: true, ladder: 3, catg: "Postpartum haemorrhage — atony likely",
            sc: "Uterine massage + uterotonics; empty the bladder; ensure the placenta is complete; IV access, fluids, monitor; escalate if not controlled.",
            ref: "Urgent OBGYN; admit.",
            mgmt: ["Atony causes most PPH — massage + uterotonics are first-line; give tranexamic acid.", "Not infective — do not wait on antibiotics; reassess for retained tissue / trauma if bleeding continues."] };
          return { emergency: false, ladder: 0, catg: "Assess blood loss and uterine tone",
            sc: "Quantify loss; check tone, tissue, trauma; monitor observations.",
            ref: "OBGYN if bleeding is more than expected.",
            mgmt: ["Anticipate PPH in women with risk factors; active management of the third stage prevents it."] };
        }
      },
      /* ───────────────────── Postpartum endometritis ───────────────────── */
      {
        id: "postpartum_endometritis", name: "Postpartum endometritis",
        q: [
          { id: "fever", label: "Postpartum fever" }, { id: "uterine_tender", label: "Uterine / lower abdominal tenderness" },
          { id: "foul_lochia", label: "Foul-smelling / purulent lochia" }, { id: "csection", label: "Caesarean / instrumental / prolonged labour" },
          { id: "no_oral", label: "Vomiting / unable to tolerate oral therapy" }
        ],
        danger: [
          { id: "retained", label: "Suspected retained products of conception" },
          { id: "sepsis", label: "Septic shock / haemodynamic instability" }, { id: "peritonism", label: "Peritonism / suspected abscess" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["sepsis", "peritonism"])) return { emergency: true, ladder: 5, catg: "Postpartum endometritis with sepsis",
            sc: "Resuscitate; image (USS) for retained products / collection; evacuation of retained products or drainage as source control.",
            ref: "Emergency OBGYN; admit. IM/ICU co-management for sepsis.",
            mgmt: ["IV broad-spectrum antibiotics per local guidance / ICMR (aerobic + anaerobic cover) immediately.", "Identify and treat the source (retained products, collection)."] };
          if (has(sel, "retained")) return { emergency: false, ladder: 4, catg: "Postpartum endometritis with retained products",
            sc: "USS to confirm; surgical evacuation of retained products of conception is the source control.",
            ref: "OBGYN; admit for evacuation.",
            mgmt: ["IV broad-spectrum antibiotics per local guidance / ICMR around evacuation.", "Antibiotics are adjunct — retained products must be evacuated."] };
          if (anyOf(sel, ["fever", "csection", "no_oral"])) return { emergency: false, ladder: 3, catg: "Postpartum endometritis — admit for IV therapy",
            sc: "Image to exclude retained products / collection; no procedure if none found.",
            ref: "OBGYN admission.",
            mgmt: ["IV broad-spectrum antibiotics per local guidance / ICMR, switch to oral once afebrile and improving.", "Reassess for retained products if slow to respond."] };
          return { emergency: false, ladder: 2, catg: "Mild postpartum endometritis — oral therapy",
            sc: "No procedure; image if not settling.",
            ref: "Gynae / postnatal review; review at 48 h.",
            mgmt: ["Oral antibiotics per local guidance for mild disease with adequate oral intake.", "Safety-net to escalate for fever, worsening pain or heavy/foul discharge."] };
        }
      },
      /* ───────────────────── Septic abortion ───────────────────── */
      {
        id: "septic_abortion", name: "Septic abortion",
        q: [
          { id: "post_abortion", label: "Recent abortion / miscarriage / instrumentation" }, { id: "fever", label: "Fever / systemic upset" },
          { id: "bleeding", label: "PV bleeding" }, { id: "offensive", label: "Offensive / purulent vaginal discharge" },
          { id: "retained", label: "Suspected retained products of conception" }
        ],
        danger: [
          { id: "sepsis", label: "Septic shock / haemodynamic instability" },
          { id: "peritonism", label: "Peritonism / suspected uterine perforation / bowel injury" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["sepsis", "peritonism"])) return { emergency: true, ladder: 5, catg: "Septic abortion with septic shock / visceral injury — EMERGENCY",
            sc: "Resuscitate aggressively; URGENT uterine evacuation of retained products; laparotomy if perforation / bowel injury; hysterectomy may be needed in life-threatening sepsis.",
            ref: "Emergency OBGYN + anaesthesia NOW. IM/ICU co-management for sepsis; Surgery if visceral injury.",
            mgmt: ["IV broad-spectrum antibiotics per local guidance / ICMR (aerobic + anaerobic incl. cover for Clostridium/toxin) immediately.", "Evacuation of retained products is the definitive source control; give anti-D if Rh-negative per local policy."] };
          return { emergency: true, ladder: 4, catg: "Septic abortion — resuscitate + IV antibiotics + urgent evacuation",
            sc: "Urgent surgical evacuation of retained products of conception is the source control; USS to confirm; send tissue/pus for culture.",
            ref: "Urgent OBGYN; admit.",
            mgmt: ["Resuscitate (IV access, fluids); start IV broad-spectrum antibiotics per local guidance / ICMR before / around evacuation.", "Do not delay evacuation of retained products; give anti-D if Rh-negative per local policy."] };
        }
      },
      /* ───────────────────── Ovarian torsion ───────────────────── */
      {
        id: "ovarian_torsion", name: "Ovarian torsion",
        q: [
          { id: "sudden_pain", label: "Sudden severe unilateral pelvic pain" }, { id: "vomiting", label: "Nausea / vomiting" },
          { id: "mass", label: "Known ovarian cyst / mass / enlarged ovary" }, { id: "intermittent", label: "Intermittent colicky pain (torsion/detorsion)" },
          { id: "risk", label: "Risk (ovulation induction / ART, pregnancy, prior torsion)" }
        ],
        danger: [
          { id: "peritonism", label: "Peritonism / guarding" }, { id: "shock", label: "Haemodynamic instability" },
          { id: "fever", label: "Fever (necrosis / late)" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["peritonism", "shock", "fever"])) return { emergency: true, ladder: 5, catg: "Ovarian torsion with peritonism / instability — SURGICAL emergency (not infective)",
            sc: "Resuscitate; EMERGENCY laparoscopy — detorsion (± cystectomy) to save the ovary; do NOT wait — the ovary is time-critical.",
            ref: "Emergency OBGYN + anaesthesia NOW.",
            mgmt: ["This is ischaemia, not infection — antibiotics are not the treatment; theatre saves the ovary.", "Do a pregnancy test; USS with Doppler helps but normal flow does NOT exclude torsion — clinical suspicion wins."] };
          if (anyOf(sel, ["sudden_pain", "mass", "intermittent"])) return { emergency: true, ladder: 4, catg: "Suspected ovarian torsion — urgent surgery",
            sc: "Urgent transvaginal/pelvic USS with Doppler; EMERGENCY laparoscopy for detorsion is the definitive treatment — early surgery preserves the ovary.",
            ref: "Urgent OBGYN; admit.",
            mgmt: ["Sudden severe unilateral pain + adnexal mass = torsion until excluded — do not delay for imaging if suspicion is high.", "Always do a pregnancy test; not an infective problem — antibiotics not indicated."] };
          return { emergency: false, ladder: 0, catg: "Acute pelvic pain — keep torsion in mind",
            sc: "Pregnancy test + pelvic USS with Doppler; low threshold to escalate to surgery if pain is severe or a mass is present.",
            ref: "OBGYN if pain persists or a mass is found.",
            mgmt: ["Torsion is a clinical diagnosis — imaging supports but does not exclude it.", "Exclude ectopic (β-hCG) and appendicitis."] };
        }
      },
      /* ───────────────────── Bartholin abscess ───────────────────── */
      {
        id: "bartholin_abscess", name: "Bartholin abscess",
        q: [
          { id: "swelling", label: "Fluctuant labial / vulval swelling" }, { id: "pain", label: "Pain / difficulty sitting or walking" },
          { id: "recurrent", label: "Recurrent Bartholin cyst / abscess" }, { id: "cellulitis", label: "Surrounding cellulitis" },
          { id: "systemic", label: "Fever / systemic features" }, { id: "immuno", label: "Diabetes / immunocompromise" }
        ],
        danger: [
          { id: "sepsis", label: "Systemic sepsis / instability" }, { id: "necrosis", label: "Crepitus / necrosis / rapidly spreading (necrotising infection?)" }
        ],
        assess: function (sel) {
          if (has(sel, "necrosis")) return { emergency: true, ladder: 5, catg: "⚠ Suspected necrotising vulval / perineal infection",
            sc: "IMMEDIATE surgical exploration & debridement — do NOT delay for imaging.",
            ref: "Emergency OBGYN + Surgery + critical care NOW.",
            mgmt: ["Aggressive resuscitation; broad-spectrum IV antibiotics per local protocol / ICMR.", "This is beyond a simple abscess — a surgical emergency."] };
          if (has(sel, "sepsis")) return { emergency: false, ladder: 4, catg: "Bartholin abscess with systemic sepsis",
            sc: "Incision & drainage (with Word catheter or marsupialisation) is the primary treatment; send pus for culture.",
            ref: "Urgent OBGYN; admit.",
            mgmt: ["IV antibiotics per local guidance / ICMR as adjunct to drainage given systemic features."] };
          return { emergency: false, ladder: 1, catg: "Bartholin abscess — incision & drainage",
            sc: "Incision & drainage with Word catheter placement, or marsupialisation (esp. if recurrent), is the definitive treatment; culture pus.",
            ref: "OBGYN / minor-ops for drainage.",
            mgmt: ["Antibiotics are adjunct ONLY — add if surrounding cellulitis, systemic features or immunocompromise/diabetes; otherwise drainage alone suffices.", "Analgesia; sitz baths; consider STI screening.", "Consider biopsy in women > 40 y to exclude malignancy."] };
        }
      },
      /* ───────────────────── Vaginitis ───────────────────── */
      {
        id: "vaginitis", name: "Vaginitis",
        q: [
          { id: "curdy", label: "Thick / curdy white discharge + itch (candidiasis)" }, { id: "fishy", label: "Thin grey discharge / fishy odour (BV)" },
          { id: "frothy", label: "Frothy yellow-green discharge / itch (trichomoniasis)" }, { id: "pregnant", label: "Pregnant" },
          { id: "recurrent", label: "Recurrent / immunocompromise / diabetes" }
        ],
        danger: [
          { id: "pelvic_pain", label: "Pelvic pain / cervical motion tenderness (consider PID)" },
          { id: "systemic", label: "Fever / systemic upset" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["pelvic_pain", "systemic"])) return { emergency: false, ladder: 2, catg: "Discharge with pelvic pain / systemic features — reassess for PID / upper-tract infection",
            sc: "No procedure — examine (incl. speculum + bimanual); this is beyond simple vaginitis.",
            ref: "Gynae / sexual-health; open the PID pathway if cervical motion / adnexal tenderness.",
            mgmt: ["Do not label as simple vaginitis if there is pelvic pain or fever — assess and treat for PID per local guidance if criteria met.", "Test for STIs; treat partners where relevant."] };
          if (has(sel, "frothy")) return { emergency: false, ladder: 2, catg: "Trichomoniasis (suspected)",
            sc: "No procedure.",
            ref: "Sexual-health; partner notification and treatment.",
            mgmt: ["Oral regimen per local guidance — an STI, so screen for co-infections and treat the partner.", "Not an emergency."] };
          if (has(sel, "fishy")) return { emergency: false, ladder: 1, catg: "Bacterial vaginosis (suspected)",
            sc: "No procedure.",
            ref: "GP / sexual-health; review if recurrent.",
            mgmt: ["Topical or oral regimen per local guidance; often self-limiting.", "Treat symptomatic BV in pregnancy per local guidance; not an emergency."] };
          if (has(sel, "curdy")) return { emergency: false, ladder: 1, catg: "Vulvovaginal candidiasis (uncomplicated)",
            sc: "No procedure.",
            ref: "GP; review if recurrent / not responding — investigate for diabetes.",
            mgmt: ["Topical or single-dose oral antifungal per local guidance for uncomplicated disease.", "Recurrent / severe / pregnant / immunocompromised → per local guidance (topical preferred in pregnancy); not an emergency."] };
          return { emergency: false, ladder: 0, catg: "Vaginal discharge — clarify cause",
            sc: "No procedure — examine and take swabs to characterise the discharge.",
            ref: "GP / sexual-health.",
            mgmt: ["Treat once the cause is identified (BV, candidiasis, trichomoniasis) per local guidance — avoid blind treatment.", "Test for STIs; not an emergency."] };
        }
      }
    ]
  };

  window.SMD_WS_ENGINES = window.SMD_WS_ENGINES || {};
  window.SMD_WS_ENGINES.obstetrics_gynaecology = OBGYN;
})();
