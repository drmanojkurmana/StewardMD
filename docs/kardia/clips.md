# Kardia real echo clips (WP12): accepted, rejected, gaps

Checked 2026-10-25 via the Wikimedia Commons MediaWiki API (curl, namespace 6 file
search plus the categories Echocardiography, Echocardiogram videos, Transthoracic
echocardiography, Point-of-care ultrasound). For every file below, the licence
 fields LicenseShortName, Artist, Credit and LicenseUrl were read from
imageinfo extmetadata, the Commons file description page was read (case
description, source, upload date), and at least one frame was inspected on screen
(full frame for stills and GIFs, poster frame for video) for patient names, IDs,
dates of birth, hospital names or branding burnt into the image.

Credits live in kardia/media/credits.json (39 entries; shape follows the per-clip
fields the plan asks for, modelled on the dataset-keyed tokos/media/credits.json).
Downloads live in work/clips/ (36 video/animation files plus stills, not in the
repo). No app code touched, no git run.

## De-identification standard applied

The owner rule rejects clips showing patient names, dates, hospital names or IDs
burnt into the image. Applied as: reject on any patient identifier (name, ID,
date of birth, hospital name or department branding that is part of the scan UI,
patient-linked dates). Accepted clips carry only three kinds of overlay, each
listed per clip in credits.json notes: (a) neutral machine overlays (depth
scale, ECG trace, heart rate, measurement tables, vendor mark such as GE or
ACUSON, a bare machine timestamp with no patient context), (b) teaching
annotations added by the publisher (labels, arrows, legends), (c) the
licence-required attribution (CardioNetworks credit line and ECHOPEDIA.ORG mark),
which the CC BY-SA licence forbids removing. Five accepted clips carry a bare
machine date stamp and are flagged in notes so the owner can overrule: PLAX
normal, SAXPAP normal, A4C normal, A2C normal, A3C normal, Subcostal normal, PD
VSD still, PD ASD still, DCM still, tamponade E00167.

## Accepted (39)

Normal views, video unless stated: PLAX normal, PSAX papillary normal, PSAX AV
still (public domain), A4C normal, A2C normal, A3C normal, subcostal normal, IVC
ultrasound GIF, IVC thrombus (subcostal, shows IVC), PLAX respiratory variation
(MPEG-4), suprasternal arch (bonus view), A4C saline-contrast with hypermobile
interatrial septum, PLAX M-mode still (public domain).

Pathologies, video unless stated: severe mitral stenosis, severe aortic stenosis
plus AS M-mode still (public domain), posterior-leaflet prolapse MR plus MR CW
Doppler still (CC BY 4.0) plus MR colour 4ch still, eccentric AR plus AR CW
Doppler still from an endocarditis case, pericardial effusion x2 (ECHOpedia PLAX,
NSTEMI case CC BY 3.0), tamponade x2 (ECHOpedia apical, cor-pulmonale case
CC BY 2.0), obstructive HCM with SAM x2, apical (non-obstructive) HCM, DCM still
(CC BY-SA 3.0), secundum ASD still (public domain), complete AVSD video (filed
under ASD, inlet VSD noted), muscular VSD, perimembranous VSD with shunt, VSD
colour still (public domain), endocarditis vegetations x3 (TTE, TEE multiplane,
bedside subxiphoid with labels), apical LV thrombus GIF, apical infarct
(post-MI wall motion) video.

Licences in use: CC BY-SA 3.0 (25), CC BY 2.0 (5), public domain (5),
CC BY-SA 4.0 (2), CC BY 4.0 (1), CC BY 3.0 (1). No NC or ND content.

## Rejected (with reason)

* LV-thrombi-in-dilated-cardiomyopathy video (Journal of Medical Case Reports,
  CC BY 4.0): top bar reads TOSHIBA NISHINOMIYA KYOURITSU, a hospital name
  burnt into the image. Rejected per owner rule.
* Mitral-annular-disjunction S1 (CC BY 2.0): top bar HOSPITAL DE SANTA CRUZ -
  CARDIOLOGIA plus date 17 Oct 05. Rejected per owner rule.
* Lynch/Jaffe teaching GIFs (PLAX, short axis, subcostal, bicuspid valve,
  CC BY 2.5) and the ECHOpedia Lynch diagram stills: composite
  scan-plus-anatomical-diagram illustrations, not real scans. Rejected as
  non-real; the views they cover are covered by real clips above.
* Radiopaedia: probed (HTTP 406 from this network) and no echo case stating
  CC BY was identified; the house regime is CC BY-NC-SA, which fails the
  commercial-use gate. Not used.
* YouTube and any unclear-licence source: never used.
* EchoNet-Dynamic, EchoXFlow, CAMUS, MIMIC-IV echo: excluded per the plan,
  non-commercial or unclear licences.
* Not pursued (redundant, views already covered by accepted video): 4 chamber
  GIF, Apikal4D GIF, A2Cnormal1 GIF, Fluidopericardium GIF, AoK Insuff still,
  Pericardial effusion (Kalumet) still.

## Gaps

* PSAX at aortic-valve level: still only, no video with a commercial-use
  licence found. Target unmet for video; still accepted.
* DCM: still only (the only CC-BY DCM video carries a hospital name and was
  rejected). DCM video is a gap.
* Catalogue pathologies with no clip: tricuspid regurgitation,
  left-ventricular hypertrophy as a standalone entry (concentric LVH is visible
  in the severe-AS clip, noted there), pulmonary hypertension (the tamponade
  case has cor pulmonale, noted), patent ductus arteriosus, tetralogy of
  Fallot, aortic dissection. No commercial-use video or still found on Commons
  for these; PMC supplementary videos under CC BY are the next place to look.
* TEE: one bonus TEE clip (endocarditis S2); TEE basics need more, outside
  this job's targets.
* Everything accepted is content-hashed under work/clips/ and mapped to
  credits.json content names; R2 upload and in-app wiring are WP12 follow-ups,
  not done here.

## WP12b de-identification pass (2026-10-26)

Owner rule for this pass: every real scan shown in the app must carry no
burnt-in text that is not anatomy (no dates or times, no patient or hospital
names or IDs, no machine brand, no website or watermark marks, no burnt-in R/L
markers). This supersedes the earlier acceptance note that kept neutral machine
overlays and licence credit lines on the image: all of it was removed from the
pixels. Attribution lives only in kardia/media/credits.json and the app's
credits screen, never on the image. Cropping and masking are permitted
adaptations under CC BY and CC BY-SA (outputs keep the same licence; the
credits entries say "cropped and masked" as the licences require noting
changes).

Method: 3 frames (start, middle, end) were extracted from every file in
work/clips (39 files) and inspected; text was removed by cropping to the
sector/image region first and masking the rest with black boxes (ffmpeg
drawbox). Re-encoded for the phone: H.264 MP4 (yuv420p, faststart, no audio),
longest side 640 px, 30 fps; stills to WebP quality 82, longest side 960.
3 frames were re-extracted from every output and inspected again; residuals
were fixed and re-verified. Long teaching videos were trimmed to whole-cycle
loops (tamponade-cor-pulmonale to 12 s, subxiphoid vegetation to 8 s).

Kept 39, dropped 0, total 10325086 bytes (9.8 MB). Every output is at
most 3 MB (largest: pericardial-effusion-2.mp4, 2526898 bytes). A final
3-frame sweep after the first verify pass found six more in-region remnants
(depth numerals 5/10/15, a cursor x-mark); all were masked and re-verified
(details below).

What was removed per kept clip (anatomy chamber/teaching labels kept:
V.G/V.D/A.G/A.D, RV/IVS/RA/LV/MV/LA, RA/RV/TV/LV/LA + vegetation arrow,
RV/LV/RA/LA/PE, LV-thrombus annotation dot):

* tte-plax-1, tte-psax-papillary-1, tte-a4c-1, tte-a2c-1, tte-a3c-1,
  tte-subcostal-4c-1: date stamp, V marker, depth numerals, heart-rate
  readout, ECG plus credit strip cropped out, CardioNetworks credit lines,
  ECHOPEDIA.ORG mark.
* tte-psax-av-1: exam time, "67" heart-rate readout, ACUSON vendor mark, side
  machine parameters, R-side marker, ECG number, bottom parameter row.
* tte-subcostal-ivc-1: GE vendor mark, right-side depth numbers.
* tte-subcostal-ivc-2: V marker, depth numerals, heart-rate readout,
  ECG/credits cropped out, credit lines, mark; final sweep also masked
  in-region depth numerals 5 and 10.
* tte-plax-2: V marker, depth numerals, "24 HR" readout, side machine text;
  respiratory and ECG traces kept.
* tte-suprasternal-arch-lax-1, tte-a4c-2, mitral-stenosis-1,
  aortic-stenosis-1, mitral-regurgitation-1, pericardial-effusion-1,
  cardiac-tamponade-1, hcm-obstructive-sam-1, hcm-non-obstructive-1,
  atrial-septal-defect-2, ventricular-septal-defect-2,
  regional-wall-motion-abnormality-mi-1, aortic-regurgitation-1: V marker,
  depth numerals, heart-rate readout, ECG/credits cropped out, credit lines,
  mark (plus time stamp on aortic-regurgitation-1 and cardiac-tamponade-1).
* tte-plax-3: measurement table, inset sector, right velocity numbers,
  bottom time/rate readouts cropped out.
* aortic-stenosis-2: nothing to remove (French chamber labels are anatomy).
* mitral-regurgitation-2, lv-thrombus-1: nothing to remove (no text).
* mitral-regurgitation-3: machine parameters, title, menu, scale numbers
  cropped out.
* aortic-regurgitation-2: measurement box, inset sector, right velocity
  numbers with units, bottom time/rate readouts, credit lines cropped out.
* pericardial-effusion-2: machine parameters, body-position marker, mode
  label, bpm readout, JPEG tag cropped out or masked.
* cardiac-tamponade-2: possible patient name MATEJ, machine parameters, body
  marker, probe marker, right-edge letters; trimmed to first 12 s; final
  sweep also masked a burnt-in cursor/measurement x-mark.
* hcm-obstructive-sam-2: bottom-edge machine text; ECG cropped out.
* dilated-cardiomyopathy-1: date/time, machine parameters, depth label, body
  marker, MI tag, single-letter marker.
* atrial-septal-defect-1, ventricular-septal-defect-3: date, V marker, depth
  and colour-scale numerals, heart-rate readout; ECG cropped out; final
  sweep covered a depth numeral 5 peeking above its mask on
  atrial-septal-defect-1.
* infective-endocarditis-vegetation-1: body-position text, top probe marker.
* infective-endocarditis-vegetation-2: patient/probe temperature readouts,
  multiplane angle readout, body-position text, top marker.
* infective-endocarditis-vegetation-3: title, bottom legend, side machine
  parameters; trimmed to first 8 s.
* ventricular-septal-defect-1: V marker, depth numerals, colour-scale
  numbers, heart-rate readout, ECG/credits cropped out; final sweep also
  masked in-region depth numerals 5 and 10.
* mitral-regurgitation-1: final sweep masked in-region depth numerals 10
  and 15 (on top of the V marker / depth numerals / heart-rate / ECG
  removal shared with the TTE batch).
* tte-a4c-2: final sweep masked an in-region depth numeral 5 (on top of the
  V marker / depth numerals / heart-rate / ECG removal shared with the
  TTE batch).

Rejected for this pass: none. The two clips rejected earlier (Toshiba
hospital branding, Santa Cruz hospital bar) never entered work/clips.

Rejected record unchanged from above; outputs live in work/clips-clean/
(30 mp4 + 9 webp, not in the repo) and credits.json file names, bytes and
sha256 now describe the clean outputs.

## Counts

Views: PLAX 3, PSAX AV 1, PSAX papillary 1, A4C 2, A2C 1, A3C 1, subcostal 1,
IVC 2, suprasternal 1. Pathology: MS 1, AS 2, MR 3, AR 2, effusion 2, tamponade
2, HCM obstructive 2, HCM non-obstructive 1, DCM 1, ASD 2, VSD 3, vegetation 3,
LV thrombus 1, post-MI wall motion 1. TR, LVH standalone, pulmonary
hypertension standalone, PDA, TOF and dissection: 0.

- aortic-stenosis-2: dropped by lead review 2026-10-25 (four chamber still with French chamber labels, not an aortic stenosis image).
