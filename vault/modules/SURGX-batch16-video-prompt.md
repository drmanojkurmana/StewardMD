---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 16 (Subinguinal microsurgical varicocelectomy, Radical inguinal orchidectomy for testicular tumour, Pyloromyotomy, Paediatric inguinal herniotomy, Inguinal orchidopexy for undescended testis, Paediatric circumcision): Gemini video and timestamp prompt (6 operations)

Same operations as [[SURGX-batch16-image-prompt]].

```
TASK
Find YouTube videos for 6 operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Subinguinal microsurgical varicocelectomy
B. Radical inguinal orchidectomy for testicular tumour
C. Pyloromyotomy (Ramstedt)
D. Paediatric inguinal herniotomy
E. Inguinal orchidopexy for undescended testis
F. Paediatric circumcision

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
A. uro-varicocelectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.uro.scrotal-imaging-check         Scrotal ultrasound and examination reviewed before incision
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.vari.incision                     Subinguinal incision over the external ring
  8 step.uro.cord-delivery                 Delivering and isolating the spermatic cord
  9 step.vari.open-fascia                  Open the cord fasciae under the microscope
 10 step.vari.artery                       Identify and protect the testicular artery
 11 step.vari.lymphatics                   Identify and preserve the lymphatics
 12 step.vari.veins                        Ligate and divide the internal spermatic veins
 13 step.vari.external-veins               External spermatic and cremasteric veins
 14 step.vari.artery-bailout               Artery not found, or injured
 15 step.core.haemostasis                  Haemostasis before closure
 16 step.core.counts                       Swab, instrument and needle counts
 17 step.core.skin-closure                 Skin closure and dressing
 18 step.core.debrief                      Debrief, operative note and handover
B. uro-inguinal-orchidectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.mdt-check                    MDT decision, staging and diagnosis confirmed
  3 step.uro.scrotal-imaging-check         Scrotal ultrasound and examination reviewed before incision
  4 step.core.timeout                      Team brief, sign-in and time-out
  5 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  6 step.core.positioning                  Positioning and pressure care
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.orch.incision                     Inguinal incision and opening of the canal
  9 step.uro.cord-delivery                 Delivering and isolating the spermatic cord
 10 step.orch.cord-clamp                   Early cord control at the deep ring
 11 step.onco.tumour-handling              Oncological handling: no touch, wound protection, clean field
 12 step.orch.deliver                      Deliver the testis from the scrotum
 13 step.orch.doubt-bailout                Diagnostic doubt or solitary testis: inguinal exploration and frozen section
 14 step.orch.high-ligation                High ligation and division of the cord
 15 step.orch.prosthesis                   Testicular prosthesis, if chosen
 16 step.onco.specimen-orientation         Orienting the cancer specimen for the pathologist
 17 step.core.haemostasis                  Haemostasis before closure
 18 step.orch.canal-closure                Close the external oblique with the nerve protected
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.core.skin-closure                 Skin closure and dressing
 21 step.core.debrief                      Debrief, operative note and handover
C. pyloromyotomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.paeds.physiology-gate             Paediatric physiology check before anaesthesia
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.paeds.warming                     Thermal care for the infant
  6 step.core.positioning                  Positioning and pressure care
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.paeds.local-anaesthetic           Weight-based local anaesthetic infiltration
  9 step.lap.access                        Establishing pneumoperitoneum
 10 step.lap.ports                         Port placement
 11 step.pyl.expose                        Exposing and stabilising the pylorus
 12 step.pyl.myotomy                       Seromuscular incision and spreading
 13 step.pyl.leak-test                     Testing mucosal integrity
 14 step.core.haemostasis                  Haemostasis before closure
 15 step.core.counts                       Swab, instrument and needle counts
 16 step.lap.closure                       Desufflation and port-site closure
 17 step.core.skin-closure                 Skin closure and dressing
 18 step.core.debrief                      Debrief, operative note and handover
D. paeds-herniotomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.paeds.physiology-gate             Paediatric physiology check before anaesthesia
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.paeds.warming                     Thermal care for the infant
  6 step.core.positioning                  Positioning and pressure care
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.paeds.local-anaesthetic           Weight-based local anaesthetic infiltration
  9 step.hern.access                       Skin crease incision and opening the canal
 10 step.hern.sac                          Separating the sac from the vas and vessels
 11 step.hern.ligate                       High ligation of the sac
 12 step.core.haemostasis                  Haemostasis before closure
 13 step.hern.testis                       Returning the testis to the scrotum
 14 step.core.counts                       Swab, instrument and needle counts
 15 step.core.skin-closure                 Skin closure and dressing
 16 step.core.debrief                      Debrief, operative note and handover
E. paeds-orchidopexy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.paeds.physiology-gate             Paediatric physiology check before anaesthesia
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.paeds.warming                     Thermal care for the infant
  6 step.core.positioning                  Positioning and pressure care
  7 step.orch.eua                          Examination under anaesthesia confirms the plan
  8 step.core.prep-drape                   Skin preparation and draping
  9 step.paeds.local-anaesthetic           Weight-based local anaesthetic infiltration
 10 step.orch.access                       Groin crease incision and finding the testis
 11 step.orch.mobilise                     Mobilising the testis and dividing the gubernaculum
 12 step.orch.processus                    Separating and ligating the patent processus vaginalis
 13 step.orch.length                       Gaining length on the vessels
 14 step.orch.bailout                      When the testis will not reach, or is not viable
 15 step.orch.dartos-pouch                 Placing the testis in a subdartos pouch
 16 step.core.haemostasis                  Haemostasis before closure
 17 step.core.specimen                     Specimen handling and labelling
 18 step.core.counts                       Swab, instrument and needle counts
 19 step.core.skin-closure                 Skin closure and dressing
 20 step.paeds.daycase-discharge           Day-case discharge criteria and parent instructions
 21 step.core.debrief                      Debrief, operative note and handover
F. paeds-circumcision
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.paeds.physiology-gate             Paediatric physiology check before anaesthesia
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.circ.anatomy-check                Anatomy check: stop if circumcision is wrong for this penis
  7 step.core.prep-drape                   Skin preparation and draping
  8 step.paeds.local-anaesthetic           Weight-based local anaesthetic infiltration
  9 step.circ.adhesiolysis                 Freeing the inner prepuce from the glans
 10 step.circ.marking                      Marking the outer and inner incisions
 11 step.circ.excision                     Excising the prepuce with the glans protected
 12 step.circ.frenulum                     Securing the frenular artery
 13 step.core.haemostasis                  Haemostasis before closure
 14 step.core.skin-closure                 Skin closure and dressing
 15 step.core.specimen                     Specimen handling and labelling
 16 step.core.counts                       Swab, instrument and needle counts
 17 step.paeds.daycase-discharge           Day-case discharge criteria and parent instructions
 18 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "uro-varicocelectomy": {
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
  "uro-inguinal-orchidectomy": { ... }, "pyloromyotomy": { ... }, "paeds-herniotomy": { ... }, "paeds-orchidopexy": { ... }, "paeds-circumcision": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
