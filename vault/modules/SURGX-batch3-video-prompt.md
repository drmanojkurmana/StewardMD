---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 3: Gemini video and timestamp prompt (5 operations)

Same five operations as [[SURGX-batch3-image-prompt]]. The step ids are the real ones from the JSON.
After Gemini answers, every video id is checked with YouTube oEmbed (200 means embedding is allowed, 401 means it is not),
added to the `_site/yt.html` ALLOW list and wired as `kind:"embed"` clips with `start` and `end` (see [[SURGX]]).

```
TASK
Find YouTube operative videos for five operations, watch them, and give me exact clip timestamps for each step
listed below. The clips will play inside a surgical training app, one clip under each step.

OPERATIONS
A. Excisional haemorrhoidectomy (Milligan-Morgan)
B. Tonsillectomy
C. Total knee replacement (cemented, medial parapatellar)
D. Laparoscopic right hemicolectomy (medial to lateral, ideally CME)
E. Transurethral resection of the prostate (TURP)

HOW TO CHOOSE VIDEOS
1. Search YouTube yourself. For each operation pick 2 to 4 videos that you can actually WATCH (video, not audio-only
   podcasts or slides). Prefer, in order: university or hospital channels, surgical societies and journals (for
   example WebSurg/IRCAD, JOMI, ASCRS, ENT UK, AAOS/OrthoInfo, EAU, AUA), recognised surgeon educators, then high-quality animations.
2. Embedding must be allowed. Do NOT use Nucleus Medical Media (embedding disabled). Skip any video marked
   "Video unavailable" or "Playback on other websites has been disabled".
3. The technique must be safe, current practice. Reject a video that cuts the anal sphincter during haemorrhoidectomy,
   resects distal to the verumontanum, or shows an unsafe lateral-only colectomy for cancer. Note anything else
   outdated in "concerns", but keep the video if the clip itself is correct.
4. Real operative footage is preferred for operative steps; an animation is fine where footage does not show the
   step clearly.

HOW TO TIME CLIPS
- Watch the video. Give start and end in WHOLE SECONDS from the start of the video, verified by watching, not
  guessed from chapters or the description.
- Each clip shows that step and only that step, 5 to 60 seconds long.
- If a step is not in your first videos, SEARCH FOR ANOTHER VIDEO that shows it before giving up. Only then use null.
  Team, consent, count, labelling and handover steps are often missing from operative videos; a separate good
  teaching video for them (for example a WHO Surgical Safety Checklist demonstration) is welcome.
- Videos need not follow the steps in the same order or name them the same way. Map what is shown to the step whose
  description matches.
- For each step pick ONE "best" clip.

THE STEPS (use these step ids exactly)
A. haemorrhoidectomy
  1 step.core.consent-check            Consent, site marking and identity check
  2 step.core.timeout                  Team brief, sign-in and time-out
  3 step.core.prophylaxis              Antimicrobial and thromboprophylaxis
  4 step.core.positioning              Positioning and pressure care
  5 step.core.prep-drape               Skin preparation and draping
  6 step.ano.local-block               Local anaesthetic infiltration for perianal and sacrococcygeal surgery
  7 step.ano.eua                       Examination under anaesthesia: confirm the diagnosis before the operation
  8 step.ano.sphincter-identify        Identifying the internal and external sphincters
  9 step.ano.when-to-stop              Bailout: stop, change the plan, or come back another day
 10 step.hmd.plan                      Planning the excisions and the skin bridges
 11 step.hmd.excision                  Excising each haemorrhoid off the internal sphincter
 12 step.hmd.ligation                  Transfixing and dividing the pedicle
 13 step.core.haemostasis              Haemostasis before closure
 14 step.ano.final-inspection          Final inspection of the anal canal
 15 step.core.counts                   Swab, instrument and needle counts
 16 step.core.specimen                 Specimen handling and labelling
 17 step.ano.wound-care                Dressing, bowel regimen and the plan for the open wound
 18 step.core.debrief                  Debrief, operative note and handover
B. tonsillectomy
  1 step.core.consent-check            Consent, site marking and identity check
  2 step.ent.preop-data-check          Confirm the investigation that justifies the operation
  3 step.core.timeout                  Team brief, sign-in and time-out
  4 step.core.prophylaxis              Antimicrobial and thromboprophylaxis
  5 step.ent.airway-share              Shared airway plan with the anaesthetist
  6 step.core.positioning              Positioning and pressure care
  7 step.core.prep-drape               Skin preparation and draping
  8 step.tonsil.gag                    Insert and suspend the mouth gag
  9 step.tonsil.dissection             Dissection in the peritonsillar plane
 10 step.core.haemostasis              Haemostasis before closure
 11 step.ent.pharynx-clearance         Clear the pharynx: throat pack out, clot out, postnasal space checked
 12 step.core.counts                   Swab, instrument and needle counts
 13 step.core.specimen                 Specimen handling and labelling
 14 step.ent.airway-handover           Airway handover to recovery and the ward
 15 step.core.debrief                  Debrief, operative note and handover
C. total-knee-replacement
  1 step.core.consent-check            Consent, site marking and identity check
  2 step.core.timeout                  Team brief, sign-in and time-out
  3 step.core.prophylaxis              Antimicrobial and thromboprophylaxis
  4 step.ortho.arthroplasty-asepsis    Arthroplasty theatre discipline and asepsis
  5 step.core.positioning              Positioning and pressure care
  6 step.ortho.tourniquet              Tourniquet: decide, apply, record
  7 step.core.prep-drape               Skin preparation and draping
  8 step.tkr.approach                  Medial parapatellar arthrotomy and exposure
  9 step.tkr.bone-cuts                 Distal femoral and proximal tibial bone cuts
 10 step.tkr.rotation-balance          Femoral sizing, rotation and gap balancing
 11 step.ortho.trial-reduction         Trial components: stability, length and range
 12 step.ortho.implant-check           Implant selection, check and register
 13 step.ortho.cement-implant          Cementing and implanting with a cement safety pause
 14 step.ortho.periprosthetic-fracture Intra-operative periprosthetic fracture: stop and reassess
 15 step.tkr.patella-closure           Patellar resurfacing, tracking and arthrotomy closure
 16 step.core.haemostasis              Haemostasis before closure
 17 step.core.counts                   Swab, instrument and needle counts
 18 step.core.skin-closure             Skin closure and dressing
 19 step.ortho.nv-check                Neurovascular and compartment check before leaving theatre
 20 step.core.debrief                  Debrief, operative note and handover
D. right-hemicolectomy
  1 step.core.consent-check            Consent, site marking and identity check
  2 step.onco.mdt-check                MDT decision, staging and diagnosis confirmed
  3 step.core.timeout                  Team brief, sign-in and time-out
  4 step.core.prophylaxis              Antimicrobial and thromboprophylaxis
  5 step.core.positioning              Positioning and pressure care
  6 step.core.prep-drape               Skin preparation and draping
  7 step.lap.access                    Establishing pneumoperitoneum
  8 step.lap.ports                     Port placement
  9 step.lap.survey                    Diagnostic laparoscopy and survey
 10 step.onco.tumour-handling          Oncological handling: no touch, wound protection, clean field
 11 step.rhc.medial-to-lateral         Medial-to-lateral mobilisation in the mesocolic plane
 12 step.rhc.central-ligation          Central vascular ligation at the superior mesenteric vessels
 13 step.rhc.flexure                   Lateral attachments and hepatic flexure
 14 step.lap.specimen-retrieval        Specimen retrieval
 15 step.abd.bowel-handling            Handling and assessing bowel
 16 step.rhc.anastomosis               Ileocolic anastomosis
 17 step.onco.specimen-orientation     Orienting the cancer specimen for the pathologist
 18 step.core.haemostasis              Haemostasis before closure
 19 step.core.counts                   Swab, instrument and needle counts
 20 step.core.specimen                 Specimen handling and labelling
 21 step.lap.closure                   Desufflation and port-site closure
 22 step.core.skin-closure             Skin closure and dressing
 23 step.core.debrief                  Debrief, operative note and handover
E. uro-turp
  1 step.core.consent-check            Consent, site marking and identity check
  2 step.core.timeout                  Team brief, sign-in and time-out
  3 step.core.prophylaxis              Antimicrobial and thromboprophylaxis
  4 step.core.positioning              Positioning and pressure care
  5 step.core.prep-drape               Skin preparation and draping
  6 step.uro.cystoscopy                Urethrocystoscopy and systematic bladder inspection
  7 step.uro.resectoscope              Resectoscope set-up, irrigation fluid and urethral calibration
  8 step.turp.median-lobe              Bladder neck and median lobe
  9 step.turp.lateral-lobes            Lateral lobes
 10 step.turp.apex                     Apical resection, staying proximal to the verumontanum
 11 step.turp.fluid-watch              TUR syndrome watch: time, pressure, sinuses and sodium
 12 step.uro.chip-evacuation           Chip evacuation and specimen collection
 13 step.core.haemostasis              Haemostasis before closure
 14 step.uro.perforation-check         Final inspection: perforation, orifices and landmarks
 15 step.uro.three-way-catheter        Three-way catheter and continuous irrigation
 16 step.core.counts                   Swab, instrument and needle counts
 17 step.core.specimen                 Specimen handling and labelling
 18 step.core.debrief                  Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "haemorrhoidectomy": {
    "videos": [
      { "key": "V1", "videoId": "11-char id", "url": "https://www.youtube.com/watch?v=...", "title": "...",
        "channel": "...", "durationSec": 0, "kind": "operative|animation|lecture|safety",
        "watched": true, "concerns": ["..."] }
    ],
    "steps": [
      { "n": 1, "id": "step.core.consent-check",
        "clips": [ { "video": "V1", "start": 0, "end": 0, "shows": "one line", "confidence": "high|medium|low" } ],
        "best": "V1" }
    ]
  },
  "tonsillectomy": { ... }, "total-knee-replacement": { ... }, "right-hemicolectomy": { ... }, "uro-turp": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
