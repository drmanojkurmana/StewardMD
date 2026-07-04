/* StewardMD — Ophthalmology specialty engine.
   ---------------------------------------------------------------------------
   Registers into window.SMD_WS_ENGINES.ophthalmology, consumed by workspaces.js. A
   LIGHTWEIGHT specialty pathway — NOT the Internal Medicine engine and NOT a
   diagnosis generator. For each syndrome it collects focused findings + danger
   signs and returns a conservative MANAGEMENT DECISION: the antibiotic/treatment-
   need level (0 none → 5 emergency referral), whether SOURCE CONTROL / a procedure
   (irrigation, corneal scrape, IOP-lowering, intravitreal tap, abscess drainage) is
   required, and the referral/escalation. Actual drug choice is deferred to the
   existing stewardship engine / Drug Index / local antibiogram + ICMR (never
   prescribed here).

   The recurring ophthalmology theme is that MANY acute red eyes are self-limiting
   (viral conjunctivitis, subconjunctival haemorrhage, stye — antibiotics NOT
   indicated) — the engine's job is to separate those from the true SIGHT- or
   LIFE-threatening red flags non-specialists miss: microbial keratitis, herpes
   keratitis (never blind-steroid), acute angle-closure glaucoma, anterior uveitis,
   endophthalmitis, sudden painless vision loss (CRAO / detachment), chemical injury
   and orbital cellulitis. THREE rules underpin every red eye: (1) check ACUITY and
   PUPILS (RAPD) in every eye; (2) a contact-lens wearer with a red painful eye is
   keratitis until proven otherwise; (3) never give a topical steroid blindly.
   Orbital cellulitis is co-managed — the notes flag ENT (± neurosurgery); ophthalmology
   remains primary (this is NOT an Internal-Medicine-primary shared condition).

   Advisory only. Verify against local protocol, slit-lamp exam, and the individual patient. */
(function () {
  "use strict";
  // ladder index → matches ABX/management ladder in workspaces.js
  // 0 none/lubricant · 1 topical/local · 2 oral · 3 IV/admission · 4 urgent procedure/source control (IOP-lowering, irrigation, scrape, intravitreal tap) · 5 emergency referral
  function has(sel, id) { return sel && sel.has && sel.has(id); }
  function anyOf(sel, ids) { for (var i = 0; i < ids.length; i++) if (has(sel, ids[i])) return true; return false; }

  var OPHTHAL = {
    id: "ophthalmology",
    name: "Ophthalmology",
    syndromes: [
      /* ───────────────────── Conjunctivitis ───────────────────── */
      {
        id: "conjunctivitis", name: "Conjunctivitis (red eye)",
        q: [
          { id: "purulent", label: "Purulent / mucopurulent discharge, lids stuck" }, { id: "watery", label: "Watery discharge / recent URTI / contact" },
          { id: "itch_bilat", label: "Itch / bilateral / atopy (allergic)" }, { id: "follicular", label: "Follicular reaction / pre-auricular node (viral)" },
          { id: "contact_lens", label: "Contact-lens wearer" }, { id: "neonate", label: "Neonate (< 28 days) / ophthalmia neonatorum" }
        ],
        danger: [
          { id: "vision_loss", label: "Reduced vision / marked photophobia / severe pain" },
          { id: "infiltrate", label: "Corneal opacity / white infiltrate / hazy cornea" },
          { id: "hyperacute", label: "Hyperacute copious purulent discharge (gonococcal?)" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["vision_loss", "infiltrate"]) || has(sel, "contact_lens")) return { emergency: anyOf(sel, ["vision_loss", "infiltrate"]), ladder: 4, catg: "Red eye with sight-threatening features / contact-lens wearer — treat as KERATITIS until excluded",
            sc: "Same-day slit-lamp + fluorescein; corneal scrape for microscopy/culture if an infiltrate is present (do NOT dismiss as simple conjunctivitis).", ref: "Same-day ophthalmology assessment.", mgmt: ["Reduced vision, pain, photophobia or a corneal infiltrate mean this is NOT simple conjunctivitis — escalate same-day.", "Stop lens wear; do NOT patch; withhold topical steroid until keratitis excluded by specialist."] };
          if (has(sel, "neonate") || has(sel, "hyperacute")) return { emergency: has(sel, "hyperacute"), ladder: 3, catg: "Neonatal / hyperacute (?gonococcal or chlamydial) conjunctivitis",
            sc: "Urgent conjunctival swabs (Gram stain, culture, chlamydia NAAT) before/at treatment; saline lavage of discharge.", ref: "Urgent ophthalmology + paediatric/IM review; notifiable — trace and treat partners/mother.", mgmt: ["Gonococcal risk = corneal-perforation risk: needs SYSTEMIC antibiotic per local protocol/ICMR, not topical alone — defer agent to stewardship.", "Screen for concurrent chlamydia/other STI; involve the appropriate specialty."] };
          if (has(sel, "purulent")) return { emergency: false, ladder: 1, catg: "Likely bacterial conjunctivitis (mild)",
            sc: "No procedure; swab only if severe, recurrent or not settling.", ref: "Safety-net; review if vision drops or pain / photophobia develop.", mgmt: ["Most bacterial conjunctivitis is self-limiting — hygiene + lubricants first; a topical antibiotic per local guidance is optional and only speeds resolution.", "Lid hygiene, avoid towel-sharing; no antibiotic needed if mild and improving."] };
          return { emergency: false, ladder: 0, catg: "Viral / allergic conjunctivitis — self-limiting",
            sc: "No procedure.", ref: "Safety-net for red flags (reduced vision, pain, photophobia, infiltrate).", mgmt: ["Antibiotics NOT indicated — supportive care: cool compresses, lubricants; topical antihistamine/mast-cell stabiliser for allergic per local guidance.", "Viral is highly contagious — strict hand/towel hygiene; usually self-limiting over 1–2 weeks."] };
        }
      },
      /* ───────────── Subconjunctival haemorrhage ───────────── */
      {
        id: "subconj_haem", name: "Subconjunctival haemorrhage",
        q: [
          { id: "flat_red", label: "Flat bright-red patch, normal vision, no pain" }, { id: "valsalva", label: "Cough / sneeze / straining / Valsalva trigger" },
          { id: "anticoag", label: "On anticoagulant / antiplatelet / known bleeding disorder" }, { id: "hypertension", label: "Hypertension / recurrent episodes" },
          { id: "trauma", label: "Any trauma to the eye" }
        ],
        danger: [
          { id: "no_post_border", label: "Trauma + blood extends back with no visible posterior border" },
          { id: "vision_pain", label: "Reduced vision / pain / proptosis (?globe rupture, retrobulbar bleed)" },
          { id: "other_bleeding", label: "Spontaneous bruising / bleeding elsewhere (coagulopathy)" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["no_post_border", "vision_pain"])) return { emergency: true, ladder: 5, catg: "⚠ 'Subconjunctival blood' with trauma / vision loss — exclude ruptured globe or retrobulbar haemorrhage",
            sc: "Do NOT press on the eye; shield it. No visible posterior border of blood after trauma, or reduced vision/proptosis, suggests occult rupture / orbital bleed — CT orbit (no pressure, no MRI if metallic FB possible).", ref: "Emergency ophthalmology; lateral canthotomy if orbital compartment syndrome.", mgmt: ["A red flat patch is only reassuring when vision is normal, there is no pain and the whole posterior margin is visible.", "Traumatic case: assume globe rupture until excluded — shield, no pressure, keep nil-by-mouth for theatre."] };
          if (anyOf(sel, ["anticoag", "hypertension", "other_bleeding"])) return { emergency: false, ladder: 0, catg: "Subconjunctival haemorrhage — reassure, but check the systemic cause",
            sc: "No ocular procedure.", ref: "Reassure; check BP; review anticoagulation/INR; recurrent or spontaneous bilateral bleeds warrant a clotting screen.", mgmt: ["Harmless and self-resolving over 1–2 weeks — no drops needed; the colour will change like a bruise.", "Recurrent / on blood-thinners / bleeding elsewhere: check BP, INR and clotting — the eye is the messenger, not the problem."] };
          return { emergency: false, ladder: 0, catg: "Simple subconjunctival haemorrhage — reassure",
            sc: "No procedure.", ref: "Reassure; safety-net for pain, vision change or recurrence.", mgmt: ["Benign and self-limiting — lubricants only for irritation; resolves in 1–2 weeks.", "No antibiotic, no urgency IF vision is normal, painless and non-traumatic."] };
        }
      },
      /* ───────────── Corneal foreign body / abrasion ───────────── */
      {
        id: "corneal_fb", name: "Corneal foreign body / abrasion",
        q: [
          { id: "fb_sensation", label: "Foreign-body sensation / gritty / watering" }, { id: "abrasion", label: "Fluorescein-staining epithelial defect (abrasion)" },
          { id: "surface_fb", label: "Visible superficial corneal / subtarsal FB (± rust ring)" }, { id: "contact_lens", label: "Contact-lens wearer" },
          { id: "photophobia", label: "Photophobia / blepharospasm" }
        ],
        danger: [
          { id: "high_velocity", label: "High-velocity / metal-on-metal / hammering / grinding (intraocular FB?)" },
          { id: "penetrating", label: "Seidel positive / flat AC / peaked pupil / uveal prolapse (open globe)" },
          { id: "infiltrate", label: "White infiltrate around defect / hypopyon (infected ulcer)" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["high_velocity", "penetrating"])) return { emergency: true, ladder: 5, catg: "⚠ Suspected penetrating injury / intraocular foreign body",
            sc: "Do NOT attempt removal, do NOT pad or press; shield the eye. CT orbit to localise metallic FB (avoid MRI if metal). Tetanus cover. Nil-by-mouth for theatre.", ref: "Emergency ophthalmology / vitreoretinal — open-globe repair or FB removal.", mgmt: ["Any hammering / grinding / metal-on-metal history is an intraocular FB until CT excludes it — a tiny entry wound can look trivial.", "Shield the globe, give systemic (not topical) antibiotic prophylaxis per local protocol, tetanus prophylaxis; do NOT patch."] };
          if (has(sel, "infiltrate")) return { emergency: true, ladder: 4, catg: "Corneal defect with infiltrate — treat as microbial keratitis",
            sc: "Slit-lamp + fluorescein; corneal scrape for microscopy/culture before drops.", ref: "Same-day ophthalmology.", mgmt: ["An infiltrate/hypopyon around an abrasion means infection — escalate to the keratitis pathway.", "Stop lens wear; withhold topical steroid; do NOT patch an infected or lens-related defect."] };
          if (has(sel, "surface_fb")) return { emergency: false, ladder: 1, catg: "Superficial corneal / subtarsal foreign body",
            sc: "Instil topical anaesthetic to examine; EVERT the upper lid (subtarsal FB is easily missed); remove FB with a moistened swab or needle-tip at the slit-lamp; residual rust ring may need a burr.", ref: "Ophthalmology if central, deep, rust ring persists, or not removable.", mgmt: ["Always evert the lid and check for a subtarsal FB causing vertical corneal scratches.", "After removal: topical antibiotic prophylaxis per local guidance; NEVER send the patient home with topical anaesthetic (it prevents healing and masks damage)."] };
          if (has(sel, "abrasion") || anyOf(sel, ["fb_sensation", "photophobia"])) return { emergency: false, ladder: 1, catg: has(sel, "contact_lens") ? "Corneal abrasion in a contact-lens wearer — do NOT patch (Pseudomonas risk)" : "Simple corneal abrasion",
            sc: "Fluorescein to confirm and size the defect; check for retained FB.", ref: "Review 24–48 h; ophthalmology if not healing, central, or infiltrate appears.", mgmt: has(sel, "contact_lens")
              ? ["Contact-lens abrasion: do NOT pad — patching over a lens-related defect risks Pseudomonas keratitis; cover with anti-pseudomonal topical antibiotic per local guidance and stop lens wear.", "Review in 24 h; any infiltrate → treat as microbial keratitis."]
              : ["Topical antibiotic prophylaxis + lubricants per local guidance; oral analgesia; most heal in 24–72 h.", "No topical steroid; do NOT dispense topical anaesthetic; review if pain worsens or vision drops (?infection)."] };
          return { emergency: false, ladder: 1, catg: "Ocular surface irritation — examine with fluorescein",
            sc: "Fluorescein + lid eversion to find a defect or FB.", ref: "Review if persistent; ophthalmology for infiltrate or non-healing defect.", mgmt: ["Stain every gritty painful eye with fluorescein and evert the lid before reassuring.", "Consider recurrent erosion if pain recurs on waking; refer if it does."] };
        }
      },
      /* ───────────── Stye / chalazion ───────────── */
      {
        id: "stye_chalazion", name: "Stye / chalazion",
        q: [
          { id: "acute_tender", label: "Acute tender lid-margin lump (hordeolum/stye)" }, { id: "chronic", label: "Chronic painless meibomian lump (chalazion)" },
          { id: "blepharitis", label: "Associated blepharitis / rosacea" }, { id: "recurrent", label: "Recurrent / same-site (?other lesion)" }
        ],
        danger: [
          { id: "spreading", label: "Spreading lid / periorbital cellulitis" },
          { id: "orbital", label: "Proptosis / painful restricted movements / reduced vision" }
        ],
        assess: function (sel) {
          if (has(sel, "orbital")) return { emergency: true, ladder: 3, catg: "Lid lesion with orbital signs — treat as orbital cellulitis",
            sc: "Do not manage as a simple stye — assess acuity, pupils and eye movements; urgent CT if orbital signs.", ref: "Emergency ophthalmology (± ENT). Admit for IV antibiotics.", mgmt: ["Proptosis, painful/restricted movements or reduced vision = orbital cellulitis pathway — escalate.", "See the orbital cellulitis syndrome."] };
          if (has(sel, "spreading")) return { emergency: false, ladder: 2, catg: "Stye with surrounding (preseptal) cellulitis",
            sc: "Warm compresses; incision/drainage or epilation of the involved lash follicle only if pointing.", ref: "Review; ophthalmology if orbital signs or not settling.", mgmt: ["Add an oral antibiotic per local guidance for the spreading cellulitis; safety-net for orbital signs.", "Most localised styes still need warm compresses, not systemic antibiotics."] };
          if (has(sel, "chronic")) return { emergency: false, ladder: 0, catg: "Chalazion — conservative",
            sc: "Warm compresses + lid massage; incision & curettage (or steroid injection) by ophthalmology only if persistent/large.", ref: "Routine ophthalmology if it persists > 4–6 weeks; biopsy recurrent same-site lesions (exclude sebaceous carcinoma).", mgmt: ["Antibiotics NOT indicated for a non-infected chalazion — warm compresses and lid hygiene are the mainstay.", "Treat any underlying blepharitis; refer persistent or atypical lumps."] };
          return { emergency: false, ladder: 0, catg: "Stye (hordeolum) — self-limiting",
            sc: "Warm compresses several times daily; let it drain spontaneously — do not squeeze.", ref: "Safety-net; review if spreading cellulitis or orbital signs.", mgmt: ["Antibiotics usually NOT indicated — warm compresses and lid hygiene resolve most styes.", "Consider topical antibiotic per local guidance only if actively discharging or associated conjunctivitis; treat underlying blepharitis."] };
        }
      },
      /* ───────────── Microbial keratitis / corneal ulcer ───────────── */
      {
        id: "microbial_keratitis", name: "Microbial keratitis / corneal ulcer",
        q: [
          { id: "contact_lens", label: "Contact-lens wear (esp. overnight / poor hygiene)" }, { id: "pain", label: "Severe pain / photophobia / watering" },
          { id: "infiltrate", label: "White corneal infiltrate / ulcer / epithelial defect" }, { id: "trauma", label: "Trauma / vegetative matter (fungal risk)" },
          { id: "vision", label: "Reduced vision / central lesion" }, { id: "immuno", label: "Immunocompromise / ocular surface disease" }
        ],
        danger: [
          { id: "hypopyon", label: "Hypopyon (pus in anterior chamber)" },
          { id: "perforation", label: "Corneal thinning / perforation / descemetocele" },
          { id: "scleral", label: "Spread to sclera / severe scleritis" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["perforation", "scleral"])) return { emergency: true, ladder: 5, catg: "⚠ Keratitis with perforation / scleral spread — globe-threatening",
            sc: "Emergency slit-lamp; corneal scrape for microscopy/culture; may need tissue glue / therapeutic keratoplasty for perforation.", ref: "Emergency (same-hour) ophthalmology / corneal specialist.", mgmt: ["Intensive topical fortified antibiotics per corneal protocol + protect the globe (shield, no pressure); admit.", "Do NOT patch a possibly-perforated eye; withhold steroid until organism known."] };
          if (anyOf(sel, ["infiltrate", "hypopyon"]) || (has(sel, "contact_lens") && has(sel, "pain"))) return { emergency: true, ladder: 4, catg: "Microbial keratitis / corneal ulcer — sight-threatening",
            sc: "Corneal scrape for Gram stain / KOH / culture BEFORE starting drops; slit-lamp; photograph the cornea for follow-up.", ref: "Same-day ophthalmology; admit if severe / central / hypopyon / poor compliance.", mgmt: ["Intensive topical fortified antibiotics per corneal protocol (very frequent initially) — defer exact agents to stewardship / local antibiogram; add antifungal cover if vegetative trauma / rural agrarian setting.", "Stop contact-lens wear, send lenses + case for culture; do NOT use topical steroid until organism identified and directed by specialist."] };
          return { emergency: false, ladder: 4, catg: "Suspected keratitis — needs urgent slit-lamp",
            sc: "Fluorescein + slit-lamp same day; scrape any infiltrate.", ref: "Same-day ophthalmology assessment.", mgmt: ["Any corneal infiltrate / ulcer is sight-threatening until assessed — do not treat blindly as conjunctivitis.", "Stop lens wear; withhold steroid; escalate if infiltrate, hypopyon or vision loss confirmed."] };
        }
      },
      /* ───────────── Herpes simplex / dendritic keratitis ───────────── */
      {
        id: "hsv_keratitis", name: "Herpes keratitis (HSV / HZO)",
        q: [
          { id: "dendrite", label: "Branching dendritic ulcer on fluorescein (HSV)" }, { id: "recurrent", label: "Recurrent unilateral red eye / cold-sore history" },
          { id: "reduced_sensation", label: "Reduced corneal sensation" }, { id: "hzo", label: "Vesicular rash in trigeminal V1 (shingles) / tip-of-nose (Hutchinson)" },
          { id: "on_steroid", label: "Recent topical steroid use (?steroid-driven flare)" }
        ],
        danger: [
          { id: "stromal", label: "Stromal / disciform oedema / keratouveitis (deep involvement)" },
          { id: "vision_loss", label: "Reduced vision / central scarring" },
          { id: "geographic", label: "Enlarging geographic ulcer (esp. after steroid)" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["stromal", "vision_loss", "geographic"])) return { emergency: true, ladder: 5, catg: "⚠ Herpetic stromal keratitis / keratouveitis / geographic ulcer — sight-threatening",
            sc: "Same-day slit-lamp; measure IOP; STOP any topical steroid the patient is on (it enlarges dendritic disease); combined antiviral ± carefully-monitored steroid is a SPECIALIST decision.", ref: "Emergency / same-day ophthalmology (corneal).", mgmt: ["Never add or continue a topical steroid without antiviral cover and specialist supervision — it turns a dendrite into a geographic ulcer.", "HZO with tip-of-nose (Hutchinson) vesicles predicts ocular involvement — start systemic antiviral per protocol and refer."] };
          if (has(sel, "hzo")) return { emergency: false, ladder: 2, catg: "Herpes zoster ophthalmicus (V1) — systemic antiviral + eye check",
            sc: "Full slit-lamp (cornea, IOP, uveitis); check for Hutchinson's sign.", ref: "Same-day ophthalmology if any ocular involvement; involve IM if immunocompromised / disseminated.", mgmt: ["Start SYSTEMIC antiviral early per local protocol (ideally within 72 h of rash) — defer agent/dose to stewardship.", "Examine the eye specifically: keratitis, uveitis and raised IOP can all occur; do NOT give topical steroid blindly."] };
          if (anyOf(sel, ["dendrite", "recurrent", "reduced_sensation", "on_steroid"])) return { emergency: false, ladder: 1, catg: "HSV epithelial (dendritic) keratitis",
            sc: "Fluorescein confirms the dendrite; gentle debridement by specialist optional; measure IOP.", ref: "Same-day / next-day ophthalmology to confirm and supervise.", mgmt: ["Treat with topical (± oral) antiviral per protocol — NOT a steroid; a red eye on steroid that is worsening is herpes until proven otherwise.", "The classic clue: unilateral recurrent red eye with reduced corneal sensation and a branching ulcer."] };
          return { emergency: false, ladder: 1, catg: "?Herpetic keratitis — confirm the pattern",
            sc: "Fluorescein to look for a dendrite; assess corneal sensation.", ref: "Ophthalmology to confirm before treatment.", mgmt: ["Do NOT give a topical steroid to any undiagnosed red/painful eye — herpes must be excluded first.", "Stain and examine; refer for confirmation and antiviral therapy."] };
        }
      },
      /* ───────────── Anterior uveitis (iritis) ───────────── */
      {
        id: "anterior_uveitis", name: "Anterior uveitis (iritis)",
        q: [
          { id: "pain", label: "Deep aching pain / photophobia" }, { id: "ciliary", label: "Ciliary (circumcorneal) flush" },
          { id: "vision", label: "Blurred vision / floaters" }, { id: "small_pupil", label: "Small / irregular pupil, poor reaction" },
          { id: "systemic", label: "Systemic association (HLA-B27, IBD, sarcoid, TB, HSV/HZO)" }, { id: "recurrent", label: "Recurrent / bilateral episodes" }
        ],
        danger: [
          { id: "hypopyon", label: "Hypopyon / severe fibrinous reaction" },
          { id: "vision_loss", label: "Significant vision loss" },
          { id: "hzo", label: "Herpetic (HSV/HZO) / dendritic ulcer — steroid caution" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["hypopyon", "vision_loss", "hzo"])) return { emergency: true, ladder: 5, catg: "Severe / complicated anterior uveitis — urgent",
            sc: "Same-day slit-lamp to grade the reaction and check IOP; exclude infective (herpetic / endophthalmitis) cause before steroid.", ref: "Emergency / same-day ophthalmology.", mgmt: ["Do NOT start topical steroid blindly — herpetic keratouveitis / infective cause must be excluded by specialist first (defer antivirals/steroid to ophthalmology).", "A dense hypopyon, especially post-op or post-injection, may be endophthalmitis — see that syndrome."] };
          return { emergency: false, ladder: 1, catg: "Anterior uveitis — specialist topical therapy",
            sc: "Slit-lamp to confirm anterior-chamber cells/flare, measure IOP; dilate to check posterior segment.", ref: "Ophthalmology referral (same day / next working day); investigate for systemic association if recurrent/bilateral/granulomatous.", mgmt: ["Treatment is topical steroid + cycloplegic PRESCRIBED AND MONITORED BY OPHTHALMOLOGY — not started blind (IOP and infective causes must be checked first).", "Look for and refer any systemic association (HLA-B27 spondyloarthropathy, IBD, sarcoid, TB, herpes) — co-manage with Internal Medicine / Rheumatology as needed."] };
        }
      },
      /* ───────────── Acute angle-closure glaucoma ───────────── */
      {
        id: "aacg", name: "Acute angle-closure glaucoma",
        q: [
          { id: "pain", label: "Sudden severe eye / brow pain" }, { id: "haloes", label: "Haloes around lights / blurred vision" },
          { id: "nausea", label: "Nausea / vomiting / headache" }, { id: "red", label: "Red eye + hazy (steamy) cornea" },
          { id: "pupil", label: "Fixed mid-dilated oval pupil" }, { id: "hard", label: "Hard eye on palpation / high IOP" }
        ],
        danger: [
          { id: "vision_loss", label: "Marked / progressive vision loss" },
          { id: "high_iop", label: "Very high IOP / rock-hard globe" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["pain", "haloes", "nausea", "pupil", "hard", "red", "vision_loss", "high_iop"])) return { emergency: true, ladder: 5, catg: "⚠ Acute angle-closure glaucoma — sight-threatening EMERGENCY",
            sc: "START IOP-LOWERING NOW, do not wait for referral: topical aqueous suppressants + systemic acetazolamide ± hyperosmotic per glaucoma protocol; lie patient flat (helps lens fall back); recheck IOP. Definitive laser/surgical iridotomy once eye is quiet.", ref: "Emergency ophthalmology NOW — treat while arranging.", mgmt: ["First action is to LOWER THE PRESSURE immediately — irreversible optic-nerve damage occurs within hours; defer exact agents to Drug Index / specialist.", "Avoid pupil dilation and anticholinergics; treat pain/vomiting; the FELLOW eye is also at risk — arrange prophylactic iridotomy."] };
          return { emergency: false, ladder: 0, catg: "Angle-closure features absent / incomplete — reassess",
            sc: "Measure IOP and examine anterior-chamber depth; slit-lamp.", ref: "Ophthalmology if any red-flag feature appears.", mgmt: ["A sudden painful red eye with haloes, nausea/vomiting or a fixed mid-dilated pupil is an emergency — escalate and start IOP-lowering.", "Do NOT dilate the pupil if angle closure is suspected."] };
        }
      },
      /* ───────────── Endophthalmitis ───────────── */
      {
        id: "endophthalmitis", name: "Endophthalmitis",
        q: [
          { id: "post_op", label: "Recent intraocular surgery (esp. cataract, days–weeks)" }, { id: "injection", label: "Recent intravitreal injection" },
          { id: "penetrating", label: "Penetrating trauma / retained intraocular FB" }, { id: "pain_vision", label: "Increasing pain + rapidly dropping vision" },
          { id: "endogenous", label: "Sepsis / IV drug use / candidaemia (endogenous seeding)" }
        ],
        danger: [
          { id: "hypopyon", label: "Hypopyon / severe intraocular inflammation" },
          { id: "no_red_reflex", label: "Loss of red reflex / vitritis / no fundal view" },
          { id: "hand_movements", label: "Vision reduced to hand movements / light perception" }
        ],
        assess: function () {
          return { emergency: true, ladder: 4, catg: "⚠ Endophthalmitis — sight-threatening ocular emergency (assume until excluded)",
            sc: "SAME-HOUR vitreous tap + INTRAVITREAL antibiotics is the definitive treatment (± vitrectomy) — this is the priority procedure; send aqueous/vitreous for microscopy & culture. Do not merely start drops and wait.", ref: "Emergency ophthalmology / vitreoretinal NOW.", mgmt: ["Any post-operative or post-injection eye with pain + falling vision + hypopyon is endophthalmitis until proven otherwise — refer within the hour; delay costs the eye.", "Intravitreal antibiotics per vitreoretinal protocol are the treatment — topical/systemic alone are inadequate; add antifungal cover and treat the source if endogenous (blood cultures, IM)."] };
        }
      },
      /* ───────────── Sudden painless vision loss ───────────── */
      {
        id: "sudden_vision_loss", name: "Sudden painless vision loss",
        q: [
          { id: "curtain", label: "Curtain/shadow + new flashes & floaters (retinal detachment)" }, { id: "floaters_haem", label: "Sudden floaters / haze, poor fundal view (vitreous haemorrhage)" },
          { id: "altitudinal", label: "Sudden field loss; ?GCA (headache, jaw claudication, scalp tenderness)" }, { id: "transient", label: "Transient (amaurosis fugax) — recovered" },
          { id: "diabetic", label: "Diabetes / on anticoagulant / known retinopathy" }
        ],
        danger: [
          { id: "crao", label: "Profound sudden painless loss + RAPD (central retinal artery occlusion)" },
          { id: "rapd", label: "Relative afferent pupillary defect (RAPD)" },
          { id: "macula_threat", label: "Central vision recently lost / macula threatened" }
        ],
        assess: function (sel) {
          if (has(sel, "crao")) return { emergency: true, ladder: 5, catg: "⚠ Central retinal artery occlusion — a STROKE of the eye (hyperacute)",
            sc: "Within the window try immediate measures: ocular massage, lower IOP (anterior-chamber paracentesis / IOP-lowering agents) per protocol — but do NOT delay stroke pathway. Urgent ESR/CRP to exclude giant cell arteritis.", ref: "Emergency ophthalmology + acute STROKE pathway (it is a retinal stroke — image the brain/carotids, assess for thrombolysis window).", mgmt: ["Treat as a stroke: same-day neurovascular workup (carotids, heart, vascular risk); a preceding amaurosis fugax is a warning that must be acted on.", "In the elderly, exclude giant cell arteritis (ESR/CRP, temporal symptoms) — high-dose steroid per protocol saves the fellow eye if GCA."] };
          if (has(sel, "curtain") || (has(sel, "macula_threat") && !anyOf(sel, ["floaters_haem", "altitudinal"]))) return { emergency: true, ladder: 4, catg: "Retinal detachment — flashes, floaters, curtain (urgent surgical)",
            sc: "Dilated fundoscopy / B-scan; surgical repair (laser, cryo, vitrectomy or buckle) is the treatment, urgency set by whether the MACULA is still on.", ref: "Same-day (macula-on = emergency) vitreoretinal referral.", mgmt: ["'Macula-on' detachment is time-critical — refer the SAME DAY before central vision is lost; posture the patient as advised.", "New flashes + a shower of floaters + a curtain is detachment until excluded — never reassure without a dilated retinal exam."] };
          if (has(sel, "altitudinal")) return { emergency: true, ladder: 5, catg: "⚠ Sudden field loss — exclude giant cell arteritis / ischaemic optic neuropathy",
            sc: "Immediate ESR, CRP (± platelets); check for RAPD, pale swollen disc.", ref: "Emergency ophthalmology; if GCA suspected start high-dose systemic steroid per protocol WITHOUT waiting for temporal-artery biopsy.", mgmt: ["GCA is an emergency — untreated, the fellow eye can be lost within days; do not delay steroid for the biopsy.", "Ask directly about jaw claudication, scalp tenderness, temporal headache and polymyalgia; co-manage with IM/Rheumatology."] };
          if (has(sel, "floaters_haem")) return { emergency: false, ladder: 4, catg: "Vitreous haemorrhage — urgent, exclude underlying tear/detachment",
            sc: "B-scan ultrasound if no fundal view to exclude an underlying retinal tear/detachment.", ref: "Urgent (same-day / next-day) ophthalmology.", mgmt: ["The clot is not the danger — the danger is a retinal tear/detachment hiding behind it; needs a retinal assessment.", "Common in proliferative diabetic retinopathy and on anticoagulants — check glucose, BP and clotting."] };
          if (has(sel, "transient")) return { emergency: true, ladder: 5, catg: "Transient monocular vision loss (amaurosis fugax) — a warning TIA",
            sc: "No ocular procedure — this is vascular; urgent carotid/cardiac workup.", ref: "Urgent TIA/stroke pathway + ophthalmology; exclude GCA (ESR/CRP) in the elderly.", mgmt: ["Treat like a TIA — it heralds stroke or retinal artery occlusion; start secondary prevention per stroke protocol.", "Do not dismiss recovered vision loss as benign."] };
          return { emergency: true, ladder: 5, catg: "Sudden vision loss — same-day sight-threatening triage",
            sc: "Check acuity, pupils (RAPD), fundus; ESR/CRP if elderly.", ref: "Emergency / same-day ophthalmology.", mgmt: ["Any sudden vision loss is an emergency until a cause is excluded — check pupils for an RAPD and examine the fundus.", "Painless: think vascular (artery/vein occlusion), detachment, vitreous haemorrhage, ischaemic optic neuropathy/GCA."] };
        }
      },
      /* ───────────── Orbital vs preseptal cellulitis ───────────── */
      {
        id: "orbital_cellulitis", name: "Orbital vs preseptal cellulitis",
        q: [
          { id: "lid_swelling", label: "Lid swelling / erythema / warmth" }, { id: "sinusitis", label: "Preceding sinusitis / URTI" },
          { id: "trauma", label: "Trauma / insect bite / local skin source" }, { id: "fever", label: "Fever / systemic upset" },
          { id: "child", label: "Child / immunocompromise" }, { id: "no_orbital", label: "Full painless eye movements, normal vision, no proptosis" }
        ],
        danger: [
          { id: "proptosis", label: "Proptosis / displaced globe" },
          { id: "ophthalmoplegia", label: "Painful or restricted eye movements / diplopia" },
          { id: "vision", label: "Reduced acuity / RAPD / colour desaturation" },
          { id: "intracranial", label: "Altered sensorium / neuro signs / bilateral (cavernous sinus)" }
        ],
        assess: function (sel) {
          if (has(sel, "intracranial")) return { emergency: true, ladder: 5, catg: "⚠ Orbital cellulitis with suspected intracranial / cavernous-sinus spread",
            sc: "URGENT contrast CT/MRI orbits, sinuses + brain; surgical drainage of orbital/subperiosteal abscess + sinus source control if collection.", ref: "Emergency OPHTHALMOLOGY (primary) + ENT for sinus drainage + NEUROSURGERY co-management. Admit.", mgmt: ["Admit for IV broad-spectrum antibiotics per local antibiogram/ICMR immediately — sight- and life-threatening.", "Co-managed: Ophthalmology leads the orbit/vision, ENT addresses the sinus source, Neurosurgery for intracranial extension / cavernous sinus thrombosis."] };
          if (anyOf(sel, ["proptosis", "ophthalmoplegia", "vision"])) return { emergency: true, ladder: 3, catg: "⚠ Orbital (post-septal) cellulitis — sight-threatening",
            sc: "URGENT contrast CT orbits + sinuses to identify subperiosteal / orbital abscess; drainage + sinus source control by ENT if collection or no response.", ref: "Emergency OPHTHALMOLOGY (primary) + ENT co-management. Admit today.", mgmt: ["Admit for IV broad-spectrum antibiotics per local protocol/ICMR now; monitor vision, pupil (RAPD), colour and eye movements closely.", "Proptosis, painful/restricted movements or reduced acuity define ORBITAL disease — this is NOT preseptal; ENT co-manages the sinus source (do NOT flag Internal Medicine as primary)."] };
          if (has(sel, "no_orbital")) return { emergency: false, ladder: 2, catg: "Preseptal (periorbital) cellulitis — no orbital signs",
            sc: "No procedure; image (CT) only if orbital signs appear, fails to improve, or in young children where exam is unreliable.", ref: "Ophthalmology / paediatric review; safety-net and close review (24 h).", mgmt: ["Oral antibiotic per local guidance with CLOSE review; lower threshold to admit children and the immunocompromised.", "Recheck for proptosis, painful/restricted movements or reduced acuity — any of these = orbital cellulitis → admit for IV therapy + imaging."] };
          return { emergency: false, ladder: 2, catg: "Periorbital inflammation — assess the orbit carefully",
            sc: "Examine acuity, pupils, colour vision and eye movements to separate preseptal from orbital; image if any doubt.", ref: "Ophthalmology review; admit and image if any orbital sign.", mgmt: ["Actively look for proptosis, ophthalmoplegia or reduced vision — presence upgrades to orbital cellulitis (IV antibiotics + urgent CT + ENT).", "If clearly preseptal: oral antibiotic per local guidance with close review."] };
        }
      },
      /* ───────────── Chemical (ocular) injury ───────────── */
      {
        id: "chemical_injury", name: "Chemical / caustic eye injury",
        q: [
          { id: "alkali", label: "Alkali splash (lime, cement, ammonia, drain cleaner)" }, { id: "acid", label: "Acid splash" },
          { id: "pain", label: "Pain / burning / blepharospasm / watering" }, { id: "particulate", label: "Retained particulate / lime powder in fornices" }
        ],
        danger: [
          { id: "opaque", label: "Corneal haze / opacity" },
          { id: "blanch", label: "Limbal / perilimbal blanching (ischaemia)" },
          { id: "vision_loss", label: "Reduced vision" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["opaque", "blanch", "vision_loss", "alkali"])) return { emergency: true, ladder: 5, catg: "⚠ Chemical eye injury with corneal/limbal involvement (alkali = worst)",
            sc: "IRRIGATE IMMEDIATELY AND COPIOUSLY with saline/water BEFORE any assessment — do not wait; instil topical anaesthetic to allow it, evert lids and sweep out particulate; continue until pH neutral (7.0–7.5) and rechecks stay neutral.", ref: "Emergency ophthalmology — but irrigation starts NOW, before referral or examination.", mgmt: ["Irrigation is the first and most important treatment — nothing precedes it, not even acuity testing. Alkali penetrates deeply → limbal ischaemia and perforation.", "After irrigation and stable pH: specialist assessment, topical antibiotic prophylaxis + measures to promote healing per corneal protocol; measure IOP."] };
          return { emergency: true, ladder: 4, catg: "Chemical eye exposure — irrigate first",
            sc: "IMMEDIATE copious irrigation with saline/water and lid eversion to remove particulate, BEFORE anything else; check pH and continue irrigating until neutral and stable.", ref: "Urgent ophthalmology after irrigation started.", mgmt: ["Do not delay irrigation to take a history or examine — copious lavage is the priority for ALL chemical exposures.", "Reassess vision, cornea and limbal perfusion after irrigation; escalate to emergency if any corneal haze or limbal blanching appears."] };
        }
      }
    ]
  };

  window.SMD_WS_ENGINES = window.SMD_WS_ENGINES || {};
  window.SMD_WS_ENGINES.ophthalmology = OPHTHAL;
})();
