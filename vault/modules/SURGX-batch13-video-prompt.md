---
tags: [surgx, media, prompt, gemini, video]
---
# SURGX batch 13 (Splenectomy: trauma and elective, Laparoscopic anterior resection with total mesorectal excision, Pancreaticoduodenectomy, Right hepatectomy, Modified radical neck dissection): Gemini video and timestamp prompt (5 operations)

Same operations as [[SURGX-batch13-image-prompt]].

```
TASK
Find YouTube videos for 5 operations, watch them, and give me exact clip timestamps for each step listed below.
The clips play inside a surgical training app, one short clip under each step. The app plays ONLY the segment you
give, so a long video is fine as long as the segment is exact.

OPERATIONS
A. Splenectomy: trauma and elective
B. Laparoscopic anterior resection with total mesorectal excision
C. Pancreaticoduodenectomy (Whipple)
D. Right hepatectomy
E. Modified radical neck dissection

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
A. splenectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.abd.midline                       Midline laparotomy incision
  7 step.abd.exploration                   Systematic exploration
  8 step.spl.mobilise                      Mobilising the spleen forwards into the wound
  9 step.spl.salvage-decision              Salvage or remove: the trauma decision
 10 step.spl.short-gastrics                Dividing the short gastric vessels
 11 step.spl.hilum                         Controlling and dividing the splenic hilum
 12 step.hpb.major-bleed                   Major haemorrhage: press, tell, call, then repair or pack
 13 step.spl.accessory                     Searching for accessory spleens
 14 step.core.haemostasis                  Haemostasis before closure
 15 step.abd.drain                         Drain placement
 16 step.core.counts                       Swab, instrument and needle counts
 17 step.core.specimen                     Specimen handling and labelling
 18 step.abd.mass-closure                  Mass closure of the abdominal wall
 19 step.core.skin-closure                 Skin closure and dressing
 20 step.core.debrief                      Debrief, operative note and handover
B. lap-anterior-resection-tme
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.core.timeout                      Team brief, sign-in and time-out
  3 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  4 step.core.positioning                  Positioning and pressure care
  5 step.core.prep-drape                   Skin preparation and draping
  6 step.lap.access                        Establishing pneumoperitoneum
  7 step.lap.ports                         Port placement
  8 step.lap.survey                        Diagnostic laparoscopy and survey
  9 step.bowel.left-medial-to-lateral      Medial-to-lateral mobilisation of the left colon and sigmoid, ureter first
 10 step.bowel.ima-ligation                Inferior mesenteric artery and vein ligation
 11 step.bowel.splenic-flexure             Splenic flexure mobilisation
 12 step.tme.posterior                     Posterior mesorectal dissection in the holy plane
 13 step.tme.anterolateral                 Lateral and anterior mesorectal dissection
 14 step.tme.transection                   Confirming the distal margin and transecting the rectum
 15 step.lap.specimen-retrieval            Specimen retrieval
 16 step.bowel.circular-anastomosis        Circular stapled colorectal anastomosis (double-stapled)
 17 step.bowel.leak-check                  Checking the repair or anastomosis
 18 step.bowel.colorectal-bailout          Deciding against an unprotected anastomosis: defunction or end colostomy
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.core.specimen                     Specimen handling and labelling
 21 step.core.skin-closure                 Skin closure and dressing
 22 step.core.debrief                      Debrief, operative note and handover
C. pancreaticoduodenectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.mdt-check                    MDT decision, staging and diagnosis confirmed
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.hpb.upper-access                  Upper abdominal incision and fixed retraction
  8 step.abd.exploration                   Systematic exploration
  9 step.hpb.ious                          Intra-operative ultrasound before committing
 10 step.whip.kocher                       Kocher manoeuvre and assessment of the head
 11 step.hpb.hepatoduodenal                Dissecting the hepatoduodenal ligament
 12 step.whip.neck-tunnel                  Tunnel behind the pancreatic neck: the resectability gate
 13 step.whip.bailout                      Unresectable at operation: stop, biopsy, bypass
 14 step.whip.resection                    Division and resection: stomach, bile duct, jejunum, neck, uncinate
 15 step.whip.reconstruction               Reconstruction: pancreatic, biliary and gastric anastomoses
 16 step.hpb.bile-leak-check               Checking for bile leakage before closure
 17 step.hpb.major-bleed                   Major haemorrhage: press, tell, call, then repair or pack
 18 step.abd.drain                         Drain placement
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.onco.specimen-orientation         Orienting the cancer specimen for the pathologist
 21 step.abd.mass-closure                  Mass closure of the abdominal wall
 22 step.core.debrief                      Debrief, operative note and handover
D. right-hepatectomy
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.mdt-check                    MDT decision, staging and diagnosis confirmed
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.hpb.upper-access                  Upper abdominal incision and fixed retraction
  8 step.hpb.ious                          Intra-operative ultrasound before committing
  9 step.hep.mobilise                      Mobilising the right liver off the diaphragm and the vena cava
 10 step.hpb.hepatoduodenal                Dissecting the hepatoduodenal ligament
 11 step.hep.inflow                        Inflow control: right hepatic artery and right portal vein
 12 step.hep.outflow                       Outflow control: the right hepatic vein
 13 step.hpb.pringle                       Pringle manoeuvre: sling, clamp, time, release
 14 step.hep.transection                   Parenchymal transection along the demarcation line
 15 step.hpb.major-bleed                   Major haemorrhage: press, tell, call, then repair or pack
 16 step.hpb.bile-leak-check               Checking for bile leakage before closure
 17 step.core.haemostasis                  Haemostasis before closure
 18 step.abd.drain                         Drain placement
 19 step.core.counts                       Swab, instrument and needle counts
 20 step.onco.specimen-orientation         Orienting the cancer specimen for the pathologist
 21 step.abd.mass-closure                  Mass closure of the abdominal wall
 22 step.core.debrief                      Debrief, operative note and handover
E. modified-radical-neck-dissection
  1 step.core.consent-check                Consent, site marking and identity check
  2 step.onco.mdt-check                    MDT decision, staging and diagnosis confirmed
  3 step.core.timeout                      Team brief, sign-in and time-out
  4 step.core.prophylaxis                  Antimicrobial and thromboprophylaxis
  5 step.core.positioning                  Positioning and pressure care
  6 step.core.prep-drape                   Skin preparation and draping
  7 step.mrnd.incision-flaps               Incision and subplatysmal flaps
  8 step.mrnd.level-i                      Level I: submental and submandibular triangles
  9 step.mrnd.accessory-nerve              Find and preserve the spinal accessory nerve
 10 step.mrnd.posterior-triangle           Level V: posterior triangle above the prevertebral fascia
 11 step.mrnd.carotid-sheath               Unwrap the carotid sheath and preserve the internal jugular vein
 12 step.onco.nodal-clearance              En bloc nodal clearance by named level or station
 13 step.onco.major-vein-injury            Major vein injury during a nodal clearance: press, control, repair
 14 step.mrnd.thoracic-duct                Base of the neck: lymphatic ligation and chyle check
 15 step.onco.specimen-orientation         Orienting the cancer specimen for the pathologist
 16 step.core.haemostasis                  Haemostasis before closure
 17 step.onco.suction-drain                Closed suction drain for the dead space after a nodal clearance
 18 step.core.counts                       Swab, instrument and needle counts
 19 step.core.specimen                     Specimen handling and labelling
 20 step.core.skin-closure                 Skin closure and dressing
 21 step.neck.haematoma-handover           Airway and haematoma handover after neck surgery
 22 step.core.debrief                      Debrief, operative note and handover

OUTPUT
Reply with ONE JSON block only, in exactly this shape (one object per operation):
{
  "splenectomy": {
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
  "lap-anterior-resection-tme": { ... }, "pancreaticoduodenectomy": { ... }, "right-hepatectomy": { ... }, "modified-radical-neck-dissection": { ... }
}
Rules: every step appears, in order. A step with no clip after searching has "clips": [] and "best": null.
"watched": false for any video you could not actually watch, and use no clips from it. Never invent a videoId:
copy it from the real URL.
```
