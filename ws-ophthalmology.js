/* StewardMD — Ophthalmology specialty engine.
   ---------------------------------------------------------------------------
   Registers into window.SMD_WS_ENGINES.ophthalmology, consumed by workspaces.js. A
   LIGHTWEIGHT specialty pathway — NOT the Internal Medicine engine and NOT a
   diagnosis generator. For each syndrome it collects focused findings + danger
   signs and returns a conservative MANAGEMENT DECISION: the antibiotic/treatment-
   need level (0 none → 5 emergency referral), whether SOURCE CONTROL / a procedure
   (irrigation, corneal scrape, IOP-lowering, abscess drainage) is required, and the
   referral/escalation. Actual drug choice is deferred to the existing stewardship
   engine / Drug Index / local antibiogram + ICMR (never prescribed here).

   The recurring ophthalmology theme is that MANY acute red eyes are self-limiting
   (viral / allergic conjunctivitis, stye — antibiotics NOT indicated) — the engine's
   job is to separate those from the true SIGHT- or LIFE-threatening red flags:
   microbial keratitis, acute angle-closure glaucoma, anterior uveitis, chemical
   injury and orbital cellulitis. Contact-lens wearers with a red painful eye are
   treated as keratitis risk until proven otherwise. Orbital cellulitis is co-managed
   — the notes flag ENT (± neurosurgery) involvement; ophthalmology remains primary
   (this is NOT an Internal-Medicine-primary shared condition).

   Advisory only. Verify against local protocol, slit-lamp exam, and the individual patient. */
(function () {
  "use strict";
  // ladder index → matches ABX/management ladder in workspaces.js
  // 0 none · 1 topical/local · 2 oral · 3 IV/admission · 4 urgent procedure/source control · 5 emergency referral
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
            sc: "Same-day slit-lamp + fluorescein; corneal scrape for microscopy/culture if an infiltrate is present (do NOT dismiss as simple conjunctivitis).", ref: "Same-day ophthalmology assessment.", mgmt: ["A contact-lens wearer with a red painful eye, or any reduced vision / corneal infiltrate, is NOT simple conjunctivitis — escalate.", "Stop lens wear; do not patch; withhold topical steroid until keratitis excluded by specialist."] };
          if (has(sel, "neonate") || has(sel, "hyperacute")) return { emergency: has(sel, "hyperacute"), ladder: 3, catg: "Neonatal / hyperacute (?gonococcal or chlamydial) conjunctivitis",
            sc: "Urgent conjunctival swabs (Gram stain, culture, chlamydia NAAT) before/at treatment; saline lavage of discharge.", ref: "Urgent ophthalmology + paediatric/IM review; notifiable — trace and treat partners/mother.", mgmt: ["Gonococcal risk = corneal-perforation risk: systemic antibiotic per local protocol/ICMR, not topical alone — defer agent to stewardship.", "Screen for concurrent chlamydia/other STI; involve the appropriate specialty."] };
          if (has(sel, "purulent")) return { emergency: false, ladder: 1, catg: "Likely bacterial conjunctivitis (mild)",
            sc: "No procedure; swab only if severe, recurrent or not settling.", ref: "Safety-net; review if vision drops, pain or photophobia develop.", mgmt: ["Most bacterial conjunctivitis is self-limiting — hygiene + lubricants first; a topical antibiotic per local guidance is optional and speeds resolution.", "Lid hygiene, avoid towel-sharing; no antibiotic needed if mild and improving."] };
          return { emergency: false, ladder: 0, catg: "Viral / allergic conjunctivitis — self-limiting",
            sc: "No procedure.", ref: "Safety-net for red flags (reduced vision, pain, photophobia, infiltrate).", mgmt: ["Antibiotics NOT indicated — supportive care only: cool compresses, lubricants; topical antihistamine/mast-cell stabiliser for allergic per local guidance.", "Viral is highly contagious — strict hand/towel hygiene; usually self-limiting over 1–2 weeks."] };
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
            sc: "Corneal scrape for Gram stain / KOH / culture BEFORE starting drops; slit-lamp; cornea photo for follow-up.", ref: "Same-day ophthalmology; admit if severe / central / hypopyon / poor compliance.", mgmt: ["Intensive topical fortified antibiotics per corneal protocol (hourly initially) — defer exact agents to stewardship / local antibiogram; consider antifungal if vegetative trauma.", "Stop contact-lens wear, send lenses+case for culture; do NOT use topical steroid until organism identified and directed by specialist."] };
          return { emergency: false, ladder: 4, catg: "Suspected keratitis — needs urgent slit-lamp",
            sc: "Fluorescein + slit-lamp same day; scrape any infiltrate.", ref: "Same-day ophthalmology assessment.", mgmt: ["Any corneal infiltrate / ulcer is sight-threatening until assessed — do not treat blindly as conjunctivitis.", "Stop lens wear; withhold steroid; escalate if infiltrate, hypopyon or vision loss confirmed."] };
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
          { id: "high_iop", label: "Very high IOP (> 40 mmHg) / firm globe" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["pain", "haloes", "nausea", "pupil", "hard", "red", "vision_loss", "high_iop"])) return { emergency: true, ladder: 5, catg: "⚠ Acute angle-closure glaucoma — sight-threatening EMERGENCY",
            sc: "URGENT IOP-lowering therapy now, then definitive iridotomy/iridectomy (laser or surgical) once the eye is quiet; measure IOP, lie patient flat.", ref: "Emergency ophthalmology NOW — do not delay.", mgmt: ["Start urgent IOP-lowering therapy (topical + systemic aqueous suppressants ± hyperosmotic) per local glaucoma protocol — defer exact agents to Drug Index / specialist.", "Avoid pupil dilation and anticholinergics; treat pain/vomiting; both eyes at risk — arrange prophylactic iridotomy to the fellow eye."] };
          return { emergency: false, ladder: 0, catg: "Angle-closure features absent / incomplete — reassess",
            sc: "Measure IOP and examine the anterior chamber depth; slit-lamp.", ref: "Ophthalmology if any red-flag feature appears.", mgmt: ["If sudden painful red eye with haloes, nausea or a fixed mid-dilated pupil develops, treat as an emergency and escalate immediately.", "Do not dilate the pupil if angle closure is suspected."] };
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
          { id: "hzo", label: "Herpes zoster ophthalmicus / dendritic ulcer (steroid caution)" }
        ],
        assess: function (sel) {
          if (anyOf(sel, ["hypopyon", "vision_loss", "hzo"])) return { emergency: true, ladder: 5, catg: "Severe / complicated anterior uveitis — urgent",
            sc: "Same-day slit-lamp to grade the reaction and check IOP; exclude infective (herpetic/endophthalmitis) cause before steroid.", ref: "Emergency / same-day ophthalmology.", mgmt: ["Do NOT start topical steroid blindly — herpetic keratouveitis / infective cause must be excluded by specialist first (defer antivirals/steroid to ophthalmology).", "Cycloplegic for comfort/synechiae per specialist; escalate if hypopyon or vision loss."] };
          return { emergency: false, ladder: 1, catg: "Anterior uveitis — specialist topical therapy",
            sc: "Slit-lamp to confirm anterior-chamber cells/flare, measure IOP; dilate to check posterior segment.", ref: "Ophthalmology referral (same day / next working day); investigate for systemic association if recurrent/bilateral/granulomatous.", mgmt: ["Treatment is topical steroid + cycloplegic PRESCRIBED AND MONITORED BY OPHTHALMOLOGY — not started blind (IOP and infective causes must be checked first).", "Look for and refer any systemic association (HLA-B27 spondyloarthropathy, IBD, sarcoid, TB, herpes) — co-manage with Internal Medicine/Rheumatology as needed."] };
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
            sc: "URGENT contrast CT orbits + sinuses to identify subperiosteal / orbital abscess; drainage + sinus source control by ENT if collection or no response.", ref: "Emergency OPHTHALMOLOGY (primary) + ENT co-management. Admit today.", mgmt: ["Admit for IV broad-spectrum antibiotics per local protocol/ICMR now; monitor vision, pupil (RAPD), colour and eye movements 4-hourly.", "Proptosis, painful/restricted movements or reduced acuity define ORBITAL disease — this is NOT preseptal; ENT co-manages the sinus source (do NOT flag Internal Medicine as primary)."] };
          if (has(sel, "no_orbital")) return { emergency: false, ladder: 2, catg: "Preseptal (periorbital) cellulitis — no orbital signs",
            sc: "No procedure; image (CT) only if orbital signs appear, fails to improve, or in young children where exam is unreliable.", ref: "Ophthalmology / paediatric review; safety-net and close review (24 h).", mgmt: ["Oral antibiotic per local guidance with CLOSE review; lower threshold to admit children and immunocompromised.", "Recheck for proptosis, painful/restricted movements or reduced acuity — any of these = orbital cellulitis → admit for IV therapy + imaging."] };
          return { emergency: false, ladder: 2, catg: "Periorbital inflammation — assess orbit carefully",
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
            sc: "IRRIGATE IMMEDIATELY AND COPIOUSLY with saline/water BEFORE any assessment — do not wait; evert lids and sweep out particulate; continue until pH neutral (7.0–7.5) and rechecks stay neutral.", ref: "Emergency ophthalmology — but irrigation starts NOW, before referral or examination.", mgmt: ["Irrigation is the first and most important treatment — nothing precedes it. Alkali penetrates deeply → limbal ischaemia and perforation.", "After irrigation: specialist assessment, topical antibiotic prophylaxis + measures to promote healing per corneal protocol; measure IOP."] };
          return { emergency: true, ladder: 4, catg: "Chemical eye exposure — irrigate first",
            sc: "IMMEDIATE copious irrigation with saline/water and lid eversion to remove particulate, BEFORE anything else; check pH and continue irrigating until neutral and stable.", ref: "Urgent ophthalmology after irrigation started.", mgmt: ["Do not delay irrigation to take a history or examine — copious lavage is the priority for ALL chemical exposures.", "Reassess vision, cornea and limbal perfusion after irrigation; escalate to emergency if any corneal haze or limbal blanching appears."] };
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
          { id: "spreading", label: "Spreading lid/periorbital cellulitis" },
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
      }
    ]
  };

  window.SMD_WS_ENGINES = window.SMD_WS_ENGINES || {};
  window.SMD_WS_ENGINES.ophthalmology = OPHTHAL;
})();
