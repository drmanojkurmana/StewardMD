---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 18 (Transvaginal cervical cerclage, Open, Wide local excision with sentinel node biopsy, Axillary lymph node dissection, Excision of a benign breast lump, Open repair of ruptured abdominal aortic aneurysm): Gemini video and timestamp prompt (6 operations)

Same operations as [[SURGX-batch18-image-prompt]].

```
TASK
Find YouTube videos for 6 operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Transvaginal cervical cerclage (McDonald)
B. Open (abdominal) myomectomy
C. Wide local excision with sentinel node biopsy
D. Axillary lymph node dissection
E. Excision of a benign breast lump (fibroadenoma)
F. Open repair of ruptured abdominal aortic aneurysm

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
A. mcdonald-cerclage
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.obg.preop-check                   Confirm the indication, pregnancy status and pre-operative work-up
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.obg.lithotomy-eua                 Lithotomy, bladder and examination under anaesthesia
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.cerc.expose                       Exposing and holding the cervix
  9 step.cerc.membranes                    Managing bulging membranes, or abandoning the cerclage
 10 step.cerc.bites                        Placing the purse-string bites
 11 step.cerc.tie                          Tying the cerclage and leaving it removable
 12 step.core.haemostasis                  Haemostasis before closure
 13 step.core.counts                       Swab, instrument and needle counts
 14 step.cerc.fetal-check                  Fetal heart and immediate post-procedure check
 15 step.core.debrief                      Debrief, operative note and handover
B. open-myomectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.obg.preop-check                   Confirm the indication, pregnancy status and pre-operative work-up
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.obg.pfannenstiel                  Transverse lower abdominal (Pfannenstiel) entry
  8 step.abd.exploration                   Systematic exploration
  9 step.obg.adnexal-check                 Inspect both tubes and ovaries
 10 step.myo.vasoconstrict                 Reducing blood loss: vasoconstrictor and tourniquet
 11 step.myo.incision                      Planning and making the uterine incisions
 12 step.myo.enucleate                     Enucleating the fibroids in the pseudocapsule plane
 13 step.myo.repair                        Closing the myometrium in layers
 14 step.obg.blood-loss                    Quantify blood loss and agree the next step
 15 step.myo.bailout                       Bleeding that will not stop
 16 step.core.haemostasis                  Haemostasis before closure
 17 step.core.specimen                     Specimen handling and labelling
 18 step.core.counts                       Swab, instrument and needle counts
 19 step.obg.transverse-closure            Closing a transverse lower abdominal incision
 20 step.core.skin-closure                 Skin closure and dressing
 21 step.core.debrief                      Debrief, operative note and handover
C. wle-sentinel-node-biopsy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.mdt-check                    MDT decision, staging and diagnosis confirmed
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.wle.tracer                        Sentinel node tracer: confirm and inject
  8 step.onco.axilla-entry                 Entering the axilla through the clavipectoral fascia
  9 step.wle.sentinel                      Identifying and removing the sentinel nodes
 10 step.onco.tumour-handling              Oncological handling: no touch, wound protection, clean field
 11 step.wle.excision                      Wide local excision with a planned margin
 12 step.onco.specimen-orientation         Orienting the cancer specimen for the pathologist
 13 step.wle.cavity                        Marking the cavity and restoring the breast shape
 14 step.core.haemostasis                  Haemostasis before closure
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.core.specimen                     Specimen handling and labelling
 17 step.core.skin-closure                 Skin closure and dressing
 18 step.core.debrief                      Debrief, operative note and handover
D. axillary-lymph-node-dissection
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.mdt-check                    MDT decision, staging and diagnosis confirmed
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.alnd.incision                     Axillary incision below the hairline
  8 step.onco.axilla-entry                 Entering the axilla through the clavipectoral fascia
  9 step.alnd.vein-definition              Define the axillary vein as the upper limit
 10 step.alnd.nerves                       Identify the long thoracic and thoracodorsal nerves before clearing the walls
 11 step.alnd.level-ii                     Level II behind pectoralis minor, medial pectoral nerve kept
 12 step.onco.nodal-clearance              En bloc nodal clearance by named level or station
 13 step.onco.major-vein-injury            Major vein injury during a nodal clearance: press, control, repair
 14 step.onco.specimen-orientation         Orienting the cancer specimen for the pathologist
 15 step.core.haemostasis                  Haemostasis before closure
 16 step.onco.suction-drain                Closed suction drain for the dead space after a nodal clearance
 17 step.core.counts                       Swab, instrument and needle counts
 18 step.core.specimen                     Specimen handling and labelling
 19 step.core.skin-closure                 Skin closure and dressing
 20 step.core.debrief                      Debrief, operative note and handover
E. breast-fibroadenoma-excision
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.mdt-check                    MDT decision, staging and diagnosis confirmed
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.fad.incision                      Choose an incision that balances access and cosmesis
  8 step.fad.delivery                      Dissect on the pseudo-capsule and deliver the lump
  9 step.fad.not-found                     Lump not found or not felt on the table: stop, do not go fishing
 10 step.fad.cavity                        Close or reshape the glandular defect when it would dimple
 11 step.core.haemostasis                  Haemostasis before closure
 12 step.core.counts                       Swab, instrument and needle counts
 13 step.core.specimen                     Specimen handling and labelling
 14 step.core.skin-closure                 Skin closure and dressing
 15 step.core.debrief                      Debrief, operative note and handover
F. open-raaa-repair
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.raaa.induction                    Induction with the surgeon scrubbed
  7 step.abd.midline                       Midline laparotomy incision
  8 step.raaa.proximal-control             Proximal aortic control
  9 step.vasc.vessel-control               Proximal and distal control before opening the artery
 10 step.vasc.heparin                      Systemic heparin before clamping
 11 step.raaa.open-sac                     Opening the sac and controlling back-bleeding
 12 step.raaa.graft                        Graft anastomoses
 13 step.vasc.flush-backbleed              Flushing and back-bleeding before the final sutures
 14 step.vasc.restore-flow                 Restoring flow with the anaesthetist warned
 15 step.vasc.perfusion-check              Confirming distal perfusion before leaving theatre
 16 step.core.haemostasis                  Haemostasis before closure
 17 step.raaa.damage-control               Damage control and temporary abdominal closure
 18 step.core.counts                       Swab, instrument and needle counts
 19 step.abd.mass-closure                  Mass closure of the abdominal wall
 20 step.core.skin-closure                 Skin closure and dressing
 21 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "mcdonald-cerclage": {
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
  "open-myomectomy": { ... }, "wle-sentinel-node-biopsy": { ... }, "axillary-lymph-node-dissection": { ... }, "breast-fibroadenoma-excision": { ... }, "open-raaa-repair": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
