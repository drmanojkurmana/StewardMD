# CliniX visual asset requests

Process (per owner instruction, 2026-08-23): for each lesson, first look for a real, legally
usable medical image/illustration/video/GIF (open licence, or an embeddable YouTube video verified
via oEmbed). If nothing suitable exists, do NOT fill the slot with a generic/AI/low-quality image —
log it here with a `CLX-Vnnn` id and keep building. When the owner supplies an asset for an id,
wire it into every skill/media entry that references that id.

Status key: `OPEN` (no asset yet, self-authored SVG placeholder in use where noted) · `FILLED`
(a real asset — owner-supplied, or a verified Wikimedia Commons hotlink — is now wired in).

**A real image beats a self-authored SVG whenever a good one exists** — check Wikimedia Commons
first (`site:commons.wikimedia.org <topic>`), and only fall back to a self-drawn diagram for a
genuinely abstract/mechanism concept (a flow-volume graph, a "why this happens" cartoon) that
isn't a photographable thing in the first place. A candidate Commons file must be verified through
Commons' own API before it can render — a human-read summary of a Commons page is not enough
diligence:
```
curl "https://commons.wikimedia.org/w/api.php?action=query&titles=File:<name>&prop=imageinfo&iiprop=extmetadata|url&format=json"
```
Confirms the real licence + author straight from the source, the same rigor as the oEmbed check
already used for YouTube videos. Wire the result in as `kind:"image"`, `cleared:true`,
`commonsVerified:true`, `src` (the `upload.wikimedia.org` URL from the API — never re-hosted),
`sourceUrl` (the `commons.wikimedia.org/wiki/File:...` page), `licence`, `attribution` — see
`clinix-model.js`'s `isCommonsVerified()`. A hosted image missing `commonsVerified` will not
render (enforced by `test/clinix-content.test.mjs` and `test/clinix-model.test.mjs`), so a
sourcing shortcut fails loudly rather than shipping unverified.

---

## CLX-V001 — Liver palpation, preferred (bimanual) method — **FILLED** (2026-08-23, owner-produced)
Owner supplied a real photo of the bimanual grip below the right costal margin. Saved as
`clinix-liver-palpation.jpg`, wired as `media.gi.liver.bimanual` on `skill.exam.gi.liver`,
alongside the existing full-exam video and self-authored SVG.

## CLX-V001-original — Liver palpation, preferred (bimanual) method (superseded id above)
- **Clinical context:** `skill.exam.gi.liver`, CliniX abdomen module.
- **Must show:** examiner's two hands flat on the abdomen below the right costal margin, fingers
  pointing towards the ribs, palpating as the patient takes a deep breath — the edge meeting the
  fingertips on inspiration, hand staying still (not chasing the edge down).
- **Preferred format:** short looping video/GIF (5-10s) or a clean annotated photo/illustration
  sequence (2-3 frames: hands placed → breath in → edge contact).
- **Where it appears:** `media.dia.liverpalp`, first "show" turn of the liver-examination lesson.
- **Current placeholder:** self-authored inline SVG (`diagram.liverpalp` in clinix-diagrams.js) —
  functional but schematic, not a real demonstration. A real video already covers the FULL
  technique end to end (`media.vid.liverexam`, AMBOSS, oEmbed-verified) and plays as the closing
  turn; this id is for a tighter clip/image of the bimanual grip specifically, shown up front.
- **Status:** OPEN

## CLX-V002 — Spleen palpation, direction of enlargement
- **Clinical context:** `skill.exam.gi.spleen`.
- **Must show:** the diagonal line a spleen enlarges along, from the left costal margin towards
  the umbilicus and right iliac fossa — ideally overlaid on a torso outline or line diagram, not a
  live photo (this is an anatomical/conceptual point, not a technique to imitate).
- **Preferred format:** clean medical illustration (open licence) or a short animated diagram.
- **Where it appears:** `media.dia.spleenpalp`, first "show" turn of the spleen-examination lesson.
- **Current placeholder:** self-authored inline SVG (`diagram.spleenpalp`). A real technique video
  already covers the palpation + percussion methods end to end (`media.vid.spleenexam`, AMBOSS,
  oEmbed-verified).
- **Status:** OPEN

## CLX-V003 — Nine regions of the abdomen — **FILLED** (2026-08-23)
Replaced the self-authored schematic with a real illustration: OpenStax's "Abdominal Regions
English.jpg" (CC BY 3.0), hotlinked from Wikimedia Commons (`media.img.abdregions`), verified via
the Commons API. Now the primary image on `skill.exam.gi.inspection`.

## CLX-V007 — Cardiac auscultation areas, labelled — **FILLED** (2026-08-23)
Replaced with "Heart sounds auscultation areas.svg" (public domain, after Gray's Anatomy 1918),
hotlinked (`media.img.auscultareas`), verified via the Commons API. Now the primary image on
`skill.exam.cvs.heartsounds`, alongside the existing oEmbed technique video.

## CLX-V008 — JVP waveform synced to the cardiac cycle — **FILLED** (2026-08-23)
Replaced with the Wiggers diagram + jugular venous waveform composite (CC BY-SA 4.0), hotlinked
(`media.img.jvpwave`), verified via the Commons API. Shows the a/c/x/v/y waveform against chamber
pressures, LV volume and the ECG — matches the teach block's prose exactly. Primary image on
`skill.exam.cvs.jvp`.

## CLX-V012 — Dermatome map — **FILLED** (2026-08-23)
Replaced with Ralf Stephan's public-domain dermatome map, hotlinked (`media.img.dermatomes`),
verified via the Commons API. Primary image on `skill.exam.neuro.sensory`.

## CLX-V004 — Barrel chest, side-on comparison — **FILLED** (2026-08-23, owner-produced)
Owner supplied an illustration (normal vs. barrel chest side profiles + matched CT cross-sections
showing the AP:transverse diameter measurement) — not sourced from Wikimedia, so cleared via the
new `ownerProduced` path (`clinix-model.js` `isOwnerProduced()`) rather than Commons verification:
owner-captured/produced content has no third party to check a licence against, the same reason a
self-authored diagram always clears. Saved as `clinix-barrelchest.jpg` (repo root, same pattern as
`clinix-logo.png`), registered as `media.resp.inspection.barrel` (this id already existed as an
open placeholder — filled in place rather than creating a new one), shown alongside the original
self-authored SVG (`media.dia.barrel`), per "keep both".

## CLX-NEW-002 — Superficial and deep palpation of the abdomen — **FILLED** (2026-08-23)
Owner supplied a YouTube video (oEmbed-verified, HTTP 200): "Abdominal Examination - OSCE Guide
(Latest)", Geeky Medics. Wired in as `media.vid.abdpalpation` on `skill.exam.gi.palpation`, which
previously had no media at all.

## CLX-V005 — Clubbing and the Schamroth window — **FILLED** (2026-08-23)
Replaced the self-authored SVG with a real photo of a POSITIVE Schamroth's window (the diamond
gap obliterated) by Rollcloud (CC BY 3.0), hotlinked (`media.img.clubbing`), verified via the
Commons API. Primary image on `skill.gen.clubbing`.

---

**Diagrams intentionally NOT flagged above** (self-authored SVG is the right call, not a
placeholder gap): `media.dia.flowvolume` (an abstract flow-volume graph — inherently a diagram,
not a photographable thing), `media.dia.airtrapping` (a mechanism cartoon of small-airway
collapse), `media.dia.effusionshift` (a mechanism diagram of mediastinal shift), `media.dia.breathing`
(a comparative rate/pattern graph). `media.dia.percussion` (zone map) and `media.dia.trachea`
(landmark map) are interactive maps, not technique demonstrations — real technique for both is
already covered by the full-exam video `media.vid.respexam`. `media.dia.percussiontech`,
`media.dia.expansion`, and `media.dia.hoover` are techniques already demonstrated in that same
end-to-end video; a dedicated clip would be a nice-to-have, not a gap, so not logged here.

Nothing in the abdomen chapter beyond CLX-V001–003 currently needs an entry: `skill.exam.gi.auscultation`,
`skill.exam.gi.palpation`, `skill.exam.gi.gallbladder_kidney`, and `skill.exam.gi.ascites` have no
media attached yet at all (not even a placeholder) — flag before writing new teach content for
them, rather than defaulting to another self-authored SVG.

## CLX-V006 — BP cuff placement and sizing — **FILLED** (2026-08-23, owner-produced)
Owner supplied a comprehensive infographic (cuff placement, correct/incorrect examples, arm
circumference to cuff size chart). Saved as `clinix-bpcuff.jpg`, wired as `media.cvs.bp.cuff` on
`skill.exam.cvs.bp`.

## CLX-V007 — Cardiac auscultation areas, labelled
- **Clinical context:** `skill.exam.cvs.heartsounds`.
- **Must show:** the 5 standard auscultation areas (mitral/tricuspid/aortic/pulmonary/Erb's) plus
  the extra listening points (axilla, epigastrium, carotids, back) on a chest outline.
- **Preferred format:** static labelled diagram. A real technique video already exists for this
  skill (`media.vid.auscultareas`, Medzcool, oEmbed-verified) — this id is for the site MAP, not
  the technique.
- **Where it appears:** heart-sounds lesson, alongside the auscultation-route teach block.
- **Status:** OPEN

## CLX-V008 — JVP waveform synced to the cardiac cycle
- **Clinical context:** `skill.exam.cvs.jvp`.
- **Must show:** the normal a/c/x/v/y waveform against S1/S2, plus abnormal patterns (absent a,
  giant a, cannon a waves, giant v waves) for comparison.
- **Preferred format:** static diagram, or a short looping animation if available.
- **Where it appears:** JVP lesson, waveform-interpretation teach block.
- **Status:** OPEN

## CLX-V009 — Six cardinal gaze positions — **FILLED** (2026-08-23, owner-produced)
Owner supplied the H-pattern diagram, muscle + nerve labelled at each of the 6 positions. Saved
as `clinix-gazepositions.jpg`, wired as `media.neuro.cn346.gaze` on `skill.exam.neuro.cn3_4_6`.

## CLX-V010 — Trigeminal sensory divisions and onion-skin pattern — **FILLED** (2026-08-23, owner-produced)
Owner supplied two complementary comprehensive infographics (divisions/branches/nuclei/tracts,
and divisions/motor component/intraoral supply) plus a technique panel for the CN V motor exam
and corneal reflex. Saved as `clinix-trigeminal-a.jpg`, `clinix-trigeminal-b.jpg`,
`clinix-cn5-motor-corneal.jpg`, wired on `skill.exam.neuro.cn5`.

## CLX-V011 — Rinne's and Weber's tuning-fork technique — **FILLED** (2026-08-24)
oEmbed-verified video (Geeky Medics): `media.vid.rinneweber`, on `skill.exam.neuro.cn8`.

## CLX-V012 — Dermatome map — **FILLED** (already, tracker was stale)
`media.img.dermatomes` on `skill.exam.neuro.sensory`.

## CLX-V013 — Named gait patterns, reference video — **FILLED** (already, tracker was stale)
`media.vid.gaitex` on `skill.exam.neuro.gait`.

---

Cardiovascular and Neurology just landed at full depth (11 and 15 skills respectively, up from 7
and 3), each with real oEmbed-verified demonstration videos wired in where a good one existed
(JVP, auscultation areas, parasternal heave/thrills, cranial nerve overview, cerebellar exam,
GCS, meningeal signs). CLX-V006–013 above are the gaps their authors found and declined to fill
with another self-authored placeholder.

## The top-5 long/short cases (2026-08-23) — filled where a real asset existed
21 new disease pathways landed across Respiratory/Cardiovascular/Abdomen/Neurology. Four items
found by the build agents were re-verified and wired in immediately rather than logged as
requests: a Commons-verified splinter-haemorrhage photo (`media.img.splinterhem`, public domain,
on `skill.exam.ie.stigmata`), and three oEmbed-verified videos — Parkinsonian gait
(`media.vid.pdgait`), the NIH Stroke Scale demonstration (`media.vid.nihss`), and Guillain-Barre
syndrome (`media.vid.gbs`). Everything else the agents searched for and could not verify is
logged below.

## CLX-V014 — Consolidation triad (percussion/auscultation/vocal resonance)
- **Clinical context:** Pneumonia disease-findings, `skill.pneumonia.signs`.
- **Must show:** the dull-percussion / bronchial-breathing / increased-vocal-resonance triad over
  a consolidated lobe, ideally side-by-side with the normal finding.
- **Preferred format:** diagram or short video.
- **Status:** OPEN (searched 2026-08-24 - no Commons diagram or on-topic video exists; the only
  video candidate found was a generic percussion/auscultation technique clip, functionally
  redundant with media.vid.respexam already on the shared skill. This concept is abstract
  (a comparison, not a single photographable thing) and likely needs a self-authored diagram,
  same as media.dia.percussion.)

## CLX-V015 — Acute severe asthma: wheeze vs the silent chest
- **Clinical context:** Bronchial asthma disease-findings, `skill.asthma.signs`.
- **Must show:** the contrast between a wheezy, distressed chest and a dangerously silent one
  (airflow too low to make a sound) — an audio pair would work as well as video.
- **Preferred format:** audio or video pair.
- **Status:** OPEN (searched 2026-08-24 - individual wheeze clips exist and are oEmbed-verifiable,
  but nothing pairs wheeze against a genuine silent-chest recording, which is the actual point.)

## CLX-V016 — External markers of tuberculosis — **FILLED, 3 of 4 markers** (2026-08-24)
Commons-verified: erythema nodosum (`media.img.erythemanodosum`, CC BY 3.0, Biswarup Ganguly),
scrofuloderma (`media.img.scrofuloderma`, CC BY-SA 4.0, Mohammad2018), lupus vulgaris
(`media.img.lupusvulgaris`, public domain, George Henry Fox - a genuine but historical 1905
clinical photo, no modern equivalent found). All three on `skill.tb.signs`.

Phlyctenular conjunctivitis stays OPEN: the only Commons candidate found is an 1897 veterinary
textbook illustration of a different species/tissue (keratitis, not conjunctivitis) - rejected as
misleading. Real human clinical photos exist in PMC/journal case reports but are not openly
licensed.

## CLX-V017 — TB chest X-ray patterns — **FILLED** (2026-08-24)
Three Commons-verified radiographs, one per pattern: fibrotic (`media.img.tbcxr.fibrotic`, CC0,
Boris Giller), cavitation (`media.img.tbcxr.cavitation`, CC BY-SA 4.0, Hellerhoff), miliary
(`media.img.tbcxr.miliary`, CC BY-SA 2.0, Yale Rosen). All three on `skill.ix.tb.workup`.

## CLX-V018 — Osler's nodes vs Janeway lesions — **FILLED** (2026-08-24)
Commons-verified pair: `media.img.oslernodes` (CC BY-SA 4.0, Roberto J. Galindo) and
`media.img.janewaylesion` (CC BY-SA 4.0, Warfieldian), both on `skill.exam.ie.stigmata`.

## CLX-V019 — Mitral stenosis auscultation — **FILLED** (2026-08-24)
oEmbed-verified video (Medzcool): `media.vid.mitralstenosis`, on `skill.exam.cvs.murmurs`.

## CLX-V020 — Fixed vs physiological S2 splitting — **FILLED** (2026-08-24)
oEmbed-verified video pair (Medzcool): `media.vid.s2fixed` + `media.vid.s2physiological`, both on
`skill.chd.signs`.

## CLX-V021 — STEMI sequential ECG evolution
- **Clinical context:** Ischaemic heart disease investigations, `skill.ix.ihd.ecg`.
- **Must show:** hyperacute T → ST elevation → Q wave → T inversion → resolution, as a strip series.
- **Preferred format:** diagram/strip series.
- **Status:** OPEN

## CLX-V022 — Asterixis (flapping tremor) — **FILLED** (2026-08-24)
oEmbed-verified video (Doctor O'Donovan): `media.vid.asterixis`, on `skill.exam.gi.cld_stigmata`.

## CLX-V023 — Spider naevi with diascopy — **PARTIALLY FILLED** (2026-08-24)
Commons-verified naevus-morphology photo (`media.img.spidernaevus`, CC BY 2.0), on
`skill.exam.gi.cld_stigmata`. No genuine before/after diascopy pair found on Commons - that
technique stays text-taught.

## CLX-V024 — Scleral icterus grades
- **Clinical context:** Jaundice, `skill.gen.jaundice`.
- **Must show:** mild vs moderate scleral icterus, side by side.
- **Preferred format:** photo pair.
- **Status:** OPEN

## CLX-V025 — Spinal cord compression, examination/localisation video — **PARTIALLY FILLED** (2026-08-24)
oEmbed-verified video (Geeky Medics) covering the sensory-level-mapping technique:
`media.vid.sensorylevel`, on `skill.exam.cord.spine`. No video teaching the extradural-vs-
intradural bedside discriminators was found on a second thorough search either - that content
stays text-taught.

---

## Owner-supplied batch, 2026-08-23 — 20 images reviewed, all self-labelled with their CLX id

Owner supplied 28 candidate images plus 8 YouTube links for the neurology reflex/cranial-nerve
gaps. Reviewed each against the live gap list; 20 accepted (all `ownerProduced`), 6 skipped as
redundant duplicates of a stronger accepted image, 1 flagged rather than used, 1 not reviewed
further (self-labelled duplicate of an already-accepted id).

**CLX-V004 — Barrel chest — re-filled.** Owner sent a second, more complete illustration
(side-on photo comparison + key features + how-to-recognize panel). It replaces the earlier,
less complete owner illustration at the same media id (`media.resp.inspection.barrel`), same
file name (`clinix-barrelchest.jpg`) — not a duplicate slot, a straight upgrade.

**CLX-NEW-001/021/022 — filled with one multi-technique panel.** `clxnew001.png` covers chest
expansion, tactile fremitus and percussion technique in one 4-panel image — wired to all three
skills (`skill.exam.resp.vocal_resonance`, `skill.exam.resp.expansion`, `skill.exam.resp.percussion`)
rather than three separate images, since one panel legitimately covers three techniques.

**CLX-NEW-003 (ascites) — filled, 3 images:** shifting dullness (2 techniques) + a percussion
close-up, wired on `skill.exam.gi.ascites`.

**CLX-NEW-004 (auscultation of the abdomen) — filled.** Bowel-sound quadrants + the 4 bruit
sites, wired on `skill.exam.gi.auscultation`.

**CLX-NEW-005 (gallbladder/kidney) — filled.** Bimanual kidney ballottement technique, wired on
`skill.exam.gi.gallbladder_kidney`. (One candidate file named for this id actually showed a
shifting-dullness percussion technique on review — filed under CLX-NEW-003 instead, by content,
not by filename.)

**CLX-NEW-007 (precordium inspection) — filled.** Tangential view at 45 degrees plus a
what-to-look-for panel, wired on `skill.exam.cvs.inspection`.

**CLX-NEW-008 (apex beat) — filled, 2 images:** supine and left-lateral positions, wired on
`skill.exam.cvs.apex`.

**CLX-NEW-009 (heart failure signs) — filled.** Reference sheet for the left- and right-sided
sign clusters, wired on `skill.exam.cvs.heart_failure_signs`.

**CLX-NEW-010 (CN V motor + corneal reflex) — filled.** Masseter/temporalis bulk and strength
testing plus the corneal reflex technique, wired on `skill.exam.neuro.cn5`.

**CLX-NEW-011 (CN VII facial palsy) — filled, 2 images**, superseding the Bell's-palsy Commons
candidate that was judged too staged to use. Wired on `skill.exam.neuro.cn7`.

**CLX-NEW-019 (hand hygiene) — filled.** The WHO 6-step technique poster, custom-branded, wired
on `skill.approach.hygiene`.

**CLX-NEW-012/013/014/015/016 — filled with video, not image** (2026-08-23): 8 oEmbed-verified
YouTube links the owner supplied covering CN V corneal/temporalis, CN IX/X gag+uvula, CN XI/XII,
tone/power, DTR, and gait, wired onto the matching `skill.exam.neuro.*` skills.

**Skipped as redundant** (a stronger accepted image already covers the same ground): a plainer
BP-cuff diagram, a second kidney-ballottement candidate, a plain-unlabelled ascites pair, a
second precordium-pulse diagram (arterial pressure waveform trace — kept as a note here, not
wired: it is closer to CLX-NEW-006's "pulse waveform shapes" ask than any wired skill, but is a
single continuous-trace graph rather than the shape-comparison chart that gap actually needs, so
CLX-NEW-006 stays OPEN).

**CLX-NEW-018 — pallor — FILLED** (2026-08-23, owner-confirmed AI-generated). Owner confirmed
the image is AI-generated, not a real patient photo. Saved as `clinix-pallor.jpg`, wired as
`media.gen.pallor.conjunctiva` on `skill.gen.pallor`.
