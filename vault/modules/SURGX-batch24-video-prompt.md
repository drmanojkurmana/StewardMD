---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 24 (Open carpal tunnel release, Trigger finger release, Flexor tendon repair, Craniotomy for supratentorial tumour, Decompressive craniectomy): Gemini video and timestamp prompt (5 operations)

Same operations as [[SURGX-batch24-image-prompt]].

```
TASK
Find YouTube videos for 5 operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Open carpal tunnel release
B. Trigger finger release
C. Flexor tendon repair (zone II)
D. Craniotomy for supratentorial tumour
E. Decompressive craniectomy (planned)

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
A. carpal-tunnel-release
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.hand.anaesthesia                  Hand anaesthesia: wide-awake local or regional with tourniquet
  6 step.ortho.tourniquet                  Tourniquet: decide, apply, record
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.hand.incision                     Hand incision placed on the creases and safe lines
  9 step.ctr.palmar-fascia                 Through fat and palmar fascia to the transverse carpal ligament
 10 step.hand.nerve-protection             Identify and protect the nerves before dividing anything
 11 step.ctr.divide-tcl                    Dividing the transverse carpal ligament under vision
 12 step.ctr.release-check                 Checking the release is complete
 13 step.hand.unexpected-findings          Unexpected findings in the hand: stop and get help
 14 step.core.haemostasis                  Haemostasis before closure
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.core.skin-closure                 Skin closure and dressing
 17 step.hand.dressing-therapy             Hand dressing, elevation, splint and therapy plan
 18 step.ortho.nv-check                    Neurovascular and compartment check before leaving theatre
 19 step.core.debrief                      Debrief, operative note and handover
B. trigger-finger-release
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.hand.anaesthesia                  Hand anaesthesia: wide-awake local or regional with tourniquet
  6 step.ortho.tourniquet                  Tourniquet: decide, apply, record
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.hand.incision                     Hand incision placed on the creases and safe lines
  9 step.hand.nerve-protection             Identify and protect the nerves before dividing anything
 10 step.tf.expose-a1                      Exposing the A1 pulley
 11 step.tf.divide-a1                      Dividing the A1 pulley completely and preserving A2
 12 step.hand.active-check                 Active movement check before closure
 13 step.hand.unexpected-findings          Unexpected findings in the hand: stop and get help
 14 step.core.haemostasis                  Haemostasis before closure
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.core.skin-closure                 Skin closure and dressing
 17 step.hand.dressing-therapy             Hand dressing, elevation, splint and therapy plan
 18 step.ortho.nv-check                    Neurovascular and compartment check before leaving theatre
 19 step.core.debrief                      Debrief, operative note and handover
C. flexor-tendon-repair
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.hand.anaesthesia                  Hand anaesthesia: wide-awake local or regional with tourniquet
  6 step.ortho.tourniquet                  Tourniquet: decide, apply, record
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.hand.incision                     Hand incision placed on the creases and safe lines
  9 step.hand.nerve-protection             Identify and protect the nerves before dividing anything
 10 step.ftr.retrieve                      Exposing and retrieving the tendon ends
 11 step.ftr.pulleys                       Managing the sheath and pulleys
 12 step.ftr.core-suture                   Multistrand core suture
 13 step.ftr.epitendinous                  Epitendinous (peripheral) suture
 14 step.hand.active-check                 Active movement check before closure
 15 step.hand.unexpected-findings          Unexpected findings in the hand: stop and get help
 16 step.core.haemostasis                  Haemostasis before closure
 17 step.core.counts                       Swab, instrument and needle counts
 18 step.core.skin-closure                 Skin closure and dressing
 19 step.hand.dressing-therapy             Hand dressing, elevation, splint and therapy plan
 20 step.ortho.nv-check                    Neurovascular and compartment check before leaving theatre
 21 step.core.debrief                      Debrief, operative note and handover
D. craniotomy-supratentorial-tumour
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.mdt-check                    MDT decision, staging and diagnosis confirmed
  3 step.neuro.preop-check                 Neurological baseline, side and coagulation check
  4 step.core.timeout                      Team brief, sign-in and time-out
  5 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  6 step.neuro.head-fixation               Head position and fixation: pins or horseshoe
  7 step.neuro.navigation                  Neuronavigation registration and accuracy check
  8 step.core.prep-drape                   Skin preparation and draping
  9 step.neuro.scalp-incision              Scalp incision and scalp haemostasis
 10 step.neuro.craniotomy-flap             Raising a free bone flap
 11 step.neuro.dura-open                   Opening the dura
 12 step.tum.corticectomy                  Choosing and making the corticectomy
 13 step.tum.resection                     Tumour resection and judging the margin
 14 step.neuro.swollen-brain               Bailout: managing a tight or swelling brain
 15 step.core.specimen                     Specimen handling and labelling
 16 step.core.haemostasis                  Haemostasis before closure
 17 step.neuro.dural-repair                Dural closure or repair
 18 step.tum.flap-fixation                 Replacing and fixing the bone flap
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.neuro.layered-scalp-closure       Layered scalp closure
 21 step.neuro.postop-neuro-obs            Post-operative neurological observation plan
 22 step.core.debrief                      Debrief, operative note and handover
E. decompressive-craniectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.neuro.preop-check                 Neurological baseline, side and coagulation check
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.neuro.head-fixation               Head position and fixation: pins or horseshoe
  6 step.neuro.cranial-landmarks           Marking cranial landmarks and the incision
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.neuro.scalp-incision              Scalp incision and scalp haemostasis
  9 step.dc.temporalis                     Elevating the temporalis muscle
 10 step.neuro.craniotomy-flap             Raising a free bone flap
 11 step.dc.temporal-decompression         Decompressing to the floor of the middle fossa
 12 step.neuro.dura-open                   Opening the dura
 13 step.dc.intradural                     Intradural inspection and limited evacuation
 14 step.neuro.swollen-brain               Bailout: managing a tight or swelling brain
 15 step.neuro.dural-repair                Dural closure or repair
 16 step.dc.bone-storage                   Bone flap storage, labelling and documentation
 17 step.core.haemostasis                  Haemostasis before closure
 18 step.neuro.drain-tunnel                Tunnelling and securing a cranial drain
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.neuro.layered-scalp-closure       Layered scalp closure
 21 step.neuro.postop-neuro-obs            Post-operative neurological observation plan
 22 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "carpal-tunnel-release": {
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
  "trigger-finger-release": { ... }, "flexor-tendon-repair": { ... }, "craniotomy-supratentorial-tumour": { ... }, "decompressive-craniectomy": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
