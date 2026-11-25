---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 15 (Retrograde double-J ureteric stent insertion, Percutaneous nephrolithotomy, Radical nephrectomy, Hydrocele repair, Adult circumcision): Gemini video and timestamp prompt (5 operations)

Same operations as [[SURGX-batch15-image-prompt]].

```
TASK
Find YouTube videos for 5 operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Retrograde double-J ureteric stent insertion
B. Percutaneous nephrolithotomy (PCNL)
C. Radical nephrectomy (open and laparoscopic principles)
D. Hydrocele repair (Jaboulay or Lord)
E. Adult circumcision

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
A. uro-dj-stent
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
 11 step.djs.length                        Choosing stent length and diameter
 12 step.uro.dj-stent                      Double-J stent placement and position check
 13 step.djs.failed-access                 Failed retrograde stenting: stop and arrange nephrostomy
 14 step.djs.bladder-drainage              Bladder drainage and output monitoring
 15 step.uro.stent-register                Stent register and removal plan
 16 step.core.specimen                     Specimen handling and labelling
 17 step.core.counts                       Swab, instrument and needle counts
 18 step.core.debrief                      Debrief, operative note and handover
B. uro-pcnl
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.uro.fluoro-setup                  Fluoroscopy, contrast and radiation safety set-up
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.uro.cystoscopy                    Urethrocystoscopy and systematic bladder inspection
  8 step.uro.safety-guidewire              Safety guidewire into the renal pelvis
  9 step.uro.retrograde-pyelogram          Retrograde pyelogram: map the ureter and collecting system
 10 step.pcnl.puncture                     Calyceal puncture: posterior calyx, end-on through the papilla
 11 step.uro.infected-system-bailout       Pus in an obstructed system: drain and stop
 12 step.pcnl.dilatation                   Tract dilatation and sheath placement
 13 step.uro.lithotripsy                   Intracorporeal lithotripsy
 14 step.uro.fragment-clearance            Fragment retrieval and stone-free assessment
 15 step.pcnl.bleeding                     Bleeding: tamponade, stop and escalate
 16 step.uro.dj-stent                      Double-J stent placement and position check
 17 step.pcnl.exit                         Exit strategy: nephrostomy, stent or tubeless
 18 step.uro.stent-register                Stent register and removal plan
 19 step.core.specimen                     Specimen handling and labelling
 20 step.core.counts                       Swab, instrument and needle counts
 21 step.pcnl.chest-check                  Chest check after upper or supracostal access
 22 step.core.debrief                      Debrief, operative note and handover
C. uro-radical-nephrectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.mdt-check                    MDT decision, staging and diagnosis confirmed
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.rn.access                         Access: laparoscopic ports or open incision
  8 step.onco.tumour-handling              Oncological handling: no touch, wound protection, clean field
  9 step.rn.mobilise                       Reflecting the colon and the overlying viscera
 10 step.rn.ureter-gonadal                 Ureter and gonadal vein: lift the lower pole
 11 step.rn.hilum                          Hilar dissection: identify every artery and vein
 12 step.rn.vessel-ligation                Ligation: artery first, then vein
 13 step.rn.vascular-bailout               Major bleeding or failure to progress: control and convert
 14 step.rn.upper-pole-adrenal             Upper pole and adrenal: decide, then free the specimen
 15 step.lap.specimen-retrieval            Specimen retrieval
 16 step.onco.specimen-orientation         Orienting the cancer specimen for the pathologist
 17 step.core.haemostasis                  Haemostasis before closure
 18 step.abd.drain                         Drain placement
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.abd.mass-closure                  Mass closure of the abdominal wall
 21 step.core.skin-closure                 Skin closure and dressing
 22 step.core.debrief                      Debrief, operative note and handover
D. uro-hydrocele-repair
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.uro.scrotal-imaging-check         Scrotal ultrasound and examination reviewed before incision
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.hyd.incision                      Scrotal incision through the dartos
  8 step.hyd.deliver                       Delivering the sac (Jaboulay) or preserving the plane (Lord)
  9 step.hyd.open-inspect                  Open the sac, drain the fluid and inspect the testis
 10 step.hyd.mass-bailout                  Unexpected testicular mass: stop
 11 step.hyd.sac-repair                    Jaboulay eversion or Lord plication
 12 step.core.haemostasis                  Haemostasis before closure
 13 step.hyd.replace-close                 Replace the testis and close the dartos
 14 step.core.specimen                     Specimen handling and labelling
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.core.skin-closure                 Skin closure and dressing
 17 step.core.debrief                      Debrief, operative note and handover
E. uro-adult-circumcision
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.circ.block                        Penile block (dorsal nerve and ring block)
  7 step.circ.adhesions-inspect            Free adhesions and inspect the glans and meatus
  8 step.circ.lesion-bailout               Suspicious lesion: biopsy and stop
  9 step.circ.outer-incision               Mark and incise the outer prepuce at the corona
 10 step.circ.inner-incision               Mark and incise the inner prepuce
 11 step.circ.excise                       Excise the sleeve of prepuce
 12 step.core.haemostasis                  Haemostasis before closure
 13 step.circ.anastomosis                  Skin-to-mucosa anastomosis
 14 step.core.specimen                     Specimen handling and labelling
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.core.skin-closure                 Skin closure and dressing
 17 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "uro-dj-stent": {
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
  "uro-pcnl": { ... }, "uro-radical-nephrectomy": { ... }, "uro-hydrocele-repair": { ... }, "uro-adult-circumcision": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
