---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 14 (D2 gastrectomy for gastric cancer, Oesophagectomy, Transurethral resection of bladder tumour, Scrotal exploration with bilateral orchidopexy, Suprapubic catheter insertion, Ureteroscopy with laser lithotripsy): Gemini video and timestamp prompt (6 operations)

Same operations as [[SURGX-batch14-image-prompt]].

```
TASK
Find YouTube videos for 6 operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. D2 gastrectomy for gastric cancer
B. Oesophagectomy (Ivor Lewis principles)
C. Transurethral resection of bladder tumour (TURBT)
D. Scrotal exploration with bilateral orchidopexy
E. Suprapubic catheter insertion
F. Ureteroscopy with laser lithotripsy

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
A. d2-gastrectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.mdt-check                    MDT decision, staging and diagnosis confirmed
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.abd.midline                       Midline laparotomy incision
  8 step.abd.exploration                   Systematic exploration
  9 step.onco.unresectable-bailout         Unexpected metastatic or unresectable disease: stop and decide
 10 step.gast.omentum-infrapyloric         Greater curve: omentum, left gastroepiploic and infrapyloric stations
 11 step.gast.duodenal-transection         Suprapyloric clearance and duodenal transection
 12 step.onco.nodal-clearance              En bloc nodal clearance by named level or station
 13 step.onco.left-gastric-pedicle         Left gastric pedicle divided at its origin with its nodes
 14 step.gast.proximal-transection         Proximal clearance and transection: subtotal remnant or oesophagus
 15 step.gast.reconstruction               Reconstruction: Billroth or Roux-en-Y, tension-free and tested
 16 step.onco.feeding-jejunostomy          Feeding jejunostomy when early enteral access is planned
 17 step.onco.specimen-orientation         Orienting the cancer specimen for the pathologist
 18 step.core.haemostasis                  Haemostasis before closure
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.abd.mass-closure                  Mass closure of the abdominal wall
 21 step.core.skin-closure                 Skin closure and dressing
 22 step.core.debrief                      Debrief, operative note and handover
B. ivor-lewis-oesophagectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.mdt-check                    MDT decision, staging and diagnosis confirmed
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.abd.midline                       Midline laparotomy incision
  8 step.abd.exploration                   Systematic exploration
  9 step.onco.unresectable-bailout         Unexpected metastatic or unresectable disease: stop and decide
 10 step.oes.conduit-mobilisation          Mobilise the stomach as a conduit and dissect the hiatus
 11 step.onco.left-gastric-pedicle         Left gastric pedicle divided at its origin with its nodes
 12 step.onco.feeding-jejunostomy          Feeding jejunostomy when early enteral access is planned
 13 step.abd.mass-closure                  Mass closure of the abdominal wall
 14 step.oes.thoracic-access               Reposition and enter the right chest with lung isolation
 15 step.oes.thoracic-mobilisation         Divide the azygos arch and mobilise the oesophagus en bloc
 16 step.onco.nodal-clearance              En bloc nodal clearance by named level or station
 17 step.oes.anastomosis                   Form the conduit, deliver it untwisted, and make the anastomosis
 18 step.onco.specimen-orientation         Orienting the cancer specimen for the pathologist
 19 step.core.haemostasis                  Haemostasis before closure
 20 step.core.counts                       Swab, instrument and needle counts
 21 step.core.skin-closure                 Skin closure and dressing
 22 step.core.debrief                      Debrief, operative note and handover
C. uro-turbt
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.uro.cystoscopy                    Urethrocystoscopy and systematic bladder inspection
  7 step.turbt.bimanual                    Bimanual examination under anaesthesia
  8 step.uro.resectoscope                  Resectoscope set-up, irrigation fluid and urethral calibration
  9 step.turbt.resect                      Resection of the exophytic tumour
 10 step.turbt.base                        Base resection with detrusor muscle
 11 step.uro.chip-evacuation               Chip evacuation and specimen collection
 12 step.core.haemostasis                  Haemostasis before closure
 13 step.uro.perforation-check             Final inspection: perforation, orifices and landmarks
 14 step.uro.three-way-catheter            Three-way catheter and continuous irrigation
 15 step.turbt.instillation                Immediate single post-operative chemotherapy instillation decision
 16 step.core.counts                       Swab, instrument and needle counts
 17 step.core.specimen                     Specimen handling and labelling
 18 step.core.debrief                      Debrief, operative note and handover
D. uro-scrotal-exploration
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.scrot.incision                    Scrotal incision and opening the tunica vaginalis
  7 step.scrot.detort                      Identify torsion and detort
  8 step.scrot.viability                   Assess viability after warming
  9 step.scrot.orchidectomy                Orchidectomy for a non-viable testis
 10 step.scrot.fixation                    Fixation of the affected testis
 11 step.scrot.contralateral               Contralateral fixation
 12 step.core.haemostasis                  Haemostasis before closure
 13 step.core.counts                       Swab, instrument and needle counts
 14 step.core.specimen                     Specimen handling and labelling
 15 step.core.skin-closure                 Skin closure and dressing
 16 step.core.debrief                      Debrief, operative note and handover
E. uro-suprapubic-catheter
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.uro.cystoscopy                    Urethrocystoscopy and systematic bladder inspection
  7 step.spc.ultrasound                    Ultrasound: full bladder and no bowel
  8 step.spc.seeker                        Local anaesthetic and seeker needle aspiration
  9 step.spc.insert                        Trocar or Seldinger insertion and catheter placement
 10 step.spc.secure                        Confirm drainage and secure the catheter
 11 step.core.haemostasis                  Haemostasis before closure
 12 step.core.counts                       Swab, instrument and needle counts
 13 step.core.skin-closure                 Skin closure and dressing
 14 step.core.debrief                      Debrief, operative note and handover
F. uro-ureteroscopy-laser
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.uro.fluoro-setup                  Fluoroscopy, contrast and radiation safety set-up
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.uro.cystoscopy                    Urethrocystoscopy and systematic bladder inspection
  8 step.uro.retrograde-pyelogram          Retrograde pyelogram: map the ureter and collecting system
  9 step.uro.safety-guidewire              Safety guidewire into the renal pelvis
 10 step.uro.infected-system-bailout       Pus in an obstructed system: drain and stop
 11 step.ursl.semirigid                    Semirigid ureteroscopy alongside the safety wire
 12 step.ursl.flexible-access              Flexible access and access sheath, when needed
 13 step.uro.lithotripsy                   Intracorporeal lithotripsy
 14 step.uro.fragment-clearance            Fragment retrieval and stone-free assessment
 15 step.ursl.ureter-inspection            Withdrawal inspection of the whole ureter
 16 step.uro.dj-stent                      Double-J stent placement and position check
 17 step.uro.stent-register                Stent register and removal plan
 18 step.core.specimen                     Specimen handling and labelling
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "d2-gastrectomy": {
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
  "ivor-lewis-oesophagectomy": { ... }, "uro-turbt": { ... }, "uro-scrotal-exploration": { ... }, "uro-suprapubic-catheter": { ... }, "uro-ureteroscopy-laser": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
