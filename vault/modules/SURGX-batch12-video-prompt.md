---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 12 (Laparoscopic Nissen fundoplication, Laparoscopic sleeve gastrectomy, Left hemicolectomy and sigmoid colectomy, Open and subtotal cholecystectomy, Laparoscopic common bile duct exploration): Gemini video and timestamp prompt (5 operations)

Same operations as [[SURGX-batch12-image-prompt]].

```
TASK
Find YouTube videos for 5 operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Laparoscopic Nissen fundoplication
B. Laparoscopic sleeve gastrectomy
C. Left hemicolectomy and sigmoid colectomy
D. Open and subtotal cholecystectomy
E. Laparoscopic common bile duct exploration

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
A. lap-nissen-fundoplication
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.lap.access                        Establishing pneumoperitoneum
  7 step.lap.ports                         Port placement
  8 step.hernia.liver-retraction           Retracting the left lobe of the liver
  9 step.hernia.short-gastrics             Dividing the short gastric vessels and freeing the fundus
 10 step.hernia.hiatal-dissection          Dissecting the hiatus and the crura
 11 step.hernia.sac-reduction              Reducing the sac and judging its contents
 12 step.nis.oesophageal-length            Mediastinal mobilisation and intra-abdominal oesophageal length
 13 step.hernia.convert                    Bailout: convert, stop, or call for help
 14 step.hernia.bougie                     Passing the calibration bougie safely
 15 step.hernia.crural-repair              Crural closure
 16 step.nis.wrap                          Constructing a short, floppy 360 degree wrap
 17 step.core.haemostasis                  Haemostasis before closure
 18 step.core.counts                       Swab, instrument and needle counts
 19 step.lap.closure                       Desufflation and port-site closure
 20 step.core.skin-closure                 Skin closure and dressing
 21 step.core.debrief                      Debrief, operative note and handover
B. lap-sleeve-gastrectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.lap.access                        Establishing pneumoperitoneum
  7 step.lap.ports                         Port placement
  8 step.hernia.liver-retraction           Retracting the left lobe of the liver
  9 step.slv.start-point                   Marking the antral starting point
 10 step.hernia.short-gastrics             Dividing the short gastric vessels and freeing the fundus
 11 step.hernia.hiatal-dissection          Dissecting the hiatus and the crura
 12 step.hernia.crural-repair              Crural closure
 13 step.hernia.bougie                     Passing the calibration bougie safely
 14 step.slv.stapling                      Stapling the sleeve along the bougie
 15 step.hernia.convert                    Bailout: convert, stop, or call for help
 16 step.bowel.leak-check                  Checking the repair or anastomosis
 17 step.core.haemostasis                  Haemostasis before closure
 18 step.lap.specimen-retrieval            Specimen retrieval
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.lap.closure                       Desufflation and port-site closure
 21 step.core.specimen                     Specimen handling and labelling
 22 step.core.debrief                      Debrief, operative note and handover
C. left-hemicolectomy-sigmoid
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.lap.access                        Establishing pneumoperitoneum
  7 step.lap.ports                         Port placement
  8 step.lap.survey                        Diagnostic laparoscopy and survey
  9 step.bowel.left-medial-to-lateral      Medial-to-lateral mobilisation of the left colon and sigmoid, ureter first
 10 step.bowel.ima-ligation                Inferior mesenteric artery and vein ligation
 11 step.bowel.splenic-flexure             Splenic flexure mobilisation
 12 step.lhc.distal-transection            Choosing and dividing the distal resection line
 13 step.lap.specimen-retrieval            Specimen retrieval
 14 step.bowel.bowel-division              Dividing the bowel
 15 step.bowel.circular-anastomosis        Circular stapled colorectal anastomosis (double-stapled)
 16 step.bowel.leak-check                  Checking the repair or anastomosis
 17 step.bowel.colorectal-bailout          Deciding against an unprotected anastomosis: defunction or end colostomy
 18 step.core.haemostasis                  Haemostasis before closure
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.core.specimen                     Specimen handling and labelling
 21 step.core.skin-closure                 Skin closure and dressing
 22 step.core.debrief                      Debrief, operative note and handover
D. open-subtotal-cholecystectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.hpb.upper-access                  Upper abdominal incision and fixed retraction
  7 step.ochole.exposure                   Open exposure: packs, retraction and landmarks
  8 step.ochole.fundus-first               Fundus-first (dome-down) dissection on the gallbladder wall
  9 step.hpb.cholangiogram                 Intra-operative cholangiography
 10 step.ochole.stop-rule                  The stop rule: complete, subtotal or abandon
 11 step.ochole.cystic-control             Dividing the cystic duct and artery (total cholecystectomy)
 12 step.ochole.subtotal                   Subtotal cholecystectomy: fenestrating or reconstituting
 13 step.hpb.pringle                       Pringle manoeuvre: sling, clamp, time, release
 14 step.ochole.duct-injury                Suspected bile duct injury: stop, define, drain, refer
 15 step.hpb.bile-leak-check               Checking for bile leakage before closure
 16 step.abd.drain                         Drain placement
 17 step.core.haemostasis                  Haemostasis before closure
 18 step.core.counts                       Swab, instrument and needle counts
 19 step.core.specimen                     Specimen handling and labelling
 20 step.abd.mass-closure                  Mass closure of the abdominal wall
 21 step.core.skin-closure                 Skin closure and dressing
 22 step.core.debrief                      Debrief, operative note and handover
E. lap-cbd-exploration
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.lap.access                        Establishing pneumoperitoneum
  7 step.lap.ports                         Port placement
  8 step.cbde.cvs-first                    Critical View of Safety before any duct is opened
  9 step.hpb.cholangiogram                 Intra-operative cholangiography
 10 step.cbde.route-decision               Choosing the route: transcystic or choledochotomy
 11 step.cbde.transcystic                  Transcystic exploration
 12 step.cbde.choledochotomy               Anterior vertical choledochotomy
 13 step.cbde.clearance                    Stone clearance and confirming a clear duct
 14 step.cbde.duct-closure                 Closing the choledochotomy
 15 step.cbde.abandon                      When the duct cannot be cleared: drain, stent or convert
 16 step.hpb.bile-leak-check               Checking for bile leakage before closure
 17 step.abd.drain                         Drain placement
 18 step.core.haemostasis                  Haemostasis before closure
 19 step.lap.specimen-retrieval            Specimen retrieval
 20 step.core.counts                       Swab, instrument and needle counts
 21 step.lap.closure                       Desufflation and port-site closure
 22 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "lap-nissen-fundoplication": {
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
  "lap-sleeve-gastrectomy": { ... }, "left-hemicolectomy-sigmoid": { ... }, "open-subtotal-cholecystectomy": { ... }, "lap-cbd-exploration": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
