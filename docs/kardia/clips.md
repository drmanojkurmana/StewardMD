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

## WP12c expansion pass (2026-10-26)

Second sourcing sweep, same gates (commercial-use licences only: CC BY, CC BY-SA,
CC0, public domain; never NC, ND, YouTube or unclear). Candidates came from a
research sweep over Commons categories and keyword search (CardioNetworks/
ECHOpedia uploads plus journal video supplements). For every candidate the
licence fields (LicenseShortName, Artist, LicenseUrl) were re-verified via the
MediaWiki API imageinfo extmetadata immediately before download, the full file
was downloaded to work/clips/, and 3 frames (start, middle, end) were inspected
on screen. Rejected files with burnt-in PHI were deleted from work/clips/
(patient names, record numbers, DOBs and hospital cardiology branding are PHI
and never ship). Accepted clips were de-identified exactly like the WP12b batch
(crop to sector, mask dates, times, machine parameters, vendor marks, website
and credit lines, R/L and orientation markers; pure anatomy plus ECG trace and
publisher chamber/teaching labels kept) and re-encoded H.264 MP4
(yuv420p, faststart, no audio, longest side 640, 30 fps, at most 3 MB, trimmed
to whole-cycle loops). 3 frames were re-extracted from every OUTPUT and
inspected again; residuals were fixed by detection-guided masking (yellow-tint
and grey glyph detection plus white-band checks) and re-verified to zero
residual text. 13 clips added to kardia/media/credits.json (51 entries total,
checkedAt 2026-10-26 for the new entries); outputs in work/clips-clean/
(13 mp4, 1.7 MB total, not in the repo).

Accepted (13): tte-a5c-1 (A5C normal, first A5C clip), tte-suprasternal-arch-lax-2
(SuprasternalNormal, second suprasternal arch clip), tricuspid-regurgitation-1
(E00566, first TR clip, closes the TR gap), tte-psax-av-2 (bicuspid AV short axis
from the Gerbode case, first PSAX-AV video), tte-psax-av-3 (fibroelastoma AV
short axis, second PSAX-AV video), tee-me-bicaval-1 (transseptal bicaval, first
TEE-view clip, echo-only segment, presentation title cards excluded by trim),
pocus-fast-subxiphoid-1 (bedside subxiphoid color Doppler, first
FAST-subxiphoid POCUS clip), pocus-efast-lung-right-1 (lung sliding, first
eFAST-lung POCUS clip; source states no laterality, filed under right as a
placeholder), tte-a4c-rv-focus-1 (embolus-case RV focus, first RV-focus clip),
cardiac-tamponade-3 (E00169, third tamponade clip), hcm-non-obstructive-2
(E00293 apical HCM, second clip), atrial-septal-defect-3 (E00320 AVSD, third ASD
clip), pericardial-effusion-3 (E00675, third effusion clip).

Licences of the new batch: CC BY-SA 3.0 (7), CC BY 2.0 (4), CC BY 3.0 (2).
No NC or ND content.

Rejected (11): a5c-2 (beta-blocker exercise echo S1, CC BY 2.0: burnt-in patient
name plus record number, hospital cardiology department and exam date; deleted);
pocus-resus-1 (resuscitative-ultrasound S4, CC BY 2.0: burnt-in patient name plus
ID; deleted); lvh-1 (contrast stress echo in hypertension S1, CC BY 2.0:
burnt-in university-hospital cardiology branding; deleted, LVH still a gap);
ms-2 (mitral supravalvular ring S1, CC BY 2.0: burnt-in patient name, date of
birth and hospital cardiology department; deleted); rwma-2 (donor-heart stress
echo S1, CC BY 2.0: 15-frame static quad-montage, no cardiac motion for a loop;
deleted); pda-2 (patent-ductus CT volume rendering, CC BY 3.0: CT, not
echocardiography; deleted); dcm-flow-1 (4D LV blood-flow S1, CC BY 2.0: 4D MRI
flow visualisation, not echo; deleted, DCM video still a gap); ph-1
(iloprost pulmonary-hypertension S1, CC BY 2.0: burnt-in patient name plus
hospital cardiology department; deleted, PH still a gap); pda-1, tof-1,
dissection-1 (Osmosis PDA/TOF/aortic-dissection videos, CC BY-SA 4.0: animated
whiteboard explainers, not real scans; deleted). Also dropped before download:
the already-hosted cor-pulmonale tamponade S1 (duplicate of an existing entry).

Per-clip removals (anatomy chamber/teaching labels kept throughout: LA/RA/IVC/
SVC/Ao on the TEE clip; RA/RV/LV/LA plus regurgitation annotation on the
subxiphoid clip): the four CardioNetworks-template clips (A5C, suprasternal,
tamponade-3) plus hcm-apical-2, asd-3, effusion-3 and tricuspid-regurgitation-1
lost date/time stamps, V markers, in-region depth numerals (found by tint
detection including pale glyphs), heart-rate/time readouts, color-scale numbers
(tamponade), bottom credit lines and ECHOPEDIA.ORG marks; psax-av-2 lost exam
date, FPS readout, V markers, depth numeral, color-scale numbers and time/HR;
psax-av-3 lost exam date and machine parameters, V marker, depth numerals, side
position arrow, color-scale bar edge and time/HR; tee-me-bicaval-1 lost two
probe-position dots (title cards excluded by trim); pocus-fast-subxiphoid-1 lost
video title, legend, side machine parameters, color-scale numbers, depth marker
and corner orientation marker; pocus-efast-lung-right-1 lost the orientation
graphic and side ticks by crop; tte-a4c-rv-focus-1 lost V marker, depth numeral
and time/HR. Fine depth-tick graphics along sector edges and ECG traces kept.

Updated counts (51 clips). Views: PLAX 3, PSAX AV 3 (1 still + 2 video), PSAX MV
0, PSAX papillary 1, PSAX apex 0, RV inflow 0, RVOT long axis 0, PA bifurcation
0, A4C 2, A5C 2, A2C 1, A3C 1, A4C RV focus 1, A4C coronary sinus 0, subcostal 4C
1, subcostal SAX 0, IVC 2, subcostal aorta 0, subcostal bicaval 0, suprasternal
arch 2, suprasternal descending SAX 0, suprasternal ductal 0, right parasternal
aorta 0, subcostal hepatic vein 0, suprasternal SVC 0; TEE: bicaval 1, all other
TEE views 0; POCUS: FAST subxiphoid 1, eFAST lung right 1, all other POCUS views
0. Pathology: MS 1, AS 1, MR 3, AR 2, TR 1, HCM obstructive 2, HCM
non-obstructive 2, DCM 1 (still only), LVH 0, effusion 3, tamponade 3,
RWMA-MI 1, ASD 3, VSD 3, PDA 0, TOF 0, pulmonary hypertension 0, LV thrombus 1,
vegetation 3, dissection 0.

Remaining gaps: PSAX MV video, PSAX apex video, RV inflow, RVOT long axis, PA
bifurcation, coronary sinus, subcostal SAX/aorta/bicaval/hepatic, suprasternal
descending-SAX/ductal/SVC, right parasternal aorta (no commercial-use video
found on Commons); TEE views other than bicaval; POCUS views other than
subxiphoid and one lung side; DCM video, LVH, pulmonary hypertension, PDA, TOF
and dissection (no compliant real-echo video found; PMC CC BY supplements are
the next place to look). Per-view target (2 per TTE view) now met for PLAX, A4C,
IVC, suprasternal arch, PSAX AV and A5C.

## WP12e expansion pass (2026-10-26)

Third sourcing sweep: Europe PMC open-access search (CC BY only, licence verified
two ways via search API plus full-text permissions block) plus further Commons
MediaWiki API keyword/category search, all licences re-verified via imageinfo
extmetadata immediately before download. 3 frames inspected per clip; PHI- or
facility-branded files deleted from work/clips/. Same de-identification and
H.264 MP4 spec as WP12b/c. 8 clips added (59 entries total, checkedAt
2026-10-26 for the new entries); outputs in work/clips-clean/ (8 mp4, ~0.9 MB).

Accepted (8): tte-psax-mv-1 (mitral-prolapse scallop S2, first PSAX-MV video;
numeric identifier in the top bar cropped out and flagged so the owner can
overrule), tte-psax-papillary-2 (pseudo-tamponade fat S2, second papillary
clip), tte-psax-av-4 (Gerbode 8-44 great-vessel short axis, fourth PSAX-AV
clip), tte-a4c-coronary-sinus-1 (E00713, described as A4CH dilated coronary
sinus, first coronary-sinus view clip), tte-suprasternal-arch-lax-3 (E00742 with
color Doppler, same suprasternal window as the arch series), tte-a4c-rv-focus-2
(PE right-heart S2, second RV-focus clip), pulmonary-hypertension-1 (CTEPH
speckle-tracking LV strain ring; not a TR-jet/septal view, filed as the first
PH clip with that caveat), tee-unspecified-gerbode-1 (Gerbode S4 color-Doppler
TEE 132 degrees, plane unspecified so filed without a view id like the
endocarditis TEE entry). Licences: CC BY-SA 3.0 (2), CC BY 2.0 (6).

Rejected (10): subc-2 (free-wall-rupture S1: Santa Cruz hospital + ID + date,
per precedent); tgsax-1 (Short axis anonymous: Memorial hospital + exam date +
patient temperature); imh-1 (intramural-hematoma TEE S1: CEMIC facility branding
in top bar, Argentine authors); ph-ilo2 (iloprost S2: same patient name +
hospital cardiology as rejected S1); stress-1/stress-2 (stress echo S1/S2:
apical Doppler, Takotsubo not confirmed, A4C already covered); a2c-2.jpg
(painted anatomy diagram, not a scan); a2c-3.png (scan-plus-diagram composite);
pda-pmc1 (PMC13676300 supplement: CT volume rendering, not echo). Also dropped
without download: already-hosted duplicate, Osmosis animations, canine still,
ND-licensed and unlicensed candidates. Skipped as redundant after inspection:
E00710 (PLAX plane) and E00715 (PSAX plane) coronary-sinus clips (no matching
view ids; E00713 matches the apical coronary-sinus view), E00743 suprasternal
(plain, redundant with the color-Doppler E00742).

Per-clip removals (teaching labels kept: color-flow jets and strain colors as
data; chamber/teaching labels where present): psax-mv-1 lost the full top bar
with numeric identifier, side parameters, color-scale numbers, orientation
marker and bottom time/heart-rate; papillary-2 lost date stamp, V marker,
numerals, heart rate and edge bar; av-4 lost right parameter column, bottom
mode/rate readouts, exam time and probe marker plus residual text found by
bright-pixel sweep (HD label, right-column tail); coronary-sinus-1 lost V
marker, numerals, heart rate, credit lines and mark; suprasternal-3 lost V
marker, numerals, color-scale numbers, heart rate, credit lines and mark;
rv-focus-2 lost V marker, numerals, heart rate and edge bar; PH-1 lost date
stamp, frame counter, strain-scale numbers and legends; Gerbode-TEE lost top
machine row (incl. probe temperature and multiplane angle), right parameter
column, color-scale numbers, probe marker, time, heart rate and bottom menu.
Right-edge tick graphics and ECG traces kept throughout.

Updated counts (59 clips). Views: PLAX 3, PSAX AV 4, PSAX MV 1, PSAX papillary 2,
PSAX apex 0, RV inflow 0, RVOT long axis 0, PA bifurcation 0, A4C 2, A5C 1,
A2C 1, A3C 1, A4C RV focus 2, A4C coronary sinus 1, subcostal 4C 1, subcostal SAX
0, IVC 2, subcostal aorta 0, subcostal bicaval 0, suprasternal arch 3,
suprasternal descending SAX 0, suprasternal ductal 0, right parasternal aorta 0,
subcostal hepatic vein 0, suprasternal SVC 0; TEE: bicaval 1, other TEE views 0
(plus one unassigned TEE clip); POCUS: FAST subxiphoid 1, eFAST lung right 1,
others 0. Pathology: MS 1, AS 1, MR 3, AR 2, TR 1, HCM obstructive 2, HCM
non-obstructive 2, DCM 1 (still only), LVH 0, effusion 3, tamponade 3,
RWMA-MI 1, ASD 3, VSD 3, PDA 0, TOF 0, pulmonary hypertension 1, LV thrombus 1,
vegetation 3, dissection 0.

Remaining gaps: PSAX apex, RV inflow, RVOT long axis, PA bifurcation, coronary
sinus-adjacent planes beyond A4CH, subcostal SAX/aorta/bicaval/hepatic,
suprasternal descending-SAX/ductal/SVC, right parasternal aorta (no compliant
video found on Commons); TEE views other than bicaval (TG short axis rejected
for hospital branding; only an unassigned Gerbode TEE added); POCUS other than
subxiphoid and one lung side (FAST RUQ/LUQ/pelvis, eFAST left, BLUE, arrest);
MS/AS/LV-thrombus/RWMA second clips; DCM video, LVH, PDA, TOF and dissection
(no compliant real-echo video found; PMC supplements checked were CT or
unlicensed). Per-view target (2 per TTE view) now met for PLAX, PSAX AV (4),
papillary, A4C, A5C, A2C, A3C, RV focus, IVC and suprasternal arch (3).

## WP12f expansion pass (2026-10-26)

Fourth sweep: three further CC BY 2.0 Commons videos (licences verified via
imageinfo extmetadata immediately before download), 3 frames inspected per
clip, no PHI or facility branding found. Same de-identification and H.264 MP4
spec as WP12b/c/e. 3 clips added (62 entries total, checkedAt 2026-10-26 for
the new entries); outputs in work/clips-clean/ (3 mp4, ~0.6 MB).

Accepted (3): tte-a3c-2 (stress-echo complications S7 apical long axis with
apical/posterior akinesia, second A3C clip), regional-wall-motion-abnormality-mi-2
(recurrent-thrombus case S2, persistent apical-anterior/anterior akinesis
post-STEMI, second RWMA-MI clip, plane unstated so filed without a view id),
lv-thrombus-2 (Takotsubo S2 mobile protrusive LV thrombus, second LV-thrombus
clip, plane unstated so filed without a view id). Licences: CC BY 2.0 (3).

Rejected (4, round-4 screening): stress-cx.ogv (same S-series, circumflex
territory, redundant with S7); radial-1.ogv (radial-strain tutorial render,
not raw cine); pulmvein-1.ogv (pulmonary-vein Doppler still composite);
surg-1.ogv (surgical photo, not echo). Also deleted for PHI: lvt-2.ogv (same
thrombus case S1, hospital branding burnt in, per precedent).

Per-clip removals (ECG traces kept throughout): a3c-2 lost left machine
column, right parameter column with depth numerals, bottom ECG-strip text
(mode/rate/time/REC), top-bar UI fragment and side marker (residual speck
found by bright-pixel sweep and zoom sign-off patched); rwma-mi-2 lost left
machine column, right parameter column with depth numerals and bottom strip
text; lv-thrombus-2 lost top machine row, side columns and bottom strip text
with date/time/heart-rate readouts.

Updated counts (62 clips). Views: PLAX 3, PSAX AV 4, PSAX MV 1, PSAX papillary 2,
PSAX apex 0, RV inflow 0, RVOT long axis 0, PA bifurcation 0, A4C 2, A5C 1,
A2C 1, A3C 2, A4C RV focus 2, A4C coronary sinus 1, subcostal 4C 1, subcostal SAX
0, IVC 2, subcostal aorta 0, subcostal bicaval 0, suprasternal arch 3,
suprasternal descending SAX 0, suprasternal ductal 0, right parasternal aorta 0,
subcostal hepatic vein 0, suprasternal SVC 0; TEE: bicaval 1, other TEE views 0
(plus one unassigned TEE clip); POCUS: FAST subxiphoid 1, eFAST lung right 1,
others 0. Pathology: MS 1, AS 1, MR 3, AR 2, TR 1, HCM obstructive 2, HCM
non-obstructive 2, DCM 1 (still only), LVH 0, effusion 3, tamponade 3,
RWMA-MI 2, ASD 3, VSD 3, PDA 0, TOF 0, pulmonary hypertension 1, LV thrombus 2,
vegetation 3, dissection 0.

Remaining gaps: PSAX apex, RV inflow, RVOT long axis, PA bifurcation,
subcostal SAX/aorta/bicaval/hepatic, suprasternal descending-SAX/ductal/SVC,
right parasternal aorta (no compliant video found on Commons); TEE views other
than bicaval; POCUS other than subxiphoid and one lung side; MS/AS second
clips; DCM video, LVH, PDA, TOF and dissection (no compliant real-echo video
found; PMC supplements checked were CT or unlicensed). Per-view target (2 per
TTE view) now met for PLAX, PSAX AV (4), papillary, A4C, A5C, A2C, A3C (2),
RV focus, IVC and suprasternal arch (3).

## WP12g expansion pass (2026-10-26)

Fifth sweep: six further CC BY 2.0 Commons videos (licences verified via
imageinfo extmetadata immediately before download; search was by missing-view
keywords), 3 frames inspected per clip, no PHI or facility branding found. Same
de-identification and H.264 MP4 spec as WP12b/c/e/f. 6 clips added (68 entries
total, checkedAt 2026-10-26 for the new entries); outputs in work/clips-clean/
(6 mp4, ~1.1 MB).

Accepted (6): tee-me-av-lax-1 (PDA-ligation S1, ME AV LAX with color Doppler,
first clip for that TEE view), tee-me-av-sax-1 (same case S2, ME AV SAX, first
clip for that TEE view), tee-me-2c-1 (accelerated-TOE-stress S1 rest 2 chamber,
first ME 2C clip), tee-unspecified-pfo-1 (cryptogenic-ischemia S1, PFO at 62
degrees, plane not a standard view id so filed without one like the Gerbode
TEE entries), tte-subcostal-4c-2 (RA myxoma S1 subcostal view, second
subcostal-4C clip), tte-subcostal-4c-3 (respiratory-maneuvers S5 subcostal 4
chamber with inspiration, third subcostal-4C clip; respiratory trace kept as
teaching signal). Licences: CC BY 2.0 (6).

Rejected: none downloaded beyond the six (all six accepted). Skipped as
redundant after inspection: respiratory S8/S9 (IVC in DCM, IVC view already
has 2), cryptogenic S2/S3 (bubble/ASD, no matching view id and ASD already
has 3).

Per-clip removals (color Doppler flow, ECG and respiratory traces kept
throughout): av-lax-1 lost top time stamp, left depth axis with numerals and
marker arrow, right angle dial and color-scale column; av-sax-1 lost the same
diagonal depth axis with numerals (2/4/6) and arrow plus right column (wide
pool-safe stairstep band over the sector edge); me-2c-1 lost top French machine
text, left numerals/ticks, V marker and bottom-right readout; pfo-1 lost exam
date row, angle-dial remnant, diagonal depth axis with numerals (5/10),
arrow, ticks and V marker (stairstep band verified zero-yellow across 3
frames); subcostal-4c-2 lost vendor/date top row (cropped), depth label, side
dots, grayscale bar, bottom-left preset text, caliper line with marker and top
marker dot; subcostal-4c-3 lost V marker, left numerals (10/20) with ticks and
grayscale bar. Two masking iterations were needed: a missing-colon filter typo
initially placed myxoma/resp boxes off-frame (caught by zoom sign-off and
redone), and the ligation/PFO diagonal axes required detection-guided
stairstep bands after visual estimates proved unreliable.

Updated counts (68 clips). Views: PLAX 3, PSAX AV 4, PSAX MV 1, PSAX papillary 2,
PSAX apex 0, RV inflow 0, RVOT long axis 0, PA bifurcation 0, A4C 2, A5C 1,
A2C 1, A3C 2, A4C RV focus 2, A4C coronary sinus 1, subcostal 4C 3, subcostal SAX
0, IVC 2, subcostal aorta 0, subcostal bicaval 0, suprasternal arch 3,
suprasternal descending SAX 0, suprasternal ductal 0, right parasternal aorta 0,
subcostal hepatic vein 0, suprasternal SVC 0; TEE: ME 4C 0, ME 2C 1, ME LAX 0,
bicaval 1, ME AV SAX 1, ME AV LAX 1, TG mid SAX 0, descending aorta SAX 0
(plus two unassigned TEE clips: Gerbode, PFO); POCUS: FAST subxiphoid 1,
eFAST lung right 1, others 0. Pathology: MS 1, AS 1, MR 3, AR 2, TR 1,
HCM obstructive 2, HCM non-obstructive 2, DCM 1 (still only), LVH 0, effusion 3,
tamponade 3, RWMA-MI 2, ASD 3, VSD 3, PDA 0, TOF 0, pulmonary hypertension 1,
LV thrombus 2, vegetation 3, dissection 0.

Remaining gaps: PSAX apex, RV inflow, RVOT long axis, PA bifurcation,
subcostal SAX/aorta/bicaval/hepatic, suprasternal descending-SAX/ductal/SVC,
right parasternal aorta (no compliant video found on Commons); TEE ME 4C, ME
LAX, TG mid SAX, descending-aorta SAX; POCUS other than subxiphoid and one lung
side; MS/AS second clips; DCM video, LVH, PDA, TOF and dissection (no compliant
real-echo video found; PMC supplements checked were CT or unlicensed).
Per-view target (2 per TTE view) now met for PLAX, PSAX AV (4), papillary,
A4C, A5C, A2C, A3C (2), RV focus, subcostal 4C (3), IVC and suprasternal
arch (3).

## WP12h expansion pass (2026-10-26)

Sixth sweep: missing-view keyword search (MS/AS, TEE 4C, FAST, DCM). 4 videos
downloaded, 3 accepted, 1 rejected (bicuspid GIF was a painted illustration,
not real echo, deleted). Licences verified via imageinfo extmetadata
immediately before download; 3 frames inspected per clip. 3 clips added
(71 entries total, checkedAt 2026-10-26 for the new entries); outputs in
work/clips-clean/ (3 mp4, ~0.25 MB).

Accepted (3): tee-me-4c-1 (giant atrial-myxoma f1, ME 4C TEE with mass
prolapsing through the mitral valve mimicking MS pathophysiology; first ME 4C
clip, filed under view only), aortic-stenosis-2 (exercise-stress S12, A4C in
symptomatic AS with SAM, trimmed to one beat at exercise heart rate; second AS
clip; hospital top bar with exam ID cropped out), pocus-fast-ruq-1 (positive
FAST hepatorenal fossa with free-fluid stripe; first FAST RUQ clip).
Licences: CC BY 3.0 (1), CC BY 2.0 (2).

Rejected (1): bicuspid.gif (Patrick Lynch painted anatomy diagram, not a
recorded scan).

Per-clip removals (Doppler/flow kept as data): me-4c-1 lost vendor/date top
bar (cropped), left params column, multiplane arc with angle numbers,
position-marker triangle, blue marker dot, top dot row, right dots column and
T mark (verified black by region means); as-2 lost hospital/date/ID top bar
(cropped deeper after first pass left text), right params column with numbers,
grayscale bar, corner markers and BPM readout; fast-ruq-1 needed only a top
machine-text strip mask (params column fell outside the crop).

Updated counts (71 clips). Views: PLAX 3, PSAX AV 4, PSAX MV 1, PSAX papillary 2,
PSAX apex 0, RV inflow 0, RVOT long axis 0, PA bifurcation 0, A4C 2, A5C 1,
A2C 1, A3C 2, A4C RV focus 2, A4C coronary sinus 1, subcostal 4C 3, subcostal SAX
0, IVC 2, subcostal aorta 0, subcostal bicaval 0, suprasternal arch 3,
suprasternal descending SAX 0, suprasternal ductal 0, right parasternal aorta 0,
subcostal hepatic vein 0, suprasternal SVC 0; TEE: ME 4C 1, ME 2C 1, ME LAX 0,
bicaval 1, ME AV SAX 1, ME AV LAX 1, TG mid SAX 0, descending aorta SAX 0
(plus two unassigned TEE clips: Gerbode, PFO); POCUS: FAST subxiphoid 1,
FAST RUQ 1, eFAST lung right 1, others 0. Pathology: MS 1, AS 2, MR 3, AR 2,
TR 1, HCM obstructive 2, HCM non-obstructive 2, DCM 1 (still only), LVH 0,
effusion 3, tamponade 3, RWMA-MI 2, ASD 3, VSD 3, PDA 0, TOF 0, pulmonary
hypertension 1, LV thrombus 2, vegetation 3, dissection 0.

Remaining gaps: PSAX apex, RV inflow, RVOT long axis, PA bifurcation,
subcostal SAX/aorta/bicaval/hepatic, suprasternal descending-SAX/ductal/SVC,
right parasternal aorta; TEE ME LAX, TG mid SAX, descending-aorta SAX; POCUS
FAST LUQ/pelvis, eFAST left, IVC, BLUE, arrest; MS second clip; DCM video,
LVH, PDA, TOF and dissection (no compliant real-echo video found; mouse-only
and CT/MRI/diagram candidates rejected). Per-view target (2 per TTE view) now
met for PLAX, PSAX AV (4), papillary, A4C, A5C, A2C, A3C (2), RV focus,
subcostal 4C (3), IVC and suprasternal arch (3).

## WP12i expansion pass (2026-10-26)

Seventh sweep: missing-view keywords (TEE TG, FAST splenorenal, lung, MS, LVH).
2 videos downloaded, both accepted, 1 illustration rejected (bicuspid GIF was
a painted anatomy diagram, not a real scan, deleted). Licences verified via
imageinfo extmetadata immediately before download; 3 frames inspected per
clip. 2 clips added (73 entries total, checkedAt 2026-10-26 for the new
entries); outputs in work/clips-clean/ (2 mp4, ~0.4 MB).

Accepted (2): lv-hypertrophy-1 (hypertensive contrast-stress S1, baseline
perfusion A4C with delayed septal enhancement; first LVH clip; hospital bar
cropped out), pocus-efast-lung-left-1 (bedside lung S7, pleural effusion with
expanding lung; laterality unstated so filed as the left-lung slot mirroring
the right-lung placeholder). Licences: CC BY 2.0 (2).

Rejected (1): bicuspid.gif (painted diagram, not a scan).

Per-clip removals (perfusion signal, ECG and position marker kept):
lvh-1 lost hospital top bar (cropped deeper after first pass left text), left
color bar with CPS legend, BASELINE label, position-marker arrows and top
marker square; sub-5px boundary ticks on bright contrast tissue left in place
by design (masking them would black out perfusion data; they carry no text or
identifiers); lung-left-1 lost top machine-text strip and right depth-tick
column.

Updated counts (73 clips). Views: PLAX 3, PSAX AV 4, PSAX MV 1, PSAX papillary 2,
PSAX apex 0, RV inflow 0, RVOT long axis 0, PA bifurcation 0, A4C 2, A5C 1,
A2C 1, A3C 2, A4C RV focus 2, A4C coronary sinus 1, subcostal 4C 3, subcostal SAX
0, IVC 2, subcostal aorta 0, subcostal bicaval 0, suprasternal arch 3,
suprasternal descending SAX 0, suprasternal ductal 0, right parasternal aorta 0,
subcostal hepatic vein 0, suprasternal SVC 0; TEE: ME 4C 1, ME 2C 1, ME LAX 0,
bicaval 1, ME AV SAX 1, ME AV LAX 1, TG mid SAX 0, descending aorta SAX 0
(plus two unassigned TEE clips: Gerbode, PFO); POCUS: FAST subxiphoid 1,
FAST RUQ 1, eFAST lung right 1, eFAST lung left 1, others 0. Pathology: MS 1,
AS 2, MR 3, AR 2, TR 1, HCM obstructive 2, HCM non-obstructive 2, DCM 1 (still
only), LVH 1, effusion 3, tamponade 3, RWMA-MI 2, ASD 3, VSD 3, PDA 0, TOF 0,
pulmonary hypertension 1, LV thrombus 2, vegetation 3, dissection 0.

Remaining gaps: PSAX apex, RV inflow, RVOT long axis, PA bifurcation,
subcostal SAX/aorta/bicaval/hepatic, suprasternal descending-SAX/ductal/SVC,
right parasternal aorta; TEE ME LAX, TG mid SAX, descending-aorta SAX; POCUS
FAST LUQ/pelvis, IVC, BLUE, arrest; MS second clip; DCM video, PDA, TOF and
dissection (no compliant real-echo video found; mouse-only, CT, MRI, diagram
and still-illustration candidates rejected). Per-view target (2 per TTE view)
now met for PLAX, PSAX AV (4), papillary, A4C, A5C, A2C, A3C (2), RV focus,
subcostal 4C (3), IVC and suprasternal arch (3).

## WP12j expansion pass (2026-10-26)

Eighth sweep: TEE category walk surfaced the rest/stress TOE series. 1 video
downloaded and accepted (tee-me-lax-1, TOE-stress S3 rest 3-chamber long axis
with aortic valve; first ME LAX clip; 74 entries total). Licence CC BY 2.0
verified via extmetadata; 3 frames inspected; no PHI. Per-clip removals: top
French machine text, left depth-axis ticks and letter markers, V marker and
bottom-right readout (diagonal tick band plus letter boxes; verified zero
static yellow/blue across 3 frames); ECG kept. Skipped as redundant: ligation
S3 (probe-transition sweep), TOE-stress S2 (2-chamber at 30 mg, view already
hosted), donor-heart s1/s2 (plane unnamed), PE/MI S1 (angiography, not echo),
PE/MI S2 (RPA thrombus TEE, 10 MB, no matching view id), PE-PFO S1 (plane
unnamed).

Updated counts (74 clips). Views: PLAX 3, PSAX AV 4, PSAX MV 1, PSAX papillary 2,
PSAX apex 0, RV inflow 0, RVOT long axis 0, PA bifurcation 0, A4C 2, A5C 1,
A2C 1, A3C 2, A4C RV focus 2, A4C coronary sinus 1, subcostal 4C 3, subcostal SAX
0, IVC 2, subcostal aorta 0, subcostal bicaval 0, suprasternal arch 3,
suprasternal descending SAX 0, suprasternal ductal 0, right parasternal aorta 0,
subcostal hepatic vein 0, suprasternal SVC 0; TEE: ME 4C 1, ME 2C 1, ME LAX 1,
bicaval 1, ME AV SAX 1, ME AV LAX 1, TG mid SAX 0, descending aorta SAX 0
(plus two unassigned TEE clips: Gerbode, PFO); POCUS: FAST subxiphoid 1,
FAST RUQ 1, eFAST lung right 1, eFAST lung left 1, others 0. Pathology: MS 1,
AS 2, MR 3, AR 2, TR 1, HCM obstructive 2, HCM non-obstructive 2, DCM 1 (still
only), LVH 1, effusion 3, tamponade 3, RWMA-MI 2, ASD 3, VSD 3, PDA 0, TOF 0,
pulmonary hypertension 1, LV thrombus 2, vegetation 3, dissection 0.

Remaining gaps: PSAX apex, RV inflow, RVOT long axis, PA bifurcation,
subcostal SAX/aorta/bicaval/hepatic, suprasternal descending-SAX/ductal/SVC,
right parasternal aorta; TEE TG mid SAX, descending-aorta SAX; POCUS FAST
LUQ/pelvis, IVC, BLUE, arrest; MS second clip; DCM video, PDA, TOF and
dissection.

## WP12k expansion pass (2026-10-26)

Ninth sweep: CardioNetworks view-targeted search surfaced suprasternal ductal
and descending-aorta clips. 2 videos downloaded, both accepted (PDA f1 was a
CT volume rendering and rejected in an earlier round; this E00643 is real echo
cine). Licences CC BY-SA 3.0 verified via extmetadata; 3 frames inspected;
no PHI. 2 clips added (76 entries total, checkedAt 2026-10-26 for the new
entries); outputs in work/clips-clean/ (2 mp4, ~0.1 MB).

Accepted (2): patent-ductus-arteriosus-1 (open ductus Botalli E00643,
suprasternal ductal color Doppler; first PDA clip AND first
suprasternal-ductal view clip), tte-suprasternal-desc-sax-1 (descending-aorta
stent E00717, suprasternal descending SAX; first view clip). Skipped:
suprasternal E00741 (plain, arch already has 3).

Per-clip removals (color Doppler flow and ECG with calipers kept): both lost
right color-scale column and credit line (cropped), V marker, left diagonal
depth axis with numerals (5/10) and marker arrow, corner time readouts.
Numeral positions were detection-placed after visual estimates proved
systematically ~35 px off; final sign-off on full frames.

Updated counts (76 clips). Views: PLAX 3, PSAX AV 4, PSAX MV 1, PSAX papillary 2,
PSAX apex 0, RV inflow 0, RVOT long axis 0, PA bifurcation 0, A4C 2, A5C 1,
A2C 1, A3C 2, A4C RV focus 2, A4C coronary sinus 1, subcostal 4C 3, subcostal SAX
0, IVC 2, subcostal aorta 0, subcostal bicaval 0, suprasternal arch 3,
suprasternal descending SAX 1, suprasternal ductal 1, right parasternal aorta 0,
subcostal hepatic vein 0, suprasternal SVC 0; TEE: ME 4C 1, ME 2C 1, ME LAX 1,
bicaval 1, ME AV SAX 1, ME AV LAX 1, TG mid SAX 0, descending aorta SAX 0
(plus two unassigned TEE clips: Gerbode, PFO); POCUS: FAST subxiphoid 1,
FAST RUQ 1, eFAST lung right 1, eFAST lung left 1, others 0. Pathology: MS 1,
AS 2, MR 3, AR 2, TR 1, HCM obstructive 2, HCM non-obstructive 2, DCM 1 (still
only), LVH 1, effusion 3, tamponade 3, RWMA-MI 2, ASD 3, VSD 3, PDA 1, TOF 0,
pulmonary hypertension 1, LV thrombus 2, vegetation 3, dissection 0.

Remaining gaps: PSAX apex, RV inflow, RVOT long axis, PA bifurcation,
subcostal SAX/aorta/bicaval/hepatic, suprasternal SVC, right parasternal
aorta; TEE TG mid SAX, descending-aorta SAX; POCUS FAST LUQ/pelvis, IVC, BLUE,
arrest; MS second clip; DCM video, TOF and dissection (no compliant real-echo
video found; CT/MRI/diagram/mouse candidates rejected). Per-view target (2 per
TTE view) now met for PLAX, PSAX AV (4), papillary, A4C, A5C, A2C, A3C (2),
RV focus, subcostal 4C (3), IVC, suprasternal arch (3), suprasternal descending
SAX (1) and suprasternal ductal (1). Per-view target (2 per TTE view) now met for PLAX, PSAX AV (4),
papillary, A4C, A5C, A2C, A3C (2), RV focus, subcostal 4C (3), IVC and
suprasternal arch (3).

## WP12l (2026-10-26): DCM video, MS-2, first dissection, subcostal aorta

Round 10 of the CardioNetworks sweep. All four sources CC BY-SA 3.0
(Smallbot uploads, Artist "CardioNetworks: Secretariat"), verified via
Commons extmetadata; full binaries re-downloaded and md5-matched against
the work/clips/ sources before filing. 3 frames inspected per clip, OUTPUT
re-extracted and inspected; no PHI (no names/IDs/DOB/hospital branding).
4 clips added (80 entries total, checkedAt 2026-10-26 for the new entries);
outputs in work/clips-clean/ (4 mp4, ~0.25 MB).

Accepted (4): dilated-cardiomyopathy-1 (DCM E00474, "PSAX: dilated poor left
ventricle"; PSAX papillary-muscle level, first DCM *video* — the catalogue
still entry remains), mitral-stenosis-2 (MS E00613, "A4CH with Color Doppler:
high velocity mitral inflow"; second MS clip, first at A4C),
aortic-dissection-1 ("30 Aortic dissection" E00245, "Subcostal view:
dissection flap in abdominal aorta"; first dissection clip in the library),
tte-subcostal-aorta-2 (mobile structure/thrombus E00721, "Subcostal view:
mobile structure (thrombus) in abdominal aorta"; aortic thrombus is not a
catalogue condition, filed view-only).

Per-clip removals (ECG trace with calipers and color Doppler flow kept):
all four lost the left depth axis with numerals (5/10/15/20), side/date/time
machine labels and CardioNetworks credit lines via detection-placed black
masks; the DCM mask nicks the sector periphery where overlay text overlapped
the sector edge. Numeral positions were component-placed after visual
estimates proved systematically off; final sign-off on full frames plus 2x
corner zooms. Bare depth-tick dashes (no numerals, no text) retained in all
four, disclosed here for owner overrule. Rejected this round: Osmosis
animations, CT/MRI/diagram/montage candidates, subcostal-4C dupes.

Updated counts (80 clips). Views: PLAX 3, PSAX AV 4, PSAX MV 1, PSAX papillary
3, PSAX apex 0, RV inflow 0, RVOT long axis 0, PA bifurcation 0, A4C 3, A5C 1,
A2C 1, A3C 2, A4C RV focus 2, A4C coronary sinus 1, subcostal 4C 3, subcostal
SAX 0, IVC 2, subcostal aorta 2, subcostal bicaval 0, suprasternal arch 3,
suprasternal descending SAX 1, suprasternal ductal 1, right parasternal aorta
0, subcostal hepatic vein 0, suprasternal SVC 0; TEE: ME 4C 1, ME 2C 1,
ME LAX 1, bicaval 1, ME AV SAX 1, ME AV LAX 1, TG mid SAX 0, descending aorta
SAX 0 (plus two unassigned TEE clips: Gerbode, PFO); POCUS: FAST subxiphoid
1, FAST RUQ 1, eFAST lung right 1, eFAST lung left 1, others 0. Pathology:
MS 2, AS 2, MR 3, AR 2, TR 1, HCM obstructive 2, HCM non-obstructive 2,
DCM 2 (1 still + 1 video), LVH 1, effusion 3, tamponade 3, RWMA-MI 2,
ASD 3, VSD 3, PDA 1, TOF 0, pulmonary hypertension 1, LV thrombus 2,
vegetation 3, dissection 1.

Remaining gaps: PSAX apex, RV inflow, RVOT long axis, PA bifurcation,
subcostal SAX/bicaval/hepatic, suprasternal SVC, right parasternal aorta;
TEE TG mid SAX, descending-aorta SAX; POCUS FAST LUQ/pelvis, IVC, BLUE,
arrest; TOF (no compliant real-echo video found). Per-view target (2 per
TTE view) now met for PLAX, PSAX AV (4), papillary (3), A4C (3), A5C, A2C,
A3C (2), RV focus, subcostal 4C (3), IVC, subcostal aorta (2), suprasternal
arch (3), suprasternal descending SAX (1) and suprasternal ductal (1).
