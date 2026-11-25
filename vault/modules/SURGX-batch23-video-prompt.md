---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 23 (Hemiarthroplasty of the hip, Open reduction and internal fixation of the ankle, Distal radius fracture fixation, Arthroscopic ACL reconstruction, Split-thickness skin graft): Gemini video and timestamp prompt (5 operations)

Same operations as [[SURGX-batch23-image-prompt]].

```
TASK
Find YouTube videos for 5 operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Hemiarthroplasty of the hip
B. Open reduction and internal fixation of the ankle
C. Distal radius fracture fixation
D. Arthroscopic ACL reconstruction (hamstring graft)
E. Split-thickness skin graft

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
A. hip-hemiarthroplasty
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.ortho.arthroplasty-asepsis        Arthroplasty theatre discipline and asepsis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.ortho.posterior-hip-approach      Posterior (Southern) approach to the hip
  8 step.ortho.neck-osteotomy              Dislocation and femoral neck osteotomy
  9 step.hemi.head-sizing                  Measuring the femoral head and choosing the prosthetic head
 10 step.ortho.femoral-canal-prep          Femoral canal preparation and broaching
 11 step.ortho.trial-reduction             Trial components: stability, length and range
 12 step.ortho.implant-check               Implant selection, check and register
 13 step.ortho.cement-implant              Cementing and implanting with a cement safety pause
 14 step.ortho.hip-final-reduction         Definitive reduction and stability check of the hip
 15 step.ortho.periprosthetic-fracture     Intra-operative periprosthetic fracture: stop and reassess
 16 step.ortho.posterior-repair            Posterior capsule and short external rotator repair
 17 step.core.haemostasis                  Haemostasis before closure
 18 step.core.counts                       Swab, instrument and needle counts
 19 step.core.specimen                     Specimen handling and labelling
 20 step.core.skin-closure                 Skin closure and dressing
 21 step.ortho.nv-check                    Neurovascular and compartment check before leaving theatre
 22 step.core.debrief                      Debrief, operative note and handover
B. ankle-orif
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.ortho.tourniquet                  Tourniquet: decide, apply, record
  6 step.ortho.image-intensifier           Image intensifier set-up and radiation safety
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.ankle.lateral-approach            Lateral approach to the distal fibula
  9 step.ortho.fracture-exposure           Exposing and cleaning the fracture
 10 step.ortho.reduction-check             Reduction confirmed in two planes
 11 step.ortho.provisional-fixation        Provisional fixation with clamps and K-wires
 12 step.ortho.implant-check               Implant selection, check and register
 13 step.ortho.plate-fixation              Plate application and screw insertion
 14 step.ankle.medial-malleolus            Medial malleolus reduction and fixation
 15 step.ankle.syndesmosis                 Syndesmosis: test, reduce and fix
 16 step.ortho.final-imaging               Final images saved in two planes
 17 step.ortho.fixation-bailout            Bail-out when definitive fixation is not safe
 18 step.core.haemostasis                  Haemostasis before closure
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.core.skin-closure                 Skin closure and dressing
 21 step.ortho.nv-check                    Neurovascular and compartment check before leaving theatre
 22 step.core.debrief                      Debrief, operative note and handover
C. distal-radius-fixation
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.ortho.tourniquet                  Tourniquet: decide, apply, record
  6 step.ortho.image-intensifier           Image intensifier set-up and radiation safety
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.dr.fcr-approach                   Volar approach through the flexor carpi radialis sheath
  9 step.ortho.fracture-exposure           Exposing and cleaning the fracture
 10 step.ortho.reduction-check             Reduction confirmed in two planes
 11 step.ortho.provisional-fixation        Provisional fixation with clamps and K-wires
 12 step.ortho.implant-check               Implant selection, check and register
 13 step.ortho.plate-fixation              Plate application and screw insertion
 14 step.dr.screw-check                    Plate position and screw length check
 15 step.dr.kwire                          K-wire fixation (alternative to plating)
 16 step.ortho.fixation-bailout            Bail-out when definitive fixation is not safe
 17 step.ortho.final-imaging               Final images saved in two planes
 18 step.core.haemostasis                  Haemostasis before closure
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.core.skin-closure                 Skin closure and dressing
 21 step.ortho.nv-check                    Neurovascular and compartment check before leaving theatre
 22 step.core.debrief                      Debrief, operative note and handover
D. acl-reconstruction
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.acl.eua                           Examination under anaesthesia
  5 step.core.positioning                  Positioning and pressure care
  6 step.ortho.tourniquet                  Tourniquet: decide, apply, record
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.acl.portals-diagnostic            Arthroscopic portals and diagnostic arthroscopy
  9 step.acl.graft-harvest                 Hamstring graft harvest (semitendinosus and gracilis)
 10 step.acl.graft-prep                    Graft preparation and sizing
 11 step.acl.femoral-tunnel                Notch preparation and anatomical femoral tunnel
 12 step.acl.tibial-tunnel                 Anatomical tibial tunnel
 13 step.ortho.implant-check               Implant selection, check and register
 14 step.acl.pass-fix                      Graft passage, tensioning and fixation
 15 step.acl.final-check                   Final graft check: impingement, tension and stability
 16 step.acl.bailout                       Graft or tunnel problems: change the plan safely
 17 step.core.haemostasis                  Haemostasis before closure
 18 step.core.counts                       Swab, instrument and needle counts
 19 step.core.skin-closure                 Skin closure and dressing
 20 step.ortho.nv-check                    Neurovascular and compartment check before leaving theatre
 21 step.core.debrief                      Debrief, operative note and handover
E. split-skin-graft
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.ortho.tourniquet                  Tourniquet: decide, apply, record
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.st.debride                        Debridement of non-viable tissue
  8 step.core.haemostasis                  Haemostasis before closure
  9 step.stsg.harvest                      Graft harvest
 10 step.stsg.mesh                         Meshing or fenestration
 11 step.stsg.inset                        Graft inset and fixation
 12 step.ortho.wound-photos                Wound photographs at key stages
 13 step.stsg.dressing                     Graft dressing and immobilisation
 14 step.stsg.donor                        Donor site dressing
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "hip-hemiarthroplasty": {
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
  "ankle-orif": { ... }, "distal-radius-fixation": { ... }, "acl-reconstruction": { ... }, "split-skin-graft": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
