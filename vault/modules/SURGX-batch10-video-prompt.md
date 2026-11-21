---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 10 (Abscess incision and drainage, Hartmann's procedure, Loop ileostomy: formation and closure, Laparoscopic repair of perforated duodenal ulcer, Small bowel resection with anastomosis): Gemini video and timestamp prompt (5 operations)

Same operations as [[SURGX-batch10-image-prompt]].

```
TASK
Find YouTube videos for 5 operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Abscess incision and drainage
B. Hartmann's procedure
C. Loop ileostomy: formation and closure
D. Laparoscopic repair of perforated duodenal ulcer
E. Small bowel resection with anastomosis

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
A. abscess-drainage
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.positioning                  Positioning and pressure care
  4 step.core.prep-drape                   Skin preparation and draping
  5 step.st.local                          Local anaesthesia for an inflamed field
  6 step.st.incision                       Incision over the collection
  7 step.st.culture                        Pus for culture
  8 step.st.deloculate                     Breaking down loculations
  9 step.st.pack                           Irrigation, packing and leaving the wound open
 10 step.core.specimen                     Specimen handling and labelling
 11 step.core.debrief                      Debrief, operative note and handover
B. hartmanns-procedure
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.bowel.stoma-siting                Pre-operative stoma siting
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.abd.midline                       Midline laparotomy incision
  8 step.abd.exploration                   Systematic exploration
  9 step.abd.bowel-handling                Handling and assessing bowel
 10 step.hartmann.mobilise                 Lateral mobilisation and ureter identification
 11 step.bowel.mesentery-division          Dividing the mesentery
 12 step.hartmann.rectal-stump             Transecting and securing the rectal stump
 13 step.bowel.bowel-division              Dividing the bowel
 14 step.abd.lavage                        Peritoneal toilet
 15 step.core.haemostasis                  Haemostasis before closure
 16 step.abd.drain                         Drain placement
 17 step.core.counts                       Swab, instrument and needle counts
 18 step.core.specimen                     Specimen handling and labelling
 19 step.bowel.trephine                    Creating the stoma trephine
 20 step.abd.stoma                         Stoma formation
 21 step.abd.mass-closure                  Mass closure of the abdominal wall
 22 step.core.skin-closure                 Skin closure and dressing
 23 step.bowel.stoma-mature                Maturing the stoma and checking viability
 24 step.core.debrief                      Debrief, operative note and handover
C. loop-ileostomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.bowel.stoma-siting                Pre-operative stoma siting
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.ileo.select-loop                  Selecting and orienting the loop
  8 step.bowel.trephine                    Creating the stoma trephine
  9 step.ileo.deliver-loop                 Delivering the loop and placing the rod
 10 step.bowel.stoma-mature                Maturing the stoma and checking viability
 11 step.ileo.closure-mobilise             Closure: freeing the stoma from the abdominal wall
 12 step.bowel.anastomosis-stapled         Stapled side-to-side (functional end-to-end) anastomosis
 13 step.bowel.anastomosis-handsewn        Handsewn anastomosis
 14 step.bowel.leak-check                  Checking the repair or anastomosis
 15 step.ileo.fascia-closure               Closure: returning the bowel and closing the fascia
 16 step.core.haemostasis                  Haemostasis before closure
 17 step.core.counts                       Swab, instrument and needle counts
 18 step.core.specimen                     Specimen handling and labelling
 19 step.core.skin-closure                 Skin closure and dressing
 20 step.core.debrief                      Debrief, operative note and handover
D. lap-perforated-duodenal-ulcer
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.lap.access                        Establishing pneumoperitoneum
  7 step.lap.ports                         Port placement
  8 step.lap.survey                        Diagnostic laparoscopy and survey
  9 step.pdu.expose                        Exposing and assessing the perforation
 10 step.pdu.patch                         Omental patch repair
 11 step.bowel.leak-check                  Checking the repair or anastomosis
 12 step.pdu.convert                       When to convert or change the operation
 13 step.abd.lavage                        Peritoneal toilet
 14 step.abd.drain                         Drain placement
 15 step.core.haemostasis                  Haemostasis before closure
 16 step.core.counts                       Swab, instrument and needle counts
 17 step.core.specimen                     Specimen handling and labelling
 18 step.lap.closure                       Desufflation and port-site closure
 19 step.core.skin-closure                 Skin closure and dressing
 20 step.core.debrief                      Debrief, operative note and handover
E. small-bowel-resection
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.abd.midline                       Midline laparotomy incision
  7 step.abd.exploration                   Systematic exploration
  8 step.abd.bowel-handling                Handling and assessing bowel
  9 step.sbr.define-margins                Deciding the extent of resection
 10 step.bowel.mesentery-division          Dividing the mesentery
 11 step.bowel.bowel-division              Dividing the bowel
 12 step.bowel.anastomosis-stapled         Stapled side-to-side (functional end-to-end) anastomosis
 13 step.bowel.anastomosis-handsewn        Handsewn anastomosis
 14 step.sbr.mesenteric-defect             Closing the mesenteric defect
 15 step.bowel.leak-check                  Checking the repair or anastomosis
 16 step.sbr.measure-length                Measuring and recording residual small bowel
 17 step.abd.lavage                        Peritoneal toilet
 18 step.core.haemostasis                  Haemostasis before closure
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.core.specimen                     Specimen handling and labelling
 21 step.abd.mass-closure                  Mass closure of the abdominal wall
 22 step.core.skin-closure                 Skin closure and dressing
 23 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "abscess-drainage": {
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
  "hartmanns-procedure": { ... }, "loop-ileostomy": { ... }, "lap-perforated-duodenal-ulcer": { ... }, "small-bowel-resection": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
