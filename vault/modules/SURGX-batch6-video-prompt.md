---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 6 (eye: cataract, glaucoma, refractive, pterygium): Gemini video and timestamp prompt (6 operations)

Same operations as [[SURGX-batch6-image-prompt]]. After Gemini answers, every video is checked in the real embedded player with a referrer and wired as timed `kind:"embed"` clips.

```
TASK
Find YouTube videos for 6 eye operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Phacoemulsification with foldable lens implant (RIGHT eye)
B. Manual small-incision cataract surgery, SICS (RIGHT eye)
C. Trabeculectomy with mitomycin C (RIGHT eye)
D. Photorefractive keratectomy, PRK (RIGHT eye)
E. LASIK (RIGHT eye)
F. Pterygium excision with conjunctival autograft (RIGHT eye, nasal)

HOW TO CHOOSE VIDEOS
1. Search YouTube yourself. For each operation pick 2 to 4 videos that you can actually WATCH (video, not audio-only
   podcasts or slides). Prefer, in order: university or hospital eye departments and eye institutes (for example
   Aravind Eye Care System, LV Prasad Eye Institute, Moorfields, Wills Eye, Bascom Palmer), societies and journals
   (American Academy of Ophthalmology / EyeWiki, ASCRS, ESCRS, Royal College of Ophthalmologists, All India
   Ophthalmological Society), recognised ophthalmic surgeon educators, then high-quality animations.
2. Embedding must be allowed and the video must NOT be age-restricted. If YouTube asks to confirm your age, or shows
   "Sign in to confirm your age", reject it. Do NOT use Nucleus Medical Media (embedding disabled). Skip any video
   marked "Video unavailable" or "Playback on other websites has been disabled".
3. The technique must be safe, current practice. Reject a video that uses no povidone-iodine before intraocular surgery, makes the main incision with the eye soft and the chamber collapsed, chases a dropped nucleus into the vitreous from the front, puts mitomycin C on the cut conjunctival edge, or lifts and ablates a buttonholed LASIK flap. Note anything else outdated in
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
A. phacoemulsification
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.eye.biometry-iol-check            Biometry and lens implant check
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.eye.anaesthesia                   Ocular anaesthesia: topical, sub-Tenon, peribulbar or general
  5 step.core.positioning                  Positioning and pressure care
  6 step.eye.povidone-iodine               Povidone-iodine 5% to the conjunctival sac
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.eye.lid-speculum                  Microscope, lash drape and lid speculum
  9 step.phaco.incisions                   Main and side-port corneal incisions
 10 step.phaco.capsulorhexis               Continuous curvilinear capsulorhexis
 11 step.phaco.hydrodissection             Hydrodissection and rotation of the nucleus
 12 step.phaco.nucleus                     Nucleus removal with phaco (divide and conquer or chop)
 13 step.phaco.cortex                      Cortex removal with irrigation and aspiration
 14 step.phaco.iol                         Implant insertion into the capsular bag
 15 step.eye.posterior-capsule-rupture     Bailout: posterior capsule rupture and vitreous loss
 16 step.eye.intracameral-antibiotic       Intracameral antibiotic at the end of cataract surgery
 17 step.eye.wound-check                   Watertight wound and eye pressure check
 18 step.core.counts                       Swab, instrument and needle counts
 19 step.eye.shield-postop                 Eye protection, drops and the warning signs
 20 step.core.debrief                      Debrief, operative note and handover
B. manual-sics
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.eye.biometry-iol-check            Biometry and lens implant check
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.eye.anaesthesia                   Ocular anaesthesia: topical, sub-Tenon, peribulbar or general
  5 step.core.positioning                  Positioning and pressure care
  6 step.eye.povidone-iodine               Povidone-iodine 5% to the conjunctival sac
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.eye.lid-speculum                  Microscope, lash drape and lid speculum
  9 step.sics.tunnel                       Fornix-based conjunctival flap and sclerocorneal tunnel
 10 step.sics.capsulotomy                  Anterior capsulotomy
 11 step.sics.prolapse                     Hydrodissection and prolapsing the nucleus into the chamber
 12 step.sics.delivery                     Delivering the nucleus through the tunnel
 13 step.sics.cortex-iol                   Cortex aspiration and implant insertion
 14 step.eye.posterior-capsule-rupture     Bailout: posterior capsule rupture and vitreous loss
 15 step.eye.suprachoroidal-haemorrhage    Bailout: suprachoroidal haemorrhage
 16 step.eye.intracameral-antibiotic       Intracameral antibiotic at the end of cataract surgery
 17 step.eye.wound-check                   Watertight wound and eye pressure check
 18 step.core.counts                       Swab, instrument and needle counts
 19 step.eye.shield-postop                 Eye protection, drops and the warning signs
 20 step.core.debrief                      Debrief, operative note and handover
C. trabeculectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.eye.anaesthesia                   Ocular anaesthesia: topical, sub-Tenon, peribulbar or general
  4 step.core.positioning                  Positioning and pressure care
  5 step.eye.povidone-iodine               Povidone-iodine 5% to the conjunctival sac
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.eye.lid-speculum                  Microscope, lash drape and lid speculum
  8 step.trab.traction                     Corneal traction suture
  9 step.eye.conj-peritomy                 Conjunctival peritomy and Tenon's dissection
 10 step.trab.mmc                          Applying mitomycin C
 11 step.trab.flap                         Partial-thickness scleral flap
 12 step.trab.sclerostomy                  Sclerostomy and peripheral iridectomy
 13 step.trab.titrate                      Flap sutures and titration of flow
 14 step.eye.conj-closure                  Conjunctival closure
 15 step.eye.suprachoroidal-haemorrhage    Bailout: suprachoroidal haemorrhage
 16 step.eye.wound-check                   Watertight wound and eye pressure check
 17 step.core.counts                       Swab, instrument and needle counts
 18 step.eye.shield-postop                 Eye protection, drops and the warning signs
 19 step.core.debrief                      Debrief, operative note and handover
D. prk
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.eye.refractive-check              Refractive surgery check: stable refraction, corneal safety and the laser plan
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.positioning                  Positioning and pressure care
  5 step.eye.anaesthesia                   Ocular anaesthesia: topical, sub-Tenon, peribulbar or general
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.eye.lid-speculum                  Microscope, lash drape and lid speculum
  8 step.prk.epithelium                    Removing the epithelium
  9 step.eye.excimer-ablation              Excimer laser ablation with eye tracking
 10 step.eye.laser-interruption            Bailout: laser interruption, decentration or loss of tracking
 11 step.prk.mmc                           Mitomycin C to reduce haze (when indicated)
 12 step.prk.bandage                       Bandage contact lens
 13 step.eye.shield-postop                 Eye protection, drops and the warning signs
 14 step.core.debrief                      Debrief, operative note and handover
E. lasik
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.eye.refractive-check              Refractive surgery check: stable refraction, corneal safety and the laser plan
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.positioning                  Positioning and pressure care
  5 step.eye.anaesthesia                   Ocular anaesthesia: topical, sub-Tenon, peribulbar or general
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.eye.lid-speculum                  Microscope, lash drape and lid speculum
  8 step.lasik.flap                        Creating the corneal flap
  9 step.lasik.suction-loss                Bailout: suction loss or an incomplete flap
 10 step.lasik.flap-lift                   Lifting the flap
 11 step.eye.excimer-ablation              Excimer laser ablation with eye tracking
 12 step.eye.laser-interruption            Bailout: laser interruption, decentration or loss of tracking
 13 step.lasik.reposition                  Flap reposition and interface irrigation
 14 step.eye.shield-postop                 Eye protection, drops and the warning signs
 15 step.core.debrief                      Debrief, operative note and handover
F. pterygium-excision-autograft
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.eye.anaesthesia                   Ocular anaesthesia: topical, sub-Tenon, peribulbar or general
  4 step.core.positioning                  Positioning and pressure care
  5 step.eye.povidone-iodine               Povidone-iodine 5% to the conjunctival sac
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.eye.lid-speculum                  Microscope, lash drape and lid speculum
  8 step.ptg.excise                        Excising the pterygium head and body
  9 step.ptg.cornea                        Smoothing the cornea
 10 step.ptg.graft-harvest                 Harvesting the conjunctival autograft
 11 step.ptg.graft-secure                  Securing the graft limbus to limbus
 12 step.ptg.bailout                       Bailout: scleral thinning, muscle exposure or an atypical lesion
 13 step.core.haemostasis                  Haemostasis before closure
 14 step.core.specimen                     Specimen handling and labelling
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.eye.shield-postop                 Eye protection, drops and the warning signs
 17 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "phacoemulsification": {
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
  "manual-sics": { ... }, "trabeculectomy": { ... }, "prk": { ... }, "lasik": { ... }, "pterygium-excision-autograft": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
