---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 25 (Anterior cervical discectomy and fusion, Lumbar laminectomy for canal stenosis, Posterior lumbar instrumented fusion, VATS bullectomy with pleurodesis, Median sternotomy and closure): Gemini video and timestamp prompt (5 operations)

Same operations as [[SURGX-batch25-image-prompt]].

```
TASK
Find YouTube videos for 5 operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Anterior cervical discectomy and fusion
B. Lumbar laminectomy for canal stenosis
C. Posterior lumbar instrumented fusion (TLIF)
D. VATS bullectomy with pleurodesis
E. Median sternotomy and closure

HOW TO CHOOSE VIDEOS
1. Search YouTube yourself. For each operation pick 2 to 4 videos that you can actually WATCH (video, not audio-only
   podcasts or slides). Prefer, in order: university hospitals and specialist departments, surgical societies and
   journals (Royal Colleges, American College of Surgeons, JOMI, specialty societies), recognised surgeon educators,
   then high-quality animations.
2. Embedding must be allowed and the video must NOT be age-restricted. If YouTube asks to confirm your age, or shows
   "Sign in to confirm your age", reject it. Do NOT use Nucleus Medical Media (embedding disabled). Skip any video
   marked "Video unavailable" or "Playback on other websites has been disabled".
3. The technique must be safe, current practice. Reject a video that shows an outdated or unsafe technique for the step, operates on the wrong side, or skips a safety check shown in the step list. Note anything else outdated in
   "concerns", but keep the video if the clip itself is correct.
4. Real operative footage is preferred for operative steps; an animation is fine where footage
   does not show the step clearly (anatomy, structures hidden from the camera).

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
A. acdf
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.neuro.preop-check                 Neurological baseline, side and coagulation check
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.ortho.image-intensifier           Image intensifier set-up and radiation safety
  7 step.neuro.spine-level                 Radiographic level confirmation before incision and before bone removal
  8 step.neuro.ionm                        Neurophysiological monitoring baseline and alarm plan
  9 step.core.prep-drape                   Skin preparation and draping
 10 step.acdf.approach                     Anterior approach to the cervical spine
 11 step.neuro.discectomy-endplate         Complete discectomy and endplate preparation for interbody fusion
 12 step.acdf.decompression                Posterior osteophytes, posterior longitudinal ligament and foraminal decompression
 13 step.neuro.ionm-alert                  Bailout: responding to a monitoring alert or new neurological concern
 14 step.ortho.implant-check               Implant selection, check and register
 15 step.neuro.interbody-cage              Sizing and inserting the interbody cage or graft
 16 step.acdf.plate                        Anterior plate fixation
 17 step.ortho.final-imaging               Final images saved in two planes
 18 step.core.haemostasis                  Haemostasis before closure
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.core.skin-closure                 Skin closure and dressing
 21 step.neuro.postop-neuro-obs            Post-operative neurological observation plan
 22 step.core.debrief                      Debrief, operative note and handover
B. lumbar-laminectomy-stenosis
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.neuro.preop-check                 Neurological baseline, side and coagulation check
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.neuro.prone-position              Prone positioning on a spinal frame
  6 step.ortho.image-intensifier           Image intensifier set-up and radiation safety
  7 step.neuro.spine-level                 Radiographic level confirmation before incision and before bone removal
  8 step.core.prep-drape                   Skin preparation and draping
  9 step.neuro.posterior-exposure          Posterior midline exposure of the lumbar spine
 10 step.neuro.central-decompression       Central laminectomy and decompression of the thecal sac
 11 step.lam.lateral-recess                Lateral recess and foraminal decompression
 12 step.lam.stability-check               Checking what is left: facets, pars and stability
 13 step.neuro.dural-repair                Dural closure or repair
 14 step.lam.bailout                       Bailout: uncontrolled epidural bleeding or an unrepairable dural tear
 15 step.core.haemostasis                  Haemostasis before closure
 16 step.core.counts                       Swab, instrument and needle counts
 17 step.neuro.spine-closure               Layered closure of the posterior spinal wound
 18 step.neuro.postop-neuro-obs            Post-operative neurological observation plan
 19 step.core.debrief                      Debrief, operative note and handover
C. posterior-lumbar-fusion-tlif
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.neuro.preop-check                 Neurological baseline, side and coagulation check
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.neuro.prone-position              Prone positioning on a spinal frame
  6 step.neuro.ionm                        Neurophysiological monitoring baseline and alarm plan
  7 step.neuro.spine-level                 Radiographic level confirmation before incision and before bone removal
  8 step.core.prep-drape                   Skin preparation and draping
  9 step.neuro.posterior-exposure          Posterior midline exposure of the lumbar spine
 10 step.ortho.implant-check               Implant selection, check and register
 11 step.tlif.pedicle-screws               Pedicle screw insertion
 12 step.neuro.central-decompression       Central laminectomy and decompression of the thecal sac
 13 step.tlif.facetectomy                  Unilateral facetectomy and opening Kambin triangle
 14 step.neuro.discectomy-endplate         Complete discectomy and endplate preparation for interbody fusion
 15 step.neuro.interbody-cage              Sizing and inserting the interbody cage or graft
 16 step.tlif.rods                         Rods, compression and posterolateral graft
 17 step.neuro.ionm-alert                  Bailout: responding to a monitoring alert or new neurological concern
 18 step.core.haemostasis                  Haemostasis before closure
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.neuro.spine-closure               Layered closure of the posterior spinal wound
 21 step.neuro.postop-neuro-obs            Post-operative neurological observation plan
 22 step.core.debrief                      Debrief, operative note and handover
D. vats-bullectomy-pleurodesis
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.vats.lung-isolation               Lung isolation and one-lung ventilation
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.vats.ports                        Port placement
  8 step.vats.inspection                   Systematic inspection and finding the leak
  9 step.vats.bullectomy                   Stapled bullectomy
 10 step.vats.pleurodesis                  Pleurodesis: pleural abrasion or apical pleurectomy
 11 step.vats.leak-test                    Leak test and re-expansion under vision
 12 step.vats.conversion                   Conversion to thoracotomy
 13 step.core.haemostasis                  Haemostasis before closure
 14 step.thor.chest-drains                 Placing mediastinal and pleural drains
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.core.specimen                     Specimen handling and labelling
 17 step.core.skin-closure                 Skin closure and dressing
 18 step.core.debrief                      Debrief, operative note and handover
E. median-sternotomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.st.landmarks                      Marking the midline
  7 step.thor.sternotomy-open              Opening the sternum in the midline
  8 step.st.redo-entry                     Re-entry in a previously opened chest
  9 step.thor.pericardium-open             Spreading the sternum and opening the pericardium
 10 step.vasc.heparin-reversal             Deciding on, and giving, heparin reversal
 11 step.core.haemostasis                  Haemostasis before closure
 12 step.thor.pacing-wires                 Temporary epicardial pacing wires
 13 step.thor.chest-drains                 Placing mediastinal and pleural drains
 14 step.core.counts                       Swab, instrument and needle counts
 15 step.st.open-chest                     Delayed sternal closure when the chest will not close safely
 16 step.thor.sternal-closure              Sternal closure with wires
 17 step.core.skin-closure                 Skin closure and dressing
 18 step.core.debrief                      Debrief, operative note and handover
 19 step.thor.emergency-resternotomy       Emergency re-sternotomy for arrest or tamponade

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "acdf": {
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
  "lumbar-laminectomy-stenosis": { ... }, "posterior-lumbar-fusion-tlif": { ... }, "vats-bullectomy-pleurodesis": { ... }, "median-sternotomy": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
