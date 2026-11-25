---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 21 (Adenoidectomy, Cortical and modified radical mastoidectomy, Tympanoplasty type 1, Superficial parotidectomy with facial nerve identification, Direct laryngoscopy and microlaryngoscopy with biopsy): Gemini video and timestamp prompt (5 operations)

Same operations as [[SURGX-batch21-image-prompt]].

```
TASK
Find YouTube videos for 5 operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Adenoidectomy
B. Cortical and modified radical mastoidectomy
C. Tympanoplasty type 1 (underlay)
D. Superficial parotidectomy with facial nerve identification
E. Direct laryngoscopy and microlaryngoscopy with biopsy

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
A. adenoidectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.ent.preop-data-check              Confirm the investigation that justifies the operation
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.ent.airway-share                  Shared airway plan with the anaesthetist
  6 step.core.positioning                  Positioning and pressure care
  7 step.ent.dental-protection             Dentition check and protection
  8 step.adeno.gag-palate                  Insert the gag and palpate the palate
  9 step.adeno.view                        See the nasopharynx
 10 step.adeno.removal                     Remove the adenoid under vision, superficially
 11 step.adeno.pack                        Postnasal pack and wait
 12 step.core.haemostasis                  Haemostasis before closure
 13 step.adeno.bleed-bailout               Bail-out: bleeding that will not stop
 14 step.ent.pharynx-clearance             Clear the pharynx: throat pack out, clot out, postnasal space checked
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.core.specimen                     Specimen handling and labelling
 17 step.ent.airway-handover               Airway handover to recovery and the ward
 18 step.core.debrief                      Debrief, operative note and handover
B. mastoidectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.ent.preop-data-check              Confirm the investigation that justifies the operation
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.ent.facial-nerve-monitor          Facial nerve monitoring: set up, test and agree no paralysis
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.ent.microscope-setup              Operating microscope set-up and surgeon ergonomics
  9 step.ent.bloodless-field               Bloodless field: head-up tilt, vasoconstrictor infiltration and the wait
 10 step.ent.postaural-exposure            Postaural incision, temporalis fascia graft and mastoid cortex exposure
 11 step.ent.otologic-drill                Safe drilling of the temporal bone
 12 step.mastoid.cortical                  Cortical mastoidectomy: tegmen, sigmoid, antrum, lateral canal
 13 step.mastoid.canal-wall-down           Take the posterior canal wall down to the facial ridge
 14 step.mastoid.disease-clearance         Clear cholesteatoma and assess the ossicles
 15 step.mastoid.complication-bailout      Bail-out: sinus bleeding, dural exposure, facial nerve injury or fistula
 16 step.mastoid.graft-meatoplasty         Graft the middle ear and make an adequate meatoplasty
 17 step.core.haemostasis                  Haemostasis before closure
 18 step.core.counts                       Swab, instrument and needle counts
 19 step.core.specimen                     Specimen handling and labelling
 20 step.core.skin-closure                 Skin closure and dressing
 21 step.ent.facial-function-check         Document facial nerve function before the patient leaves recovery
 22 step.core.debrief                      Debrief, operative note and handover
C. tympanoplasty-underlay
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.ent.preop-data-check              Confirm the investigation that justifies the operation
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.ent.airway-share                  Shared airway plan with the anaesthetist
  6 step.core.positioning                  Positioning and pressure care
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.ent.microscope-setup              Operating microscope set-up and surgeon ergonomics
  9 step.ent.bloodless-field               Bloodless field: head-up tilt, vasoconstrictor infiltration and the wait
 10 step.ent.postaural-exposure            Postaural incision, temporalis fascia graft and mastoid cortex exposure
 11 step.tymp.freshen                      Freshen the perforation edge
 12 step.tymp.flap                         Raise the tympanomeatal flap and enter the middle ear
 13 step.ent.otologic-drill                Safe drilling of the temporal bone
 14 step.tymp.middle-ear                   Inspect the middle ear and test the ossicular chain
 15 step.tymp.cholesteatoma-bailout        Bail-out: cholesteatoma or an abnormal chain
 16 step.tymp.graft                        Place the underlay graft
 17 step.tymp.flap-replace                 Replace the flap and pack the canal
 18 step.core.haemostasis                  Haemostasis before closure
 19 step.core.skin-closure                 Skin closure and dressing
 20 step.core.counts                       Swab, instrument and needle counts
 21 step.ent.facial-function-check         Document facial nerve function before the patient leaves recovery
 22 step.core.debrief                      Debrief, operative note and handover
D. superficial-parotidectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.mdt-check                    MDT decision, staging and diagnosis confirmed
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.ent.facial-nerve-monitor          Facial nerve monitoring: set up, test and agree no paralysis
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.parotid.incision-flap             Modified Blair incision and skin flap
  9 step.parotid.mobilise                  Mobilise the gland posteriorly: great auricular nerve, sternocleidomastoid, cartilage, digastric
 10 step.parotid.trunk                     Identify the facial nerve trunk
 11 step.parotid.nerve-dissection          Dissect along the nerve and lift off the superficial lobe
 12 step.onco.tumour-handling              Oncological handling: no touch, wound protection, clean field
 13 step.parotid.trunk-bailout             Bail-out: the trunk cannot be found, or the nerve is involved
 14 step.parotid.final-stimulation         Stimulate the nerve before closing
 15 step.onco.specimen-orientation         Orienting the cancer specimen for the pathologist
 16 step.core.haemostasis                  Haemostasis before closure
 17 step.core.counts                       Swab, instrument and needle counts
 18 step.core.specimen                     Specimen handling and labelling
 19 step.core.skin-closure                 Skin closure and dressing
 20 step.ent.facial-function-check         Document facial nerve function before the patient leaves recovery
 21 step.core.debrief                      Debrief, operative note and handover
E. microlaryngoscopy-biopsy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.ent.preop-data-check              Confirm the investigation that justifies the operation
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.ent.airway-share                  Shared airway plan with the anaesthetist
  6 step.core.positioning                  Positioning and pressure care
  7 step.ent.dental-protection             Dentition check and protection
  8 step.mll.insert                        Introduce the laryngoscope without using the teeth
  9 step.mll.survey                        Systematic examination and lesion mapping before biopsy
 10 step.mll.suspend                       Suspend the laryngoscope
 11 step.ent.microscope-setup              Operating microscope set-up and surgeon ergonomics
 12 step.mll.biopsy                        Biopsy: deep enough for diagnosis, conservative on the vocal fold
 13 step.mll.airway-bailout                Bail-out: failed exposure, bleeding or a threatened airway
 14 step.core.haemostasis                  Haemostasis before closure
 15 step.ent.pharynx-clearance             Clear the pharynx: throat pack out, clot out, postnasal space checked
 16 step.core.counts                       Swab, instrument and needle counts
 17 step.core.specimen                     Specimen handling and labelling
 18 step.ent.airway-handover               Airway handover to recovery and the ward
 19 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "adenoidectomy": {
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
  "mastoidectomy": { ... }, "tympanoplasty-underlay": { ... }, "superficial-parotidectomy": { ... }, "microlaryngoscopy-biopsy": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
