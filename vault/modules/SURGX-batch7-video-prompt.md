---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 7 (eye: injection, lacrimal, lids, trauma, orbit, squint, retina): Gemini video and timestamp prompt (7 operations)

Same operations as [[SURGX-batch7-image-prompt]]. After Gemini answers, every video is checked in the real embedded player with a referrer and wired as timed `kind:"embed"` clips.

```
TASK
Find YouTube videos for 7 eye operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Intravitreal anti-VEGF injection (RIGHT eye)
B. External dacryocystorhinostomy (RIGHT side)
C. Chalazion incision and curettage (RIGHT upper lid)
D. Corneal and subtarsal foreign body removal (RIGHT eye)
E. Evisceration with orbital implant (RIGHT eye)
F. Strabismus surgery: rectus recession and resection (RIGHT eye)
G. Pars plana vitrectomy for retinal detachment (RIGHT eye)

HOW TO CHOOSE VIDEOS
1. Search YouTube yourself. For each operation pick 2 to 4 videos that you can actually WATCH (video, not audio-only
   podcasts or slides). Prefer, in order: university or hospital eye departments and eye institutes (for example
   Aravind Eye Care System, LV Prasad Eye Institute, Moorfields, Wills Eye, Bascom Palmer), societies and journals
   (American Academy of Ophthalmology / EyeWiki, ASCRS, ESCRS, Royal College of Ophthalmologists, All India
   Ophthalmological Society), recognised ophthalmic surgeon educators, then high-quality animations.
2. Embedding must be allowed and the video must NOT be age-restricted. If YouTube asks to confirm your age, or shows
   "Sign in to confirm your age", reject it. Do NOT use Nucleus Medical Media (embedding disabled). Skip any video
   marked "Video unavailable" or "Playback on other websites has been disabled".
3. The technique must be safe, current practice. Reject a video that injects without povidone-iodine or with the needle touching the lashes, removes a corneal foreign body with the needle pointing at the eye, eviscerates an eye that may contain a tumour, or turns on a vitrectomy infusion before seeing the cannula tip inside the eye. Note anything else outdated in
   "concerns", but keep the video if the clip itself is correct.
4. Real operative footage through the microscope is preferred for operative steps; an animation is fine where footage
   does not show the step clearly (anatomy, the laser, the inside of the eye).

HOW TO TIME CLIPS
- Watch the video (use its transcript and chapters to find the moment, then watch). Give start and end in WHOLE
  SECONDS from the start of the video, verified by watching, not guessed from chapters or the description.
- Each clip shows that step and only that step, 10 to 90 seconds long. Never give a whole long video: skip intros,
  channel promos, sponsor reads, "like and subscribe" and outros.
- For every clip quote the first and last sentence spoken (or describe the first and last frame if there is no
  speech), so I can verify it.
- If a step is not in your first videos, SEARCH FOR ANOTHER VIDEO that shows it before giving up. Only then use null.
  Team, consent, count and handover steps are often missing from operative videos; a separate good teaching video for
  them (for example a WHO Surgical Safety Checklist demonstration) is welcome.
- Videos need not follow the steps in the same order or name them the same way. Map what is shown to the step whose
  description matches.
- For each step pick ONE "best" clip.

THE STEPS (use these step ids exactly)
A. intravitreal-injection
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.eye.anaesthesia                   Ocular anaesthesia: topical, sub-Tenon, peribulbar or general
  4 step.core.positioning                  Positioning and pressure care
  5 step.eye.povidone-iodine               Povidone-iodine 5% to the conjunctival sac
  6 step.eye.lid-speculum                  Microscope, lash drape and lid speculum
  7 step.ivi.site                          Choosing and marking the injection site
  8 step.ivi.inject                        Injecting the drug
  9 step.ivi.perfusion                     Perfusion and pressure check
 10 step.eye.shield-postop                 Eye protection, drops and the warning signs
 11 step.core.debrief                      Debrief, operative note and handover
B. external-dcr
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.ent.bloodless-field               Bloodless field: head-up tilt, vasoconstrictor infiltration and the wait
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.dcr.incision                      Skin incision and exposure of the anterior lacrimal crest
  8 step.dcr.sac                           Reflecting periosteum and the lacrimal sac
  9 step.dcr.ostium                        Creating the bony ostium
 10 step.dcr.flaps                         Sac and nasal mucosal flaps
 11 step.dcr.tubes                         Silicone intubation (when used)
 12 step.dcr.bailout                       Bailout: an unexpected sac finding or bleeding that will not stop
 13 step.core.haemostasis                  Haemostasis before closure
 14 step.core.counts                       Swab, instrument and needle counts
 15 step.core.skin-closure                 Skin closure and dressing
 16 step.core.debrief                      Debrief, operative note and handover
C. chalazion-incision-curettage
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.eye.anaesthesia                   Ocular anaesthesia: topical, sub-Tenon, peribulbar or general
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.chal.clamp                        Applying the chalazion clamp
  7 step.chal.incise                       Vertical incision and curettage
  8 step.core.specimen                     Specimen handling and labelling
  9 step.core.haemostasis                  Haemostasis before closure
 10 step.eye.shield-postop                 Eye protection, drops and the warning signs
 11 step.core.debrief                      Debrief, operative note and handover
D. corneal-foreign-body-removal
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.fb.mechanism-check                Mechanism and penetrating injury check
  3 step.eye.anaesthesia                   Ocular anaesthesia: topical, sub-Tenon, peribulbar or general
  4 step.core.positioning                  Positioning and pressure care
  5 step.fb.evert                          Everting the upper lid
  6 step.fb.remove                         Removing the foreign body and rust ring
  7 step.fb.fluorescein                    Fluorescein and Seidel check after removal
  8 step.fb.penetrating-bailout            Bailout: a leak or signs of penetration
  9 step.eye.shield-postop                 Eye protection, drops and the warning signs
 10 step.core.debrief                      Debrief, operative note and handover
E. evisceration
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.eye.anaesthesia                   Ocular anaesthesia: topical, sub-Tenon, peribulbar or general
  5 step.core.positioning                  Positioning and pressure care
  6 step.eye.povidone-iodine               Povidone-iodine 5% to the conjunctival sac
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.eye.lid-speculum                  Microscope, lash drape and lid speculum
  9 step.eye.conj-peritomy                 Conjunctival peritomy and Tenon's dissection
 10 step.evis.keratectomy                  Removing the cornea
 11 step.evis.contents                     Removing the intraocular contents completely
 12 step.evis.implant                      Sizing and placing the orbital implant
 13 step.evis.closure                      Closing the sclera and Tenon's
 14 step.eye.conj-closure                  Conjunctival closure
 15 step.core.specimen                     Specimen handling and labelling
 16 step.core.haemostasis                  Haemostasis before closure
 17 step.core.counts                       Swab, instrument and needle counts
 18 step.evis.conformer                    Conformer and pressure dressing
 19 step.core.debrief                      Debrief, operative note and handover
F. strabismus-recession-resection
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.eye.anaesthesia                   Ocular anaesthesia: topical, sub-Tenon, peribulbar or general
  4 step.core.positioning                  Positioning and pressure care
  5 step.eye.povidone-iodine               Povidone-iodine 5% to the conjunctival sac
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.eye.lid-speculum                  Microscope, lash drape and lid speculum
  8 step.strab.forced-duction              Forced duction test
  9 step.eye.conj-peritomy                 Conjunctival peritomy and Tenon's dissection
 10 step.strab.isolate                     Isolating the rectus muscle
 11 step.strab.secure                      Securing and disinserting the muscle
 12 step.strab.recess                      Recession: reattaching the muscle further back
 13 step.strab.resect                      Resection: shortening the muscle
 14 step.strab.oculocardiac                Bailout: oculocardiac reflex
 15 step.strab.lost-muscle                 Bailout: a slipped or lost muscle
 16 step.eye.conj-closure                  Conjunctival closure
 17 step.core.counts                       Swab, instrument and needle counts
 18 step.eye.shield-postop                 Eye protection, drops and the warning signs
 19 step.core.debrief                      Debrief, operative note and handover
G. pars-plana-vitrectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.eye.anaesthesia                   Ocular anaesthesia: topical, sub-Tenon, peribulbar or general
  4 step.core.positioning                  Positioning and pressure care
  5 step.eye.povidone-iodine               Povidone-iodine 5% to the conjunctival sac
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.eye.lid-speculum                  Microscope, lash drape and lid speculum
  8 step.ppv.ports                         Placing the trocar cannulas and the infusion
  9 step.ppv.core                          Core vitrectomy and posterior vitreous detachment
 10 step.ppv.retina                        Flattening the retina and treating the breaks
 11 step.ppv.tamponade                     Fluid-air exchange and tamponade
 12 step.eye.suprachoroidal-haemorrhage    Bailout: suprachoroidal haemorrhage
 13 step.eye.wound-check                   Watertight wound and eye pressure check
 14 step.core.counts                       Swab, instrument and needle counts
 15 step.eye.shield-postop                 Eye protection, drops and the warning signs
 16 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "intravitreal-injection": {
    "videos": [
      { "key": "V1", "videoId": "11-char id", "url": "https://www.youtube.com/watch?v=...", "title": "...",
        "channel": "...", "durationSec": 0, "kind": "operative|animation|lecture|safety",
        "watched": true, "ageRestricted": false, "concerns": ["..."] }
    ],
    "steps": [
      { "n": 1, "id": "step.core.consent-check",
        "clips": [ { "video": "V1", "start": 0, "end": 0, "shows": "one line", "first_line": "...",
                     "last_line": "...", "confidence": "high|medium|low" } ],
        "best": "V1" }
    ]
  },
  "external-dcr": { ... }, "chalazion-incision-curettage": { ... }, "corneal-foreign-body-removal": { ... }, "evisceration": { ... }, "strabismus-recession-resection": { ... }, "pars-plana-vitrectomy": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
