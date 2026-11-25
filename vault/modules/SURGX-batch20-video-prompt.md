---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 20 (Great saphenous vein surgery, Above-knee amputation, Open surgical tracheostomy, Functional endoscopic sinus surgery, Myringotomy and grommet insertion, Septoplasty): Gemini video and timestamp prompt (6 operations)

Same operations as [[SURGX-batch20-image-prompt]].

```
TASK
Find YouTube videos for 6 operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Great saphenous vein surgery
B. Above-knee amputation
C. Open surgical tracheostomy
D. Functional endoscopic sinus surgery (FESS)
E. Myringotomy and grommet insertion
F. Septoplasty

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
A. gsv-ablation-stripping
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.vasc.vein-mapping                 Duplex vein assessment and marking
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.gsv.cannulation                   Ultrasound-guided cannulation of the saphenous vein
  8 step.gsv.tip-position                  Confirming the catheter tip position at the junction
  9 step.gsv.tumescent                     Tumescent anaesthesia
 10 step.gsv.ablation                      Delivering thermal energy and checking the deep vein
 11 step.gsv.sfj-ligation                  Open saphenofemoral junction ligation (high tie)
 12 step.gsv.strip                         Stripping the great saphenous vein to the knee
 13 step.gsv.phlebectomy                   Phlebectomy of marked tributaries
 14 step.gsv.bailout                       When access fails or the junction is unclear
 15 step.core.haemostasis                  Haemostasis before closure
 16 step.core.counts                       Swab, instrument and needle counts
 17 step.vasc.groin-closure                Layered closure of a groin incision
 18 step.core.skin-closure                 Skin closure and dressing
 19 step.core.debrief                      Debrief, operative note and handover
B. above-knee-amputation
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.ortho.tourniquet                  Tourniquet: decide, apply, record
  7 step.aka.flaps                         Marking the bone level and flaps
  8 step.aka.anterior-medial               Anterior and medial muscle division
  9 step.aka.femoral-vessels               Ligation of the femoral vessels
 10 step.aka.bone                          Division of the femur
 11 step.aka.sciatic                       Handling the sciatic nerve
 12 step.aka.posterior                     Completing the posterior flap
 13 step.aka.myodesis                      Muscle stabilisation: myodesis and myoplasty
 14 step.aka.guillotine                    Guillotine first stage for sepsis or instability
 15 step.core.haemostasis                  Haemostasis before closure
 16 step.core.counts                       Swab, instrument and needle counts
 17 step.core.specimen                     Specimen handling and labelling
 18 step.core.skin-closure                 Skin closure and dressing
 19 step.core.debrief                      Debrief, operative note and handover
C. surgical-tracheostomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.ent.airway-share                  Shared airway plan with the anaesthetist
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.trach.incision                    Incision and midline approach through the strap muscles
  8 step.trach.isthmus                     Divide or retract the thyroid isthmus
  9 step.core.haemostasis                  Haemostasis before closure
 10 step.trach.window                      Open the trachea and insert the tube
 11 step.trach.confirm                     Confirm with capnography, then secure
 12 step.core.counts                       Swab, instrument and needle counts
 13 step.ent.airway-handover               Airway handover to recovery and the ward
 14 step.core.debrief                      Debrief, operative note and handover
D. fess
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.ent.preop-data-check              Confirm the investigation that justifies the operation
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.ent.airway-share                  Shared airway plan with the anaesthetist
  6 step.core.positioning                  Positioning and pressure care
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.fess.decongest                    Decongest and infiltrate
  9 step.fess.uncinectomy                  Uncinectomy and middle meatal antrostomy
 10 step.fess.ethmoidectomy                Ethmoidectomy from front to back
 11 step.fess.orbit-check                  Check the eyes before ending
 12 step.core.haemostasis                  Haemostasis before closure
 13 step.ent.pharynx-clearance             Clear the pharynx: throat pack out, clot out, postnasal space checked
 14 step.core.counts                       Swab, instrument and needle counts
 15 step.core.specimen                     Specimen handling and labelling
 16 step.ent.airway-handover               Airway handover to recovery and the ward
 17 step.core.debrief                      Debrief, operative note and handover
E. myringotomy-grommets
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.ent.preop-data-check              Confirm the investigation that justifies the operation
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.ent.airway-share                  Shared airway plan with the anaesthetist
  5 step.core.positioning                  Positioning and pressure care
  6 step.grommet.canal                     Clear the canal and inspect the whole drum
  7 step.grommet.myringotomy               Radial myringotomy in the anteroinferior quadrant
  8 step.grommet.insert                    Insert and seat the grommet
  9 step.core.counts                       Swab, instrument and needle counts
 10 step.ent.airway-handover               Airway handover to recovery and the ward
 11 step.core.debrief                      Debrief, operative note and handover
F. septoplasty
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.ent.preop-data-check              Confirm the investigation that justifies the operation
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.ent.airway-share                  Shared airway plan with the anaesthetist
  6 step.core.positioning                  Positioning and pressure care
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.ent.bloodless-field               Bloodless field: head-up tilt, vasoconstrictor infiltration and the wait
  9 step.septo.incision                    Incision: Killian or hemitransfixion
 10 step.septo.flap                        Raise the subperichondrial flap
 11 step.septo.bony-junction               Cross to the opposite side at the bony-cartilaginous junction
 12 step.septo.resection                   Resect deviated cartilage and bone, preserve the L-strut
 13 step.septo.maxillary-crest             Deal with the maxillary crest and spur
 14 step.septo.tear-bailout                Bail-out: opposing flap tears or loss of support
 15 step.septo.close-quilt                 Close the incision, quilt the flaps, splint
 16 step.core.haemostasis                  Haemostasis before closure
 17 step.ent.pharynx-clearance             Clear the pharynx: throat pack out, clot out, postnasal space checked
 18 step.core.counts                       Swab, instrument and needle counts
 19 step.ent.airway-handover               Airway handover to recovery and the ward
 20 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "gsv-ablation-stripping": {
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
  "above-knee-amputation": { ... }, "surgical-tracheostomy": { ... }, "fess": { ... }, "myringotomy-grommets": { ... }, "septoplasty": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
