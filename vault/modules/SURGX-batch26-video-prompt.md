---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 26 (Coronary artery bypass grafting, Hemithyroidectomy, Parathyroidectomy, Laparoscopic adrenalectomy): Gemini video and timestamp prompt (4 operations)

Same operations as [[SURGX-batch26-image-prompt]].

```
TASK
Find YouTube videos for 4 operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Coronary artery bypass grafting
B. Hemithyroidectomy (thyroid lobectomy)
C. Parathyroidectomy
D. Laparoscopic adrenalectomy

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
A. cabg
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.thor.sternotomy-open              Opening the sternum in the midline
  7 step.cabg.ima-harvest                  Internal mammary artery harvest
  8 step.vasc.vein-harvest                 Harvesting and preparing a vein conduit
  9 step.thor.pericardium-open             Spreading the sternum and opening the pericardium
 10 step.cabg.bypass                       Heparinisation, cannulation, bypass and cardioplegic arrest
 11 step.vasc.end-to-side-anastomosis      End-to-side anastomosis
 12 step.cabg.weaning                      De-airing, reperfusion and weaning from bypass
 13 step.cabg.failure-to-wean              Failure to wean from bypass
 14 step.vasc.heparin-reversal             Deciding on, and giving, heparin reversal
 15 step.core.haemostasis                  Haemostasis before closure
 16 step.thor.pacing-wires                 Temporary epicardial pacing wires
 17 step.thor.chest-drains                 Placing mediastinal and pleural drains
 18 step.core.counts                       Swab, instrument and needle counts
 19 step.thor.sternal-closure              Sternal closure with wires
 20 step.core.skin-closure                 Skin closure and dressing
 21 step.core.debrief                      Debrief, operative note and handover
 22 step.thor.emergency-resternotomy       Emergency re-sternotomy for arrest or tamponade
B. hemithyroidectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.mdt-check                    MDT decision, staging and diagnosis confirmed
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.neck.collar-access                Collar incision, subplatysmal flaps and midline strap separation
  8 step.neck.ionm-setup                   Nerve monitoring set-up and baseline vagal signal
  9 step.hemi.superior-pole                Superior pole: individual vessel ligation, external branch protected
 10 step.neck.parathyroid-recognition      Recognise each parathyroid and keep it on its blood supply
 11 step.neck.rln-identify                 Identify and protect the recurrent laryngeal nerve
 12 step.hemi.unexpected-findings          Unexpected invasive tumour or nodal disease: stop extending, reassess
 13 step.hemi.berry-isthmus                Ligament of Berry, isthmus division and lobe removal
 14 step.neck.ionm-final                   Final nerve signal and the decision about the other side
 15 step.onco.specimen-orientation         Orienting the cancer specimen for the pathologist
 16 step.core.haemostasis                  Haemostasis before closure
 17 step.core.counts                       Swab, instrument and needle counts
 18 step.core.specimen                     Specimen handling and labelling
 19 step.neck.closure                      Closing the central neck so a haematoma can decompress
 20 step.neck.haematoma-handover           Airway and haematoma handover after neck surgery
 21 step.core.debrief                      Debrief, operative note and handover
C. parathyroidectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.endocrine-biochem-check      Biochemical diagnosis, localisation and endocrine preparation confirmed
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.ptx.baseline-pth                  Baseline PTH before incision or before excision
  8 step.neck.collar-access                Collar incision, subplatysmal flaps and midline strap separation
  9 step.neck.ionm-setup                   Nerve monitoring set-up and baseline vagal signal
 10 step.ptx.focused-search                Go straight to the localised site and find the adenoma
 11 step.neck.rln-identify                 Identify and protect the recurrent laryngeal nerve
 12 step.neck.parathyroid-recognition      Recognise each parathyroid and keep it on its blood supply
 13 step.ptx.adenoma-excision              Excise the adenoma with its capsule intact
 14 step.ptx.iopth                         Intra-operative PTH after excision: cure or continue
 15 step.ptx.bilateral-exploration         Convert to bilateral exploration when the focused approach fails
 16 step.neck.ionm-final                   Final nerve signal and the decision about the other side
 17 step.core.haemostasis                  Haemostasis before closure
 18 step.core.counts                       Swab, instrument and needle counts
 19 step.core.specimen                     Specimen handling and labelling
 20 step.neck.closure                      Closing the central neck so a haematoma can decompress
 21 step.neck.haematoma-handover           Airway and haematoma handover after neck surgery
 22 step.core.debrief                      Debrief, operative note and handover
D. laparoscopic-adrenalectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.endocrine-biochem-check      Biochemical diagnosis, localisation and endocrine preparation confirmed
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.lap.access                        Establishing pneumoperitoneum
  8 step.lap.ports                         Port placement
  9 step.lap.survey                        Diagnostic laparoscopy and survey
 10 step.adr.mobilise                      Expose the adrenal: liver mobilisation on the right, medial rotation on the left
 11 step.onco.tumour-handling              Oncological handling: no touch, wound protection, clean field
 12 step.adr.vein                          Identify, clip and divide the adrenal vein
 13 step.adr.gland-dissection              Free the gland in its periadrenal fat with an intact capsule
 14 step.adr.conversion                    Convert to open surgery early when needed
 15 step.lap.specimen-retrieval            Specimen retrieval
 16 step.core.haemostasis                  Haemostasis before closure
 17 step.core.counts                       Swab, instrument and needle counts
 18 step.core.specimen                     Specimen handling and labelling
 19 step.lap.closure                       Desufflation and port-site closure
 20 step.core.skin-closure                 Skin closure and dressing
 21 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "cabg": {
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
  "hemithyroidectomy": { ... }, "parathyroidectomy": { ... }, "laparoscopic-adrenalectomy": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
