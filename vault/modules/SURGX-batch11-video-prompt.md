---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 11 (Laparoscopic inguinal hernia repair, Open umbilical and incisional hernia repair with mesh, Lateral internal sphincterotomy, Fistula-in-ano: fistulotomy and seton, Pilonidal sinus excision): Gemini video and timestamp prompt (5 operations)

Same operations as [[SURGX-batch11-image-prompt]].

```
TASK
Find YouTube videos for 5 operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Laparoscopic inguinal hernia repair
B. Open umbilical and incisional hernia repair with mesh
C. Lateral internal sphincterotomy
D. Fistula-in-ano: fistulotomy and seton
E. Pilonidal sinus excision

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
A. lap-inguinal-hernia-repair
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.lap.access                        Establishing pneumoperitoneum
  7 step.lih.tep-space                     TEP: entering and developing the preperitoneal space
  8 step.lap.ports                         Port placement
  9 step.lap.survey                        Diagnostic laparoscopy and survey
 10 step.lih.peritoneal-flap               TAPP: raising the peritoneal flap
 11 step.lih.landmarks                     Defining the myopectoral orifice and its danger zones
 12 step.hernia.convert                    Bailout: convert, stop, or call for help
 13 step.hernia.sac-reduction              Reducing the sac and judging its contents
 14 step.lih.parietalisation               Parietalisation of the cord structures
 15 step.hernia.contamination-bailout      Bailout: enterotomy or contamination in a mesh repair
 16 step.hernia.mesh-handling              Choosing, sizing and handling the mesh
 17 step.lih.mesh-place                    Positioning and fixing the mesh in the preperitoneal space
 18 step.lih.flap-closure                  Closing the peritoneum and deflating under vision
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.lap.closure                       Desufflation and port-site closure
 21 step.core.skin-closure                 Skin closure and dressing
 22 step.core.debrief                      Debrief, operative note and handover
B. open-ventral-hernia-repair
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.vhr.incision                      Incision and exposure of the hernia
  7 step.hernia.sac-reduction              Reducing the sac and judging its contents
  8 step.hernia.contamination-bailout      Bailout: enterotomy or contamination in a mesh repair
  9 step.vhr.defect-assess                 Measuring the defect and choosing the repair
 10 step.vhr.retrorectus                   Developing the retromuscular plane
 11 step.vhr.posterior-closure             Closing the posterior layer
 12 step.hernia.mesh-handling              Choosing, sizing and handling the mesh
 13 step.vhr.mesh-sublay                   Placing the mesh in the sublay position
 14 step.abd.drain                         Drain placement
 15 step.core.haemostasis                  Haemostasis before closure
 16 step.core.counts                       Swab, instrument and needle counts
 17 step.abd.mass-closure                  Mass closure of the abdominal wall
 18 step.core.specimen                     Specimen handling and labelling
 19 step.core.skin-closure                 Skin closure and dressing
 20 step.core.debrief                      Debrief, operative note and handover
C. lateral-internal-sphincterotomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.ano.local-block                   Local anaesthetic infiltration for perianal and sacrococcygeal surgery
  7 step.ano.eua                           Examination under anaesthesia: confirm the diagnosis before the operation
  8 step.ano.sphincter-identify            Identifying the internal and external sphincters
  9 step.ano.when-to-stop                  Bailout: stop, change the plan, or come back another day
 10 step.lis.approach                      Approach to the lateral internal sphincter: open or closed
 11 step.lis.division                      Dividing the internal sphincter to a tailored length
 12 step.lis.check                         Confirming the division and dealing with the fissure
 13 step.core.haemostasis                  Haemostasis before closure
 14 step.ano.final-inspection              Final inspection of the anal canal
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.core.specimen                     Specimen handling and labelling
 17 step.core.skin-closure                 Skin closure and dressing
 18 step.ano.wound-care                    Dressing, bowel regimen and the plan for the open wound
 19 step.core.debrief                      Debrief, operative note and handover
D. fistula-in-ano-surgery
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.ano.local-block                   Local anaesthetic infiltration for perianal and sacrococcygeal surgery
  7 step.ano.eua                           Examination under anaesthesia: confirm the diagnosis before the operation
  8 step.ano.sphincter-identify            Identifying the internal and external sphincters
  9 step.fia.internal-opening              Finding the internal opening
 10 step.fia.classify                      Classifying the tract and deciding: lay open or seton
 11 step.ano.when-to-stop                  Bailout: stop, change the plan, or come back another day
 12 step.fia.fistulotomy                   Fistulotomy: laying open a simple low tract
 13 step.fia.seton                         Placing a loose draining seton
 14 step.core.haemostasis                  Haemostasis before closure
 15 step.ano.final-inspection              Final inspection of the anal canal
 16 step.core.counts                       Swab, instrument and needle counts
 17 step.core.specimen                     Specimen handling and labelling
 18 step.ano.wound-care                    Dressing, bowel regimen and the plan for the open wound
 19 step.core.debrief                      Debrief, operative note and handover
E. pilonidal-sinus-excision
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.pns.mapping                       Mapping the pits and tracts
  7 step.ano.local-block                   Local anaesthetic infiltration for perianal and sacrococcygeal surgery
  8 step.pns.excision                      Excising the sinus and its tracts
  9 step.pns.closure-decision              Choosing how to close: open, midline or off-midline
 10 step.core.haemostasis                  Haemostasis before closure
 11 step.pns.offmidline                    Off-midline closure: flattening the cleft
 12 step.pns.leave-open                    Bailout: abandon primary closure and leave the wound open
 13 step.abd.drain                         Drain placement
 14 step.core.counts                       Swab, instrument and needle counts
 15 step.core.specimen                     Specimen handling and labelling
 16 step.core.skin-closure                 Skin closure and dressing
 17 step.ano.wound-care                    Dressing, bowel regimen and the plan for the open wound
 18 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "lap-inguinal-hernia-repair": {
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
  "open-ventral-hernia-repair": { ... }, "lateral-internal-sphincterotomy": { ... }, "fistula-in-ano-surgery": { ... }, "pilonidal-sinus-excision": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
