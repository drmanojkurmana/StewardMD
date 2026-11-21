---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 17 (Operative reduction of intussusception, Laparotomy for malrotation, Laparoscopic salpingectomy for ectopic pregnancy, Laparoscopic ovarian cystectomy, Surgical management of miscarriage: manual or electric vacuum aspiration): Gemini video and timestamp prompt (5 operations)

Same operations as [[SURGX-batch17-image-prompt]].

```
TASK
Find YouTube videos for 5 operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Operative reduction of intussusception
B. Laparotomy for malrotation (Ladd procedure)
C. Laparoscopic salpingectomy for ectopic pregnancy
D. Laparoscopic ovarian cystectomy
E. Surgical management of miscarriage: manual or electric vacuum aspiration

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
A. paeds-intussusception-reduction
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.paeds.physiology-gate             Paediatric physiology check before anaesthesia
  4 step.paeds.infant-laparotomy-prep      Resuscitation, decompression and lines before a paediatric laparotomy
  5 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  6 step.paeds.warming                     Thermal care for the infant
  7 step.core.positioning                  Positioning and pressure care
  8 step.core.prep-drape                   Skin preparation and draping
  9 step.paeds.transverse-laparotomy       Transverse laparotomy in an infant or child
 10 step.intus.deliver                     Finding and delivering the intussusception
 11 step.intus.reduce                      Manual reduction by retrograde squeezing
 12 step.abd.bowel-handling                Handling and assessing bowel
 13 step.intus.lead-point                  Searching for a pathological lead point
 14 step.intus.resect                      Resection when reduction fails or the bowel is not viable
 15 step.bowel.anastomosis-handsewn        Handsewn anastomosis
 16 step.paeds.incidental-appendicectomy   Appendicectomy at laparotomy for malrotation or intussusception
 17 step.core.haemostasis                  Haemostasis before closure
 18 step.core.specimen                     Specimen handling and labelling
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.paeds.transverse-closure          Closing a transverse paediatric laparotomy
 21 step.core.skin-closure                 Skin closure and dressing
 22 step.core.debrief                      Debrief, operative note and handover
B. paeds-ladd-procedure
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.paeds.physiology-gate             Paediatric physiology check before anaesthesia
  4 step.paeds.infant-laparotomy-prep      Resuscitation, decompression and lines before a paediatric laparotomy
  5 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  6 step.paeds.warming                     Thermal care for the infant
  7 step.core.positioning                  Positioning and pressure care
  8 step.core.prep-drape                   Skin preparation and draping
  9 step.paeds.transverse-laparotomy       Transverse laparotomy in an infant or child
 10 step.ladd.eviscerate                   Eviscerating the midgut and recognising the volvulus
 11 step.ladd.derotate                     Derotating the volvulus anticlockwise
 12 step.abd.bowel-handling                Handling and assessing bowel
 13 step.ladd.second-look                  Doubtful viability: preserve, close temporarily and look again
 14 step.ladd.bands                        Dividing Ladd bands and confirming duodenal patency
 15 step.ladd.mesentery                    Widening the mesentery and placing the bowel in non-rotation
 16 step.paeds.incidental-appendicectomy   Appendicectomy at laparotomy for malrotation or intussusception
 17 step.core.haemostasis                  Haemostasis before closure
 18 step.core.specimen                     Specimen handling and labelling
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.paeds.transverse-closure          Closing a transverse paediatric laparotomy
 21 step.core.skin-closure                 Skin closure and dressing
 22 step.core.debrief                      Debrief, operative note and handover
C. lap-salpingectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.lap.access                        Establishing pneumoperitoneum
  7 step.lap.ports                         Port placement
  8 step.lap.survey                        Diagnostic laparoscopy and survey
  9 step.salp.control                      Controlling the bleeding and evacuating haemoperitoneum
 10 step.salp.excise                       Salpingectomy
 11 step.obg.adnexal-check                 Inspect both tubes and ovaries
 12 step.lap.specimen-retrieval            Specimen retrieval
 13 step.core.haemostasis                  Haemostasis before closure
 14 step.obg.blood-loss                    Quantify blood loss and agree the next step
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.core.specimen                     Specimen handling and labelling
 17 step.lap.closure                       Desufflation and port-site closure
 18 step.core.skin-closure                 Skin closure and dressing
 19 step.obg.rhesus                        Rhesus status and anti-D
 20 step.core.debrief                      Debrief, operative note and handover
D. lap-ovarian-cystectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.obg.preop-check                   Confirm the indication, pregnancy status and pre-operative work-up
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.obg.lithotomy-eua                 Lithotomy, bladder and examination under anaesthesia
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.lap.access                        Establishing pneumoperitoneum
  9 step.lap.ports                         Port placement
 10 step.lap.survey                        Diagnostic laparoscopy and survey
 11 step.obg.adnexal-check                 Inspect both tubes and ovaries
 12 step.ovc.suspicion                     Unexpected features of malignancy, or an operation that cannot be finished safely
 13 step.obg.ureter-identification         Identify the ureter before dividing pelvic pedicles
 14 step.ovc.incision                      Incising the ovarian cortex
 15 step.ovc.enucleation                   Stripping the cyst from the ovary
 16 step.ovc.bed-haemostasis               Ovary-sparing haemostasis of the cyst bed
 17 step.lap.specimen-retrieval            Specimen retrieval
 18 step.core.specimen                     Specimen handling and labelling
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.lap.closure                       Desufflation and port-site closure
 21 step.core.debrief                      Debrief, operative note and handover
E. evacuation-rpoc
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.obg.preop-check                   Confirm the indication, pregnancy status and pre-operative work-up
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.obg.lithotomy-eua                 Lithotomy, bladder and examination under anaesthesia
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.erpc.dilate                       Cervical traction and gentle dilatation
  9 step.erpc.evacuate                     Vacuum aspiration of the uterine cavity
 10 step.erpc.completeness                 Confirming the cavity is empty and tissue was obtained
 11 step.erpc.perforation                  Suspected uterine perforation
 12 step.obg.blood-loss                    Quantify blood loss and agree the next step
 13 step.core.specimen                     Specimen handling and labelling
 14 step.obg.rhesus                        Rhesus status and anti-D
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "paeds-intussusception-reduction": {
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
  "paeds-ladd-procedure": { ... }, "lap-salpingectomy": { ... }, "lap-ovarian-cystectomy": { ... }, "evacuation-rpoc": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
