---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 9a (urology: endoscopic, perineal and scrotal): Gemini video and timestamp prompt (7 operations)

Same operations as [[SURGX-batch9a-image-prompt]]. Every video is checked in the real embedded player before wiring.

```
TASK
Find YouTube videos for 7 urological operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Flexible cystoscopy and stent removal
B. Transperineal prostate biopsy
C. Optical internal urethrotomy
D. Cystolitholapaxy (bladder stone)
E. Holmium laser enucleation of the prostate (HoLEP)
F. No-scalpel vasectomy
G. Bulbar urethroplasty with buccal mucosa graft (RIGHT cheek)

HOW TO CHOOSE VIDEOS
1. Search YouTube yourself. For each operation pick 2 to 4 videos that you can actually WATCH (video, not audio-only
   podcasts or slides). Prefer, in order: university hospitals and urology departments, societies and journals (EAU
   / European Urology video journal, AUA, BAUS, Urological Society of India, Journal of Endourology video), recognised
   urologist educators, then high-quality animations.
2. Embedding must be allowed and the video must NOT be age-restricted. If YouTube asks to confirm your age, or shows
   "Sign in to confirm your age", reject it. Do NOT use Nucleus Medical Media (embedding disabled). Skip any video
   marked "Video unavailable" or "Playback on other websites has been disabled".
3. The technique must be safe, current practice. Reject a video that removes a stent or stone without vision, cuts a urethral stricture without a guidewire across it, morcellates in an empty bladder, secures a renal artery with a single plain clip, or tells a vasectomy patient he is sterile on the day. Note anything else outdated in
   "concerns", but keep the video if the clip itself is correct.
4. Real operative footage is preferred for operative steps; an animation is fine where footage
   does not show the step clearly (anatomy, the inside of the bladder or kidney).

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
A. uro-flexible-cystoscopy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.uro.urine-check                   Sterile urine before instrumentation
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.fcs.la-gel                        Lidocaine gel and gentle urethral entry
  8 step.uro.cystoscopy                    Urethrocystoscopy and systematic bladder inspection
  9 step.fcs.retroflex                     Retroflexion to see the bladder neck
 10 step.fcs.stent-removal                 Stent removal with graspers
 11 step.fcs.finding                       A suspicious finding
 12 step.core.debrief                      Debrief, operative note and handover
B. uro-transperineal-prostate-biopsy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.mdt-check                    MDT decision, staging and diagnosis confirmed
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.uro.urine-check                   Sterile urine before instrumentation
  5 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  6 step.core.positioning                  Positioning and pressure care
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.tpb.block                         Perineal and periprostatic local anaesthetic
  9 step.tpb.probe                         Ultrasound probe and access device
 10 step.tpb.targeted                      Targeted cores from the MRI lesion
 11 step.tpb.systematic                    Systematic template cores
 12 step.core.haemostasis                  Haemostasis before closure
 13 step.core.specimen                     Specimen handling and labelling
 14 step.tpb.retention                     Retention or heavy bleeding after biopsy
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.core.debrief                      Debrief, operative note and handover
C. uro-optical-urethrotomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.uro.urine-check                   Sterile urine before instrumentation
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.uro.fluoro-setup                  Fluoroscopy, contrast and radiation safety set-up
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.uro.cystoscopy                    Urethrocystoscopy and systematic bladder inspection
  9 step.uro.safety-guidewire              Safety guidewire into the renal pelvis
 10 step.dviu.incise                       Cold-knife incision at 12 o'clock
 11 step.dviu.false-passage                Bailout: lost lumen or false passage
 12 step.uro.catheter-plan                 Catheter secured and plan recorded
 13 step.core.counts                       Swab, instrument and needle counts
 14 step.core.debrief                      Debrief, operative note and handover
D. uro-cystolitholapaxy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.uro.urine-check                   Sterile urine before instrumentation
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.uro.cystoscopy                    Urethrocystoscopy and systematic bladder inspection
  8 step.uro.lithotripsy                   Intracorporeal lithotripsy
  9 step.uro.fragment-clearance            Fragment retrieval and stone-free assessment
 10 step.clp.cause                         Find and treat the cause
 11 step.uro.perforation-check             Final inspection: perforation, orifices and landmarks
 12 step.uro.catheter-plan                 Catheter secured and plan recorded
 13 step.core.specimen                     Specimen handling and labelling
 14 step.core.counts                       Swab, instrument and needle counts
 15 step.core.debrief                      Debrief, operative note and handover
E. uro-holep
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.uro.urine-check                   Sterile urine before instrumentation
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.uro.cystoscopy                    Urethrocystoscopy and systematic bladder inspection
  8 step.holep.laser-safety                Laser safety check
  9 step.holep.enucleation                 Find the capsule plane and release the apex
 10 step.holep.lobes                       Enucleate the lobes into the bladder
 11 step.core.haemostasis                  Haemostasis before closure
 12 step.holep.morcellation                Morcellation in a full bladder
 13 step.holep.morcellator-injury          Bailout: bladder wall caught by the morcellator
 14 step.uro.perforation-check             Final inspection: perforation, orifices and landmarks
 15 step.uro.three-way-catheter            Three-way catheter and continuous irrigation
 16 step.core.specimen                     Specimen handling and labelling
 17 step.core.counts                       Swab, instrument and needle counts
 18 step.core.debrief                      Debrief, operative note and handover
F. uro-vasectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.positioning                  Positioning and pressure care
  4 step.core.prep-drape                   Skin preparation and draping
  5 step.vas.fix                           Three-finger fix of the vas
  6 step.vas.local                         Local anaesthetic block of the vas
  7 step.vas.deliver                       Puncture and deliver a loop of vas
  8 step.vas.divide                        Divide, seal and interpose fascia
  9 step.core.haemostasis                  Haemostasis before closure
 10 step.vas.other-side                    The other side, same way
 11 step.core.specimen                     Specimen handling and labelling
 12 step.core.skin-closure                 Skin closure and dressing
 13 step.core.debrief                      Debrief, operative note and handover
G. uro-buccal-urethroplasty
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.uro.urine-check                   Sterile urine before instrumentation
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.uro.cystoscopy                    Urethrocystoscopy and systematic bladder inspection
  8 step.urp.harvest                       Harvest the buccal graft
  9 step.urp.expose                        Expose the bulbar urethra
 10 step.urp.open                          Open the stricture into healthy urethra
 11 step.urp.graft                         Quilt and sew the graft
 12 step.uro.catheter-plan                 Catheter secured and plan recorded
 13 step.core.haemostasis                  Haemostasis before closure
 14 step.core.skin-closure                 Skin closure and dressing
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "uro-flexible-cystoscopy": {
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
  "uro-transperineal-prostate-biopsy": { ... }, "uro-optical-urethrotomy": { ... }, "uro-cystolitholapaxy": { ... }, "uro-holep": { ... }, "uro-vasectomy": { ... }, "uro-buccal-urethroplasty": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
