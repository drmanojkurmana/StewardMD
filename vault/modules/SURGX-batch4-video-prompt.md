---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 4: Gemini video and timestamp prompt (5 operations)

Same five operations as [[SURGX-batch4-image-prompt]]. The step ids are the real ones from the JSON.
After Gemini answers, every video is checked in the REAL embedded player with a referrer (oEmbed alone passes
age-restricted videos, see [[SURGX]] "Age-restricted videos"), added to the `_site/yt.html` ALLOW list and wired as
`kind:"embed"` clips with `start` and `end`.

```
TASK
Find YouTube videos for five operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Exploratory laparotomy (midline)
B. Modified radical mastectomy with level I and II axillary clearance
C. Total hip replacement, posterior approach
D. Total abdominal hysterectomy (Pfannenstiel)
E. Intercostal chest drain insertion (Seldinger and blunt dissection)

HOW TO CHOOSE VIDEOS
1. Search YouTube yourself. For each operation pick 2 to 4 videos that you can actually WATCH (video, not audio-only
   podcasts or slides). Prefer, in order: university or hospital channels, surgical societies and journals (for
   example WebSurg/IRCAD, JOMI, RCS, ASGBI, ABS, BOA, AAOS/OrthoInfo, RCOG, BTS), recognised surgeon educators, then
   high-quality animations.
2. Embedding must be allowed and the video must NOT be age-restricted. Age-restricted videos (many real operative
   videos are) will not play in the app: if YouTube asks to confirm your age, or shows "Sign in to confirm your age",
   reject it. Do NOT use Nucleus Medical Media (embedding disabled). Skip any video marked "Video unavailable" or
   "Playback on other websites has been disabled".
3. The technique must be safe, current practice. Reject a video that closes a laparotomy with large bites through
   muscle, uses a trocar to insert a chest drain, clamps the uterine vessels far from the uterus, or dislocates the
   hip without protecting the sciatic nerve. Note anything else outdated in "concerns", but keep the video if the
   clip itself is correct.
4. Real operative footage is preferred for operative steps; an animation is fine where footage does not show the
   step clearly.

HOW TO TIME CLIPS
- Watch the video (use its transcript and chapters to find the moment, then watch). Give start and end in WHOLE
  SECONDS from the start of the video, verified by watching, not guessed from chapters or the description.
- Each clip shows that step and only that step, 10 to 90 seconds long. Never give a whole long video: skip intros,
  channel promos, sponsor reads, "like and subscribe" and outros.
- For every clip quote the first and last sentence spoken (or describe the first and last frame if there is no
  speech), so I can verify it.
- If a step is not in your first videos, SEARCH FOR ANOTHER VIDEO that shows it before giving up. Only then use null.
  Team, consent, count, labelling and handover steps are often missing from operative videos; a separate good
  teaching video for them (for example a WHO Surgical Safety Checklist demonstration) is welcome.
- Videos need not follow the steps in the same order or name them the same way. Map what is shown to the step whose
  description matches.
- For each step pick ONE "best" clip.

THE STEPS (use these step ids exactly)
A. laparotomy
  1 step.core.consent-check            Consent, site marking and identity check
  2 step.core.timeout                  Team brief, sign-in and time-out
  3 step.core.prophylaxis              Antimicrobial and thromboprophylaxis
  4 step.core.positioning              Positioning and pressure care
  5 step.core.prep-drape               Skin preparation and draping
  6 step.abd.midline                   Midline laparotomy incision
  7 step.abd.exploration               Systematic exploration
  8 step.abd.bowel-handling            Handling and assessing bowel
  9 step.lap.survey                    Diagnostic laparoscopy and survey
 10 step.lapa.damage-control           The damage-control decision
 11 step.abd.lavage                    Peritoneal toilet
 12 step.abd.stoma                     Stoma formation
 13 step.abd.drain                     Drain placement
 14 step.core.haemostasis              Haemostasis before closure
 15 step.core.counts                   Swab, instrument and needle counts
 16 step.core.specimen                 Specimen handling and labelling
 17 step.abd.mass-closure              Mass closure of the abdominal wall
 18 step.core.skin-closure             Skin closure and dressing
 19 step.core.debrief                  Debrief, operative note and handover
B. modified-radical-mastectomy
  1 step.core.consent-check            Consent, site marking and identity check
  2 step.onco.mdt-check                MDT decision, staging and diagnosis confirmed
  3 step.core.timeout                  Team brief, sign-in and time-out
  4 step.core.prophylaxis              Antimicrobial and thromboprophylaxis
  5 step.core.positioning              Positioning and pressure care
  6 step.core.prep-drape               Skin preparation and draping
  7 step.mrm.incision-flaps            Elliptical incision and skin flaps in the mastectomy plane
  8 step.mrm.pectoral                  Removing the breast with the pectoralis major fascia
  9 step.onco.tumour-handling          Oncological handling: no touch, wound protection, clean field
 10 step.onco.axilla-entry             Entering the axilla through the clavipectoral fascia
 11 step.mrm.axillary-clearance        Level I and II axillary clearance with nerve preservation
 12 step.onco.specimen-orientation     Orienting the cancer specimen for the pathologist
 13 step.core.haemostasis              Haemostasis before closure
 14 step.mrm.drains                    Drainage of the flaps and axilla
 15 step.core.counts                   Swab, instrument and needle counts
 16 step.core.specimen                 Specimen handling and labelling
 17 step.core.skin-closure             Skin closure and dressing
 18 step.core.debrief                  Debrief, operative note and handover
C. total-hip-replacement
  1 step.core.consent-check            Consent, site marking and identity check
  2 step.core.timeout                  Team brief, sign-in and time-out
  3 step.core.prophylaxis              Antimicrobial and thromboprophylaxis
  4 step.ortho.arthroplasty-asepsis    Arthroplasty theatre discipline and asepsis
  5 step.core.positioning              Positioning and pressure care
  6 step.core.prep-drape               Skin preparation and draping
  7 step.ortho.posterior-hip-approach  Posterior (Southern) approach to the hip
  8 step.ortho.neck-osteotomy          Dislocation and femoral neck osteotomy
  9 step.thr.acetabulum-prep           Acetabular exposure and reaming
 10 step.thr.cup                       Acetabular component orientation and fixation
 11 step.ortho.femoral-canal-prep      Femoral canal preparation and broaching
 12 step.ortho.trial-reduction         Trial components: stability, length and range
 13 step.ortho.implant-check           Implant selection, check and register
 14 step.ortho.cement-implant          Cementing and implanting with a cement safety pause
 15 step.ortho.hip-final-reduction     Definitive reduction and stability check of the hip
 16 step.ortho.periprosthetic-fracture Intra-operative periprosthetic fracture: stop and reassess
 17 step.ortho.posterior-repair        Posterior capsule and short external rotator repair
 18 step.core.haemostasis              Haemostasis before closure
 19 step.core.counts                   Swab, instrument and needle counts
 20 step.core.skin-closure             Skin closure and dressing
 21 step.ortho.nv-check                Neurovascular and compartment check before leaving theatre
 22 step.core.debrief                  Debrief, operative note and handover
D. total-abdominal-hysterectomy
  1 step.core.consent-check            Consent, site marking and identity check
  2 step.core.timeout                  Team brief, sign-in and time-out
  3 step.obg.preop-check               Confirm the indication, pregnancy status and pre-operative work-up
  4 step.core.prophylaxis              Antimicrobial and thromboprophylaxis
  5 step.core.positioning              Positioning and pressure care
  6 step.core.prep-drape               Skin preparation and draping
  7 step.obg.pfannenstiel              Transverse lower abdominal (Pfannenstiel) entry
  8 step.abd.exploration               Systematic exploration
  9 step.tah.round-ligament            Uterine traction, round ligaments and opening the broad ligament
 10 step.obg.ureter-identification     Identify the ureter before dividing pelvic pedicles
 11 step.tah.adnexal-pedicle           Adnexal pedicle: conserve or remove the ovaries
 12 step.tah.bladder                   Reflecting the bladder off the cervix
 13 step.tah.uterine-vessels           Clamping the uterine vessels
 14 step.tah.cervix-vault              Cardinal and uterosacral ligaments, removing the uterus and closing the vault
 15 step.tah.bailout                   When the plane is lost, the bladder is breached or bleeding will not stop
 16 step.core.haemostasis              Haemostasis before closure
 17 step.obg.blood-loss                Quantify blood loss and agree the next step
 18 step.core.specimen                 Specimen handling and labelling
 19 step.core.counts                   Swab, instrument and needle counts
 20 step.obg.transverse-closure        Closing a transverse lower abdominal incision
 21 step.core.skin-closure             Skin closure and dressing
 22 step.core.debrief                  Debrief, operative note and handover
E. chest-drain-insertion
  1 step.core.consent-check            Consent, site marking and identity check
  2 step.core.timeout                  Team brief, sign-in and time-out
  3 step.core.positioning              Positioning and pressure care
  4 step.cd.site                       Site selection with ultrasound
  5 step.core.prep-drape               Skin preparation and draping
  6 step.cd.anaesthesia                Local anaesthesia and confirmatory aspiration
  7 step.cd.seldinger                  Seldinger technique (small-bore drain)
  8 step.cd.blunt                      Blunt dissection technique (large-bore drain)
  9 step.cd.secure                     Securing the drain and connecting the seal
 10 step.core.counts                   Swab, instrument and needle counts
 11 step.cd.confirm                    Confirming position and function
 12 step.core.debrief                  Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "laparotomy": {
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
  "modified-radical-mastectomy": { ... }, "total-hip-replacement": { ... },
  "total-abdominal-hysterectomy": { ... }, "chest-drain-insertion": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
