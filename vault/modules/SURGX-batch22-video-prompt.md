---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 22 (Peritonsillar abscess, Dynamic hip screw, Intramedullary nailing of the tibia, Debridement of an open fracture with external fixation, Fasciotomy of the leg): Gemini video and timestamp prompt (5 operations)

Same operations as [[SURGX-batch22-image-prompt]].

```
TASK
Find YouTube videos for 5 operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Peritonsillar abscess (quinsy) drainage under local anaesthetic
B. Dynamic hip screw
C. Intramedullary nailing of the tibia
D. Debridement of an open fracture with external fixation
E. Fasciotomy of the leg

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
A. quinsy-drainage
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.ent.preop-data-check              Confirm the investigation that justifies the operation
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.positioning                  Positioning and pressure care
  5 step.st.local                          Local anaesthesia for an inflamed field
  6 step.quinsy.landmark                   Choose the puncture site
  7 step.quinsy.aspirate                   Guarded needle aspiration
  8 step.st.culture                        Pus for culture
  9 step.quinsy.incise                     Guarded incision over the abscess
 10 step.st.deloculate                     Breaking down loculations
 11 step.quinsy.no-pus-bailout             Bail-out: no pus, a failing patient, or an unsafe procedure
 12 step.core.haemostasis                  Haemostasis before closure
 13 step.core.counts                       Swab, instrument and needle counts
 14 step.ent.airway-handover               Airway handover to recovery and the ward
 15 step.core.debrief                      Debrief, operative note and handover
B. dynamic-hip-screw
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.ortho.image-intensifier           Image intensifier set-up and radiation safety
  6 step.ortho.reduction-check             Reduction confirmed in two planes
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.dhs.approach                      Lateral approach to the proximal femur
  9 step.ortho.guidewire                   Guidewire position confirmed before committing
 10 step.ortho.implant-check               Implant selection, check and register
 11 step.dhs.ream-lag                      Measure, ream and insert the lag screw
 12 step.dhs.plate                         Barrel plate application and compression
 13 step.ortho.final-imaging               Final images saved in two planes
 14 step.core.haemostasis                  Haemostasis before closure
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.core.skin-closure                 Skin closure and dressing
 17 step.ortho.nv-check                    Neurovascular and compartment check before leaving theatre
 18 step.core.debrief                      Debrief, operative note and handover
C. tibial-im-nail
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.ortho.image-intensifier           Image intensifier set-up and radiation safety
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.tibnail.entry                     Entry point
  8 step.ortho.reduction-check             Reduction confirmed in two planes
  9 step.ortho.guidewire                   Guidewire position confirmed before committing
 10 step.tibnail.ream                      Measuring and reaming
 11 step.ortho.implant-check               Implant selection, check and register
 12 step.tibnail.insert-lock               Nail insertion and locking
 13 step.ortho.final-imaging               Final images saved in two planes
 14 step.core.haemostasis                  Haemostasis before closure
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.core.skin-closure                 Skin closure and dressing
 17 step.ortho.nv-check                    Neurovascular and compartment check before leaving theatre
 18 step.core.debrief                      Debrief, operative note and handover
D. open-fracture-debridement
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.ortho.tourniquet                  Tourniquet: decide, apply, record
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.ortho.wound-photos                Wound photographs at key stages
  8 step.ortho.leg-incisions               Leg incisions on the fasciotomy lines
  9 step.st.debride                        Debridement of non-viable tissue
 10 step.ortho.muscle-viability            Muscle viability assessed in every compartment
 11 step.oex.bone                          Bone end debridement
 12 step.oex.lavage                        Low-pressure irrigation
 13 step.oex.reprep                        Re-preparation and fresh instruments
 14 step.ortho.image-intensifier           Image intensifier set-up and radiation safety
 15 step.ortho.reduction-check             Reduction confirmed in two planes
 16 step.ortho.implant-check               Implant selection, check and register
 17 step.oex.frame                         Spanning external fixator
 18 step.ortho.final-imaging               Final images saved in two planes
 19 step.core.haemostasis                  Haemostasis before closure
 20 step.ortho.temp-cover                  Temporary wound cover and plan for definitive cover
 21 step.core.counts                       Swab, instrument and needle counts
 22 step.ortho.nv-check                    Neurovascular and compartment check before leaving theatre
 23 step.core.debrief                      Debrief, operative note and handover
E. leg-fasciotomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.ortho.tourniquet                  Tourniquet: decide, apply, record
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.ortho.leg-incisions               Leg incisions on the fasciotomy lines
  8 step.fas.lateral                       Lateral incision: anterior and lateral compartments
  9 step.fas.medial                        Medial incision: superficial and deep posterior compartments
 10 step.ortho.muscle-viability            Muscle viability assessed in every compartment
 11 step.st.debride                        Debridement of non-viable tissue
 12 step.ortho.wound-photos                Wound photographs at key stages
 13 step.core.haemostasis                  Haemostasis before closure
 14 step.ortho.temp-cover                  Temporary wound cover and plan for definitive cover
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.ortho.nv-check                    Neurovascular and compartment check before leaving theatre
 17 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "quinsy-drainage": {
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
  "dynamic-hip-screw": { ... }, "tibial-im-nail": { ... }, "open-fracture-debridement": { ... }, "leg-fasciotomy": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
