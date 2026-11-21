---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 8: Gemini video and timestamp prompt (7 operations)

Same operations as [[SURGX-batch8-image-prompt]]. After Gemini answers, every video is checked in the real embedded player with a referrer and wired as timed `kind:"embed"` clips.

```
TASK
Find YouTube videos for 7 operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Deceased donor kidney transplant (RIGHT iliac fossa)
B. Laparoscopic living donor nephrectomy (LEFT kidney)
C. Aortic valve replacement on bypass
D. Subxiphoid pericardial window
E. Escharotomy (LEFT arm and chest)
F. Rhomboid (Limberg) flap (RIGHT cheek)
G. Unilateral cleft lip repair (LEFT side)

HOW TO CHOOSE VIDEOS
1. Search YouTube yourself. For each operation pick 2 to 4 videos that you can actually WATCH (video, not audio-only
   podcasts or slides). Prefer, in order: university hospitals and transplant, cardiac, burns and cleft centres,
   societies and journals (CTSNet, Royal College of Surgeons, American College of Surgeons, ISBI, ACPA, Smile Train),
   recognised surgeon educators, then high-quality animations.
2. Embedding must be allowed and the video must NOT be age-restricted. If YouTube asks to confirm your age, or shows
   "Sign in to confirm your age", reject it. Do NOT use Nucleus Medical Media (embedding disabled). Skip any video
   marked "Video unavailable" or "Playback on other websites has been disabled".
3. The technique must be safe, current practice. Reject a video that ligates a donor renal artery with a single plain clip, clamps the aorta before full heparinisation, makes escharotomy cuts across joints instead of along the mid-axial lines, or treats a baby with a shared airway without the anaesthetist's agreement. Note anything else outdated in
   "concerns", but keep the video if the clip itself is correct.
4. Real operative footage is preferred for operative steps; an animation is fine where footage
   does not show the step clearly (anatomy, the inside of the heart, the operation of a whole flap).

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
A. kidney-transplant
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.tx.organ-check                    Donor organ and compatibility check
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.tx.bench                          Bench preparation of the kidney
  8 step.tx.exposure                       Extraperitoneal exposure of the iliac vessels
  9 step.vasc.vessel-control               Proximal and distal control before opening the artery
 10 step.tx.venous                         Renal vein to external iliac vein anastomosis
 11 step.vasc.end-to-side-anastomosis      End-to-side anastomosis
 12 step.vasc.restore-flow                 Restoring flow with the anaesthetist warned
 13 step.vasc.perfusion-check              Confirming distal perfusion before leaving theatre
 14 step.tx.poor-perfusion                 Bailout: a graft that does not perfuse
 15 step.tx.ureter                         Ureteroneocystostomy
 16 step.uro.dj-stent                      Double-J stent placement and position check
 17 step.core.haemostasis                  Haemostasis before closure
 18 step.abd.drain                         Drain placement
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.core.skin-closure                 Skin closure and dressing
 21 step.core.debrief                      Debrief, operative note and handover
B. lap-donor-nephrectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.ldn.donor-check                   Donor safety and authorisation check
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.lap.access                        Establishing pneumoperitoneum
  8 step.lap.ports                         Port placement
  9 step.lap.survey                        Diagnostic laparoscopy and survey
 10 step.bowel.splenic-flexure             Splenic flexure mobilisation
 11 step.ldn.ureter                        Mobilising the ureter with the gonadal vein
 12 step.ldn.vein                          Dissecting the left renal vein and its tributaries
 13 step.ldn.artery                        Dissecting the renal artery
 14 step.ldn.extraction-site               Extraction incision ready before the vessels are divided
 15 step.ldn.divide                        Dividing the artery and vein and retrieving the kidney
 16 step.hpb.major-bleed                   Major haemorrhage: press, tell, call, then repair or pack
 17 step.ldn.flush                         Cold flush and checking the stumps
 18 step.lap.closure                       Desufflation and port-site closure
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.core.debrief                      Debrief, operative note and handover
C. aortic-valve-replacement
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.thor.sternotomy-open              Opening the sternum in the midline
  7 step.thor.pericardium-open             Spreading the sternum and opening the pericardium
  8 step.avr.cpb                           Heparinisation, cannulation and starting bypass
  9 step.avr.cardioplegia                  Cross-clamp and cardioplegia
 10 step.avr.excise                        Aortotomy, leaflet excision and decalcification
 11 step.avr.sutures                       Sizing and placing the annular sutures
 12 step.avr.seat                          Seating the valve and checking the coronaries
 13 step.avr.deair                         Closing the aorta and de-airing
 14 step.avr.wean                          Weaning from bypass and checking the valve
 15 step.vasc.heparin-reversal             Deciding on, and giving, heparin reversal
 16 step.thor.pacing-wires                 Temporary epicardial pacing wires
 17 step.thor.chest-drains                 Placing mediastinal and pleural drains
 18 step.thor.sternal-closure              Sternal closure with wires
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.core.debrief                      Debrief, operative note and handover
D. subxiphoid-pericardial-window
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.pw.induction                      Induction in tamponade with the surgeon ready
  7 step.pw.incision                       Upper midline incision and excision of the xiphoid
  8 step.pw.pericardium                    Identifying and opening the pericardium
  9 step.pw.window                         Creating the window and exploring
 10 step.core.specimen                     Specimen handling and labelling
 11 step.thor.chest-drains                 Placing mediastinal and pleural drains
 12 step.pw.bailout                        Bailout: cardiac or coronary injury
 13 step.core.haemostasis                  Haemostasis before closure
 14 step.core.counts                       Swab, instrument and needle counts
 15 step.core.skin-closure                 Skin closure and dressing
 16 step.core.debrief                      Debrief, operative note and handover
E. escharotomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.esc.indication                    Confirming the indication and marking the lines
  7 step.esc.limb                          Limb escharotomy
  8 step.esc.hand                          Hand and digit escharotomy (when needed)
  9 step.esc.chest                         Chest and abdominal escharotomy
 10 step.esc.release-check                 Checking the release worked
 11 step.core.haemostasis                  Haemostasis before closure
 12 step.st.pack                           Irrigation, packing and leaving the wound open
 13 step.ortho.nv-check                    Neurovascular and compartment check before leaving theatre
 14 step.core.counts                       Swab, instrument and needle counts
 15 step.core.debrief                      Debrief, operative note and handover
F. rhomboid-flap
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.flap.plan                         Planning the rhombus and the flap
  7 step.flap.local                        Local anaesthetic with adrenaline
  8 step.flap.excise                       Excising the lesion as a rhombus
  9 step.onco.specimen-orientation         Orienting the cancer specimen for the pathologist
 10 step.flap.raise                        Raising the flap
 11 step.flap.transpose                    Transposing the flap and closing the donor site
 12 step.core.haemostasis                  Haemostasis before closure
 13 step.flap.inset                        Insetting the flap
 14 step.flap.compromise                   Bailout: a pale or congested flap
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.core.skin-closure                 Skin closure and dressing
 17 step.core.debrief                      Debrief, operative note and handover
G. unilateral-cleft-lip-repair
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.paeds.physiology-gate             Paediatric physiology check before anaesthesia
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.paeds.warming                     Thermal care for the infant
  6 step.core.positioning                  Positioning and pressure care
  7 step.ent.airway-share                  Shared airway plan with the anaesthetist
  8 step.core.prep-drape                   Skin preparation and draping
  9 step.cl.markings                       Anthropometric marking and tattooing
 10 step.paeds.local-anaesthetic           Weight-based local anaesthetic infiltration
 11 step.cl.incisions                      Incisions and release of the lateral lip
 12 step.cl.nose                           Primary nasal repair
 13 step.cl.muscle                         Reconstructing the orbicularis oris
 14 step.cl.closure                        Mucosa, skin and vermilion closure
 15 step.core.haemostasis                  Haemostasis before closure
 16 step.core.counts                       Swab, instrument and needle counts
 17 step.ent.pharynx-clearance             Clear the pharynx: throat pack out, clot out, postnasal space checked
 18 step.ent.airway-handover               Airway handover to recovery and the ward
 19 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "kidney-transplant": {
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
  "lap-donor-nephrectomy": { ... }, "aortic-valve-replacement": { ... }, "subxiphoid-pericardial-window": { ... }, "escharotomy": { ... }, "rhomboid-flap": { ... }, "unilateral-cleft-lip-repair": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
