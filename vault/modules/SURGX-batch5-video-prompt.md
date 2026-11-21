---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 5: Gemini video and timestamp prompt (5 neurosurgery operations)

Same five operations as [[SURGX-batch5-image-prompt]]. The step ids are the real ones from the JSON.
After Gemini answers, every video is checked in the REAL embedded player with a referrer (oEmbed alone passes
age-restricted videos, see [[SURGX]] "Age-restricted videos"), added to the `_site/yt.html` ALLOW list and wired as
`kind:"embed"` clips with `start` and `end`.

```
TASK
Find YouTube videos for five neurosurgical operations, watch them, and give me exact clip timestamps for each step
listed below. The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the
segment you give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Burr hole evacuation of chronic subdural haematoma (with a subdural drain)
B. Trauma craniotomy for extradural haematoma (with decompressive craniectomy as the bailout)
C. External ventricular drain insertion at Kocher point
D. Ventriculoperitoneal shunt insertion
E. Lumbar discectomy (laminotomy or laminectomy) for cauda equina syndrome

HOW TO CHOOSE VIDEOS
1. Search YouTube yourself. For each operation pick 2 to 4 videos that you can actually WATCH (video, not audio-only
   podcasts or slides). Prefer, in order: university or hospital neurosurgery departments, neurosurgical societies and
   journals (for example SBNS, AANS, Congress of Neurological Surgeons, Neurosurgical Focus: Video / JNS, EANS,
   WFNS, The Neurosurgical Atlas where it is free on YouTube), recognised neurosurgeon educators, then high-quality
   animations. Neurocritical care and nursing channels are good for the EVD set-up, levelling and observation steps.
2. Embedding must be allowed and the video must NOT be age-restricted. Age-restricted videos (many real operative
   videos are, especially cranial ones) will not play in the app: if YouTube asks to confirm your age, or shows "Sign
   in to confirm your age", reject it. Do NOT use Nucleus Medical Media (embedding disabled). Skip any video marked
   "Video unavailable" or "Playback on other websites has been disabled".
3. The technique must be safe, current practice. Reject a video that points the irrigation catheter into the brain,
   redirects a ventricular catheter inside the brain instead of withdrawing it, handles a shunt with bare hands or
   lets it lie on the skin, enters the peritoneum blindly with a trocar after previous abdominal surgery, or starts a
   spinal operation without an X-ray level check. Note anything else outdated in "concerns", but keep the video if
   the clip itself is correct.
4. Real operative footage is preferred for operative steps; an animation is fine where footage does not show the
   step clearly (for example the EVD trajectory or the shunt route).

HOW TO TIME CLIPS
- Watch the video (use its transcript and chapters to find the moment, then watch). Give start and end in WHOLE
  SECONDS from the start of the video, verified by watching, not guessed from chapters or the description.
- Each clip shows that step and only that step, 10 to 90 seconds long. Never give a whole long video: skip intros,
  channel promos, sponsor reads, "like and subscribe" and outros.
- For every clip quote the first and last sentence spoken (or describe the first and last frame if there is no
  speech), so I can verify it.
- If a step is not in your first videos, SEARCH FOR ANOTHER VIDEO that shows it before giving up. Only then use null.
  Team, consent, count, labelling and handover steps are often missing from operative videos; a separate good
  teaching video for them (for example a WHO Surgical Safety Checklist demonstration, a GCS and pupil assessment
  video, or an EVD nursing care video) is welcome.
- Videos need not follow the steps in the same order or name them the same way. Map what is shown to the step whose
  description matches.
- For each step pick ONE "best" clip.

THE STEPS (use these step ids exactly)
A. burr-hole-csdh
  1 step.core.consent-check              Consent, site marking and identity check
  2 step.neuro.preop-check               Neurological baseline, side and coagulation check
  3 step.core.timeout                    Team brief, sign-in and time-out
  4 step.core.prophylaxis                Antimicrobial and thromboprophylaxis
  5 step.core.positioning                Positioning and pressure care
  6 step.neuro.cranial-landmarks         Marking cranial landmarks and the incision
  7 step.core.prep-drape                 Skin preparation and draping
  8 step.neuro.burr-hole                 Making a burr hole
  9 step.neuro.dura-open                 Opening the dura
 10 step.csdh.irrigation                 Irrigation of the subdural space
 11 step.neuro.drain-tunnel              Tunnelling and securing a cranial drain
 12 step.core.haemostasis                Haemostasis before closure
 13 step.core.counts                     Swab, instrument and needle counts
 14 step.core.skin-closure               Skin closure and dressing
 15 step.neuro.postop-neuro-obs          Post-operative neurological observation plan
 16 step.core.debrief                    Debrief, operative note and handover
B. trauma-craniotomy-edh
  1 step.core.consent-check              Consent, site marking and identity check
  2 step.neuro.preop-check               Neurological baseline, side and coagulation check
  3 step.core.timeout                    Team brief, sign-in and time-out
  4 step.core.prophylaxis                Antimicrobial and thromboprophylaxis
  5 step.core.positioning                Positioning and pressure care
  6 step.neuro.cranial-landmarks         Marking cranial landmarks and the incision
  7 step.core.prep-drape                 Skin preparation and draping
  8 step.edh.scalp-flap                  Scalp flap
  9 step.neuro.burr-hole                 Making a burr hole
 10 step.edh.bone-flap                   Raising the bone flap
 11 step.edh.evacuate                    Evacuating the clot and controlling the source
 12 step.neuro.dura-open                 Opening the dura
 13 step.edh.decompressive-craniectomy   Bailout: decompressive craniectomy
 14 step.neuro.dural-repair              Dural closure or repair
 15 step.edh.flap-replace                Replacing the bone flap
 16 step.core.haemostasis                Haemostasis before closure
 17 step.core.counts                     Swab, instrument and needle counts
 18 step.core.skin-closure               Skin closure and dressing
 19 step.neuro.postop-neuro-obs          Post-operative neurological observation plan
 20 step.core.debrief                    Debrief, operative note and handover
C. evd-insertion
  1 step.core.consent-check              Consent, site marking and identity check
  2 step.neuro.preop-check               Neurological baseline, side and coagulation check
  3 step.core.timeout                    Team brief, sign-in and time-out
  4 step.core.prophylaxis                Antimicrobial and thromboprophylaxis
  5 step.core.positioning                Positioning and pressure care
  6 step.neuro.cranial-landmarks         Marking cranial landmarks and the incision
  7 step.core.prep-drape                 Skin preparation and draping
  8 step.neuro.burr-hole                 Making a burr hole
  9 step.neuro.dura-open                 Opening the dura
 10 step.evd.cannulate                   Ventricular cannulation
 11 step.evd.connect                     Opening pressure, sampling and connection
 12 step.neuro.drain-tunnel              Tunnelling and securing a cranial drain
 13 step.core.haemostasis                Haemostasis before closure
 14 step.core.counts                     Swab, instrument and needle counts
 15 step.core.skin-closure               Skin closure and dressing
 16 step.neuro.postop-neuro-obs          Post-operative neurological observation plan
 17 step.core.debrief                    Debrief, operative note and handover
D. vp-shunt-insertion
  1 step.core.consent-check              Consent, site marking and identity check
  2 step.neuro.preop-check               Neurological baseline, side and coagulation check
  3 step.core.timeout                    Team brief, sign-in and time-out
  4 step.core.prophylaxis                Antimicrobial and thromboprophylaxis
  5 step.neuro.head-fixation             Head position and fixation: pins or horseshoe
  6 step.neuro.cranial-landmarks         Marking cranial landmarks and the incision
  7 step.neuro.navigation                Neuronavigation registration and accuracy check
  8 step.core.prep-drape                 Skin preparation and draping
  9 step.vps.shunt-handling              Shunt handling and preparation of the implant
 10 step.neuro.scalp-incision            Scalp incision and scalp haemostasis
 11 step.neuro.burr-hole                 Making a burr hole
 12 step.vps.abdominal-access            Peritoneal access
 13 step.vps.tunnel                      Subcutaneous tunnelling
 14 step.neuro.dura-open                 Opening the dura
 15 step.vps.ventricular-catheter        Ventricular catheter insertion
 16 step.vps.connect-flow                Connecting the valve and confirming flow
 17 step.vps.peritoneal-placement        Placing the peritoneal catheter and closing the abdomen
 18 step.vps.bailout                     Bailout: when the shunt cannot be completed safely
 19 step.core.counts                     Swab, instrument and needle counts
 20 step.neuro.layered-scalp-closure     Layered scalp closure
 21 step.neuro.postop-neuro-obs          Post-operative neurological observation plan
 22 step.core.debrief                    Debrief, operative note and handover
E. lumbar-discectomy-ces
  1 step.core.consent-check              Consent, site marking and identity check
  2 step.neuro.preop-check               Neurological baseline, side and coagulation check
  3 step.core.timeout                    Team brief, sign-in and time-out
  4 step.core.prophylaxis                Antimicrobial and thromboprophylaxis
  5 step.core.positioning                Positioning and pressure care
  6 step.core.prep-drape                 Skin preparation and draping
  7 step.spine.level-check               Radiological level confirmation
  8 step.spine.exposure                  Midline exposure and laminotomy
  9 step.spine.decompress                Discectomy and decompression of the thecal sac
 10 step.spine.confirm                   Confirming adequate decompression
 11 step.neuro.dural-repair              Dural closure or repair
 12 step.core.specimen                   Specimen handling and labelling
 13 step.core.haemostasis                Haemostasis before closure
 14 step.core.counts                     Swab, instrument and needle counts
 15 step.core.skin-closure               Skin closure and dressing
 16 step.neuro.postop-neuro-obs          Post-operative neurological observation plan
 17 step.core.debrief                    Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "burr-hole-csdh": {
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
  "trauma-craniotomy-edh": { ... }, "evd-insertion": { ... },
  "vp-shunt-insertion": { ... }, "lumbar-discectomy-ces": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
