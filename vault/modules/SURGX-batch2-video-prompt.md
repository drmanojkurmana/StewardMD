---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 2: Gemini video and timestamp prompt (4 operations)

Same four operations as [[SURGX-batch2-image-prompt]]. The step ids are the real ones from the JSON.
After Gemini answers, every video id is checked with YouTube oEmbed (200 means embedding is allowed, 401 means it is not),
added to the `_site/yt.html` ALLOW list and wired as `kind:"embed"` clips with `start` and `end` (see [[SURGX]]).

```
TASK
Find YouTube operative videos for four operations, watch them, and give me exact clip timestamps for each step
listed below. The clips will play inside a surgical training app, one clip under each step.

OPERATIONS
A. Laparoscopic cholecystectomy
B. Open inguinal hernia repair, Lichtenstein mesh
C. Lower segment caesarean section
D. Total thyroidectomy (with nerve monitoring if possible)

HOW TO CHOOSE VIDEOS
1. Search YouTube yourself. For each operation pick 2 to 4 videos that you can actually WATCH (video, not audio-only
   podcasts or slides). Prefer, in order: university or hospital channels, surgical societies and journals (for
   example SAGES, WebSurg/IRCAD, JOMI, BAETS, RCOG), recognised surgeon educators, then high-quality animations.
2. Embedding must be allowed. Do NOT use Nucleus Medical Media (embedding disabled). Skip any video marked
   "Video unavailable" or "Playback on other websites has been disabled".
3. The technique must be safe, current practice. Reject a video that clips before the Critical View of Safety, uses no
   mesh for an adult inguinal hernia, or shows unsafe nerve handling. Note anything else outdated in "concerns",
   but keep the video if the clip itself is correct.
4. Real operative footage is preferred for operative steps; an animation is fine where footage does not show the
   step clearly.

HOW TO TIME CLIPS
- Watch the video. Give start and end in WHOLE SECONDS from the start of the video, verified by watching, not
  guessed from chapters or the description.
- Each clip shows that step and only that step, 5 to 60 seconds long.
- If a step is not in your first videos, SEARCH FOR ANOTHER VIDEO that shows it before giving up. Only then use null.
  Team, consent, count, labelling and handover steps are often missing from operative videos; a separate good
  teaching video for them (for example a WHO Surgical Safety Checklist demonstration) is welcome.
- Videos need not follow the steps in the same order or name them the same way. Map what is shown to the step whose
  description matches.
- For each step pick ONE "best" clip.

THE STEPS (use these step ids exactly)
A. lap-cholecystectomy
  1 step.core.consent-check          Consent, site marking and identity check
  2 step.core.timeout                Team brief, sign-in and time-out
  3 step.core.prophylaxis            Antimicrobial and thromboprophylaxis
  4 step.core.positioning            Positioning: reverse Trendelenburg, left tilt
  5 step.core.prep-drape             Skin preparation and draping
  6 step.lap.access                  Establishing pneumoperitoneum (Veress or open Hasson)
  7 step.lap.ports                   Port placement
  8 step.lap.survey                  Diagnostic laparoscopy and survey
  9 step.chole.retraction            Retraction: fundus up, infundibulum lateral
 10 step.chole.cvs                   Dissection to the Critical View of Safety
 11 step.chole.divide                Clipping and dividing the cystic duct and artery
 12 step.chole.plate                 Separating the gallbladder from the liver bed (cystic plate)
 13 step.lap.specimen-retrieval      Specimen retrieval in a bag
 14 step.core.haemostasis            Haemostasis check of the bed and clips
 15 step.core.counts                 Swab, instrument and needle counts
 16 step.core.specimen               Specimen handling and labelling
 17 step.lap.closure                 Desufflation, port removal and fascial closure
 18 step.core.skin-closure           Skin closure and dressing
 19 step.core.debrief                Debrief, operative note and handover
B. hernia-repair
  1 step.core.consent-check          Consent, site marking and identity check
  2 step.core.timeout                Team brief, sign-in and time-out
  3 step.core.prophylaxis            Antimicrobial and thromboprophylaxis
  4 step.core.positioning            Positioning
  5 step.core.prep-drape             Skin preparation and draping
  6 step.hern.incision               Incision and opening the external oblique
  7 step.hern.cord                   Mobilising the cord, identifying the three nerves
  8 step.hern.sac                    Dealing with the indirect or direct sac
  9 step.hern.mesh                   Placing and fixing the mesh, new deep ring
 10 step.core.haemostasis            Haemostasis before closure
 11 step.core.counts                 Counts
 12 step.core.specimen               Specimen handling and labelling
 13 step.core.skin-closure           Closure of external oblique, skin and dressing
 14 step.core.debrief                Debrief, operative note and handover
C. lscs
  1 step.core.consent-check          Consent and identity check
  2 step.core.timeout                Team brief and time-out (with neonatal team)
  3 step.core.prophylaxis            Antibiotic before incision, thromboprophylaxis
  4 step.core.positioning            Left lateral tilt positioning
  5 step.core.prep-drape             Skin preparation, catheter and draping
  6 step.cs.entry                    Abdominal entry (Joel-Cohen / Pfannenstiel)
  7 step.cs.uterine-incision         Bladder reflection and lower segment uterine incision
  8 step.cs.delivery                 Delivery of the baby
  9 step.cs.placenta                 Uterotonic and placental delivery
 10 step.cs.uterine-closure          Uterine closure (angles, two layers)
 11 step.obg.adnexal-check           Inspect both tubes and ovaries
 12 step.core.haemostasis            Haemostasis before closure
 13 step.obg.blood-loss              Quantify blood loss
 14 step.core.counts                 Counts
 15 step.cs.sheath                   Rectus sheath closure
 16 step.core.skin-closure           Skin closure and dressing
 17 step.obg.rhesus                  Rhesus status and anti-D
 18 step.core.debrief                Debrief and handover
D. total-thyroidectomy
  1 step.core.consent-check          Consent, site marking and identity check
  2 step.onco.mdt-check              MDT decision, diagnosis and staging confirmed
  3 step.core.timeout                Team brief and time-out
  4 step.core.prophylaxis            Antimicrobial and thromboprophylaxis
  5 step.core.positioning            Shoulder roll, neck extension
  6 step.core.prep-drape             Skin preparation and draping
  7 step.thyr.incision               Collar incision, subplatysmal flaps, midline opening
  8 step.thyr.ionm-baseline          Vagal nerve-monitoring baseline (V1)
  9 step.thyr.superior-pole          Superior pole, external branch of the superior laryngeal nerve
 10 step.thyr.parathyroids           Identify and preserve the parathyroids
 11 step.thyr.rln                    Identify and trace the recurrent laryngeal nerve
 12 step.thyr.berry                  Ligament of Berry and lobe removal
 13 step.thyr.ionm-decision          Signal check after the first side (R2, V2)
 14 step.onco.specimen-orientation   Orienting the specimen for the pathologist
 15 step.core.haemostasis            Haemostasis before closure
 16 step.core.counts                 Counts
 17 step.core.specimen               Specimen labelling
 18 step.core.skin-closure           Closure and dressing
 19 step.core.debrief                Debrief and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "lap-cholecystectomy": {
    "videos": [
      { "key": "V1", "videoId": "11-char id", "url": "https://www.youtube.com/watch?v=...", "title": "...",
        "channel": "...", "durationSec": 0, "kind": "operative|animation|lecture|safety",
        "watched": true, "concerns": ["..."] }
    ],
    "steps": [
      { "n": 1, "id": "step.core.consent-check",
        "clips": [ { "video": "V1", "start": 0, "end": 0, "shows": "one line", "confidence": "high|medium|low" } ],
        "best": "V1" }
    ]
  },
  "hernia-repair": { ... }, "lscs": { ... }, "total-thyroidectomy": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
