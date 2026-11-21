---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 9b (urology: robotic, laparoscopic and open cancer and reconstruction): Gemini video and timestamp prompt (5 operations)

Same operations as [[SURGX-batch9b-image-prompt]]. Every video is checked in the real embedded player before wiring.

```
TASK
Find YouTube videos for 5 urological operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Laparoscopic or robotic pyeloplasty (LEFT kidney)
B. Robotic partial nephrectomy (RIGHT kidney tumour)
C. Robotic radical prostatectomy
D. Radical cystectomy with ileal conduit
E. Radical nephroureterectomy with bladder cuff (LEFT side)

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
A. uro-pyeloplasty
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.uro.urine-check                   Sterile urine before instrumentation
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.lap.access                        Establishing pneumoperitoneum
  8 step.lap.ports                         Port placement
  9 step.uro.robot-dock                    Robot docking and instrument check
 10 step.lap.survey                        Diagnostic laparoscopy and survey
 11 step.pyelo.expose                      Expose the pelvis, junction and any crossing vessel
 12 step.pyelo.divide                      Dismember and spatulate
 13 step.uro.dj-stent                      Double-J stent placement and position check
 14 step.pyelo.anastomosis                 Pelvi-ureteric anastomosis
 15 step.core.haemostasis                  Haemostasis before closure
 16 step.abd.drain                         Drain placement
 17 step.uro.stent-register                Stent register and removal plan
 18 step.core.counts                       Swab, instrument and needle counts
 19 step.lap.closure                       Desufflation and port-site closure
 20 step.core.debrief                      Debrief, operative note and handover
B. uro-partial-nephrectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.mdt-check                    MDT decision, staging and diagnosis confirmed
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.lap.access                        Establishing pneumoperitoneum
  8 step.uro.robot-dock                    Robot docking and instrument check
  9 step.lap.survey                        Diagnostic laparoscopy and survey
 10 step.pn.hilum                          Expose and control the hilum
 11 step.pn.ultrasound                     Ultrasound and score the margin
 12 step.pn.clamp                          Clamp the artery and start the clock
 13 step.pn.excise                         Excise the tumour with a rim
 14 step.pn.renorrhaphy                    Two-layer renorrhaphy
 15 step.pn.unclamp                        Unclamp and record the warm time
 16 step.hpb.major-bleed                   Major haemorrhage: press, tell, call, then repair or pack
 17 step.lap.specimen-retrieval            Specimen retrieval
 18 step.onco.specimen-orientation         Orienting the cancer specimen for the pathologist
 19 step.core.haemostasis                  Haemostasis before closure
 20 step.abd.drain                         Drain placement
 21 step.core.counts                       Swab, instrument and needle counts
 22 step.lap.closure                       Desufflation and port-site closure
 23 step.core.debrief                      Debrief, operative note and handover
C. uro-radical-prostatectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.mdt-check                    MDT decision, staging and diagnosis confirmed
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.lap.access                        Establishing pneumoperitoneum
  8 step.uro.robot-dock                    Robot docking and instrument check
  9 step.lap.survey                        Diagnostic laparoscopy and survey
 10 step.rp.bladder-drop                   Drop the bladder into the space of Retzius
 11 step.rp.bladder-neck                   Bladder neck dissection
 12 step.rp.seminal-vesicles               Seminal vesicles and posterior plane
 13 step.rp.nerves                         Pedicles and nerve sparing
 14 step.rp.apex                           Dorsal venous complex and apex
 15 step.rp.rectal-injury                  Bailout: rectal injury
 16 step.onco.nodal-clearance              En bloc nodal clearance by named level or station
 17 step.rp.anastomosis                    Vesicourethral anastomosis
 18 step.uro.bladder-leak-test             Bladder or anastomosis leak test
 19 step.lap.specimen-retrieval            Specimen retrieval
 20 step.onco.specimen-orientation         Orienting the cancer specimen for the pathologist
 21 step.abd.drain                         Drain placement
 22 step.uro.catheter-plan                 Catheter secured and plan recorded
 23 step.core.counts                       Swab, instrument and needle counts
 24 step.lap.closure                       Desufflation and port-site closure
 25 step.core.debrief                      Debrief, operative note and handover
D. uro-radical-cystectomy-ileal-conduit
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.mdt-check                    MDT decision, staging and diagnosis confirmed
  3 step.bowel.stoma-siting                Pre-operative stoma siting
  4 step.core.timeout                      Team brief, sign-in and time-out
  5 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  6 step.core.positioning                  Positioning and pressure care
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.abd.midline                       Midline laparotomy incision
  9 step.abd.exploration                   Systematic exploration
 10 step.rc.ureters                        Find and divide the ureters
 11 step.onco.nodal-clearance              En bloc nodal clearance by named level or station
 12 step.rc.pedicles                       Bladder pedicles and removal of the specimen
 13 step.onco.major-vein-injury            Major vein injury during a nodal clearance: press, control, repair
 14 step.onco.specimen-orientation         Orienting the cancer specimen for the pathologist
 15 step.rc.ileal-segment                  Isolate the ileal segment
 16 step.bowel.anastomosis-stapled         Stapled side-to-side (functional end-to-end) anastomosis
 17 step.rc.uretero-ileal                  Uretero-ileal anastomoses over stents
 18 step.bowel.stoma-mature                Maturing the stoma and checking viability
 19 step.uro.stent-register                Stent register and removal plan
 20 step.abd.drain                         Drain placement
 21 step.core.counts                       Swab, instrument and needle counts
 22 step.abd.mass-closure                  Mass closure of the abdominal wall
 23 step.core.skin-closure                 Skin closure and dressing
 24 step.core.debrief                      Debrief, operative note and handover
E. uro-nephroureterectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.mdt-check                    MDT decision, staging and diagnosis confirmed
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.lap.access                        Establishing pneumoperitoneum
  8 step.lap.ports                         Port placement
  9 step.lap.survey                        Diagnostic laparoscopy and survey
 10 step.onco.tumour-handling              Oncological handling: no touch, wound protection, clean field
 11 step.nu.clip-ureter                    Clip the ureter early
 12 step.nu.hilum                          Control the renal hilum, artery before vein
 13 step.nu.kidney                         Free the kidney outside Gerota's fascia
 14 step.nu.bladder-cuff                   Excise the bladder cuff
 15 step.uro.bladder-leak-test             Bladder or anastomosis leak test
 16 step.lap.specimen-retrieval            Specimen retrieval
 17 step.onco.specimen-orientation         Orienting the cancer specimen for the pathologist
 18 step.abd.drain                         Drain placement
 19 step.uro.catheter-plan                 Catheter secured and plan recorded
 20 step.nu.instillation                   Single intravesical chemotherapy instillation
 21 step.core.counts                       Swab, instrument and needle counts
 22 step.lap.closure                       Desufflation and port-site closure
 23 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "uro-pyeloplasty": {
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
  "uro-partial-nephrectomy": { ... }, "uro-radical-prostatectomy": { ... }, "uro-radical-cystectomy-ileal-conduit": { ... }, "uro-nephroureterectomy": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
