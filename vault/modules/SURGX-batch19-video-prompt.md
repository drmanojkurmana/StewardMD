---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 19 (Femoral embolectomy, Below-knee amputation, Carotid endarterectomy, Femoro-popliteal bypass, Radiocephalic arteriovenous fistula): Gemini video and timestamp prompt (5 operations)

Same operations as [[SURGX-batch19-image-prompt]].

```
TASK
Find YouTube videos for 5 operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Femoral embolectomy
B. Below-knee amputation
C. Carotid endarterectomy
D. Femoro-popliteal bypass (above knee, vein graft)
E. Radiocephalic arteriovenous fistula

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
A. femoral-embolectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.emb.groin-exposure                Exposure of the femoral bifurcation
  7 step.vasc.vessel-control               Proximal and distal control before opening the artery
  8 step.vasc.heparin                      Systemic heparin before clamping
  9 step.emb.arteriotomy                   Arteriotomy
 10 step.emb.catheter-passes               Balloon catheter passes
 11 step.vasc.flush-backbleed              Flushing and back-bleeding before the final sutures
 12 step.emb.arteriotomy-closure           Closure of the arteriotomy
 13 step.vasc.restore-flow                 Restoring flow with the anaesthetist warned
 14 step.vasc.perfusion-check              Confirming distal perfusion before leaving theatre
 15 step.emb.fasciotomy-decision           Fasciotomy decision
 16 step.core.haemostasis                  Haemostasis before closure
 17 step.core.counts                       Swab, instrument and needle counts
 18 step.core.specimen                     Specimen handling and labelling
 19 step.core.skin-closure                 Skin closure and dressing
 20 step.core.debrief                      Debrief, operative note and handover
B. below-knee-amputation
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.bka.flaps                         Marking the level and flaps
  7 step.bka.anterior                      Anterior and lateral compartments
  8 step.bka.vessels                       Division of the vessels
  9 step.bka.bone                          Division and shaping of the tibia and fibula
 10 step.bka.nerves                        Nerve handling
 11 step.bka.posterior                     Fashioning the posterior myocutaneous flap
 12 step.core.haemostasis                  Haemostasis before closure
 13 step.core.counts                       Swab, instrument and needle counts
 14 step.core.specimen                     Specimen handling and labelling
 15 step.core.skin-closure                 Skin closure and dressing
 16 step.core.debrief                      Debrief, operative note and handover
C. carotid-endarterectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.cea.anaesthesia-monitoring        Anaesthetic technique and cerebral monitoring
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.cea.exposure                      Exposure of the carotid sheath
  8 step.cea.nerves                        Identifying and protecting the cranial nerves
  9 step.vasc.vessel-control               Proximal and distal control before opening the artery
 10 step.vasc.heparin                      Systemic heparin before clamping
 11 step.cea.shunt                         Clamping, clamp tolerance and shunting
 12 step.cea.endarterectomy                Arteriotomy, plaque removal and the distal endpoint
 13 step.cea.patch-closure                 Closure of the arteriotomy with a patch
 14 step.vasc.flush-backbleed              Flushing and back-bleeding before the final sutures
 15 step.vasc.restore-flow                 Restoring flow with the anaesthetist warned
 16 step.vasc.heparin-reversal             Deciding on, and giving, heparin reversal
 17 step.core.haemostasis                  Haemostasis before closure
 18 step.core.counts                       Swab, instrument and needle counts
 19 step.core.specimen                     Specimen handling and labelling
 20 step.core.skin-closure                 Skin closure and dressing
 21 step.cea.neuro-check                   Neurological assessment before leaving theatre
 22 step.core.debrief                      Debrief, operative note and handover
D. fem-pop-bypass
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.vasc.vein-mapping                 Duplex vein assessment and marking
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.fp.groin-exposure                 Exposure of the common femoral bifurcation
  8 step.fp.popliteal-exposure             Exposure of the above-knee popliteal artery
  9 step.vasc.vein-harvest                 Harvesting and preparing a vein conduit
 10 step.fp.conduit-bailout                When the vein is inadequate
 11 step.fp.tunnel                         Tunnelling the graft
 12 step.vasc.heparin                      Systemic heparin before clamping
 13 step.vasc.vessel-control               Proximal and distal control before opening the artery
 14 step.vasc.end-to-side-anastomosis      End-to-side anastomosis
 15 step.vasc.flush-backbleed              Flushing and back-bleeding before the final sutures
 16 step.vasc.restore-flow                 Restoring flow with the anaesthetist warned
 17 step.vasc.perfusion-check              Confirming distal perfusion before leaving theatre
 18 step.core.haemostasis                  Haemostasis before closure
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.vasc.groin-closure                Layered closure of a groin incision
 21 step.core.skin-closure                 Skin closure and dressing
 22 step.core.debrief                      Debrief, operative note and handover
E. av-fistula-radiocephalic
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.vasc.vein-mapping                 Duplex vein assessment and marking
  5 step.avf.anaesthesia                   Anaesthesia that dilates the vessels
  6 step.core.positioning                  Positioning and pressure care
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.avf.exposure                      Incision and exposure at the wrist
  9 step.avf.vein-mobilise                 Mobilising and preparing the cephalic vein
 10 step.vasc.vessel-control               Proximal and distal control before opening the artery
 11 step.vasc.heparin                      Systemic heparin before clamping
 12 step.avf.arteriotomy                   Radial arteriotomy
 13 step.vasc.end-to-side-anastomosis      End-to-side anastomosis
 14 step.vasc.restore-flow                 Restoring flow with the anaesthetist warned
 15 step.vasc.perfusion-check              Confirming distal perfusion before leaving theatre
 16 step.avf.no-thrill                     No thrill or a cold hand
 17 step.core.haemostasis                  Haemostasis before closure
 18 step.core.counts                       Swab, instrument and needle counts
 19 step.core.skin-closure                 Skin closure and dressing
 20 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "femoral-embolectomy": {
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
  "below-knee-amputation": { ... }, "carotid-endarterectomy": { ... }, "fem-pop-bypass": { ... }, "av-fistula-radiocephalic": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
