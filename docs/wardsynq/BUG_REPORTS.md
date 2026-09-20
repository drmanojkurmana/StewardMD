# WardSynQ Report Bug entries, 2026-09-13

37 entries from the in-app Report Bug button, filed against an older build and triaged on 2026-09-15 against
branch `bugfix-reports-0913` (from `wardsynq-product`). Referred to by id only; no patient details here.

Classes: **FIXED-ALREADY** (already right in the current code), **BUG** (wrong behaviour, fixed now), **UX**
(layout, wording or flow, changed now), **FEATURE** (new capability), **NEEDS-OWNER** (a clinical or product
decision; the question is stated).

Earlier commits cited: `84a5f176d` (bulk change for these reports, 2026-09-14), `f7fd8dac2` (its clinical-safety
and false-success regressions removed), `90a551839` (G13 keep scroll and focus).

Tests: `test/ward-bug-reports-0913.test.mjs` (unit, per id), `test/run-ward-bug-reports-0913-ui.mjs` (headless
Chrome), additions in `test/wardsynq-adt-bed-master.test.mjs` and `test/wardsynq-ed.test.mjs`.

| Id | Where | Class | Done (commit) or owner question |
|---|---|---|---|
| TEST-PIPELINE-01 | Admin / Test | not a report | Pipeline self-test entry. Nothing to do. |
| BUG-MU09NX9N-JJMQ | Lab board | BUG | `feeea6fa9`: an X-ray awaiting its report no longer gets Enter result among blood tests; imaging orders are listed apart with a link to the Radiology board. Premade templates (CBC, LFT, RFT, electrolytes, lipid, fever, PT/INR, ABG) already there (`84a5f176d`), naming tests only, never filling ranges. |
| BUG-MU09M56N-TOP1 | Lab board | BUG | `feeea6fa9`: tabs existed but Pathology and Microbiology hid the only list a culture or histopathology starts from; every tab now lists it with its own entry button. A failed read says so in its card. X-rays were already out of Awaiting collection. |
| BUG-MU09G6ID-OCM2 | Critical results / notes | NEEDS-OWNER | Note type exists; recipients are not notified (the screen says so). Question: should an instruction reuse the critical-result alert path (push to the on-duty nurse/resident/consultant of that ward, must be acknowledged, escalates if not), and may lab, pharmacy and billing receive clinical instructions at all? |
| BUG-MU09DOEX-I3GT | Critical results board | UX | `b02fd5954`: every result has Open chart, and the acknowledgement names the next step (note, order, reassess on the chart). Sending an instruction to the team is the OCM2 question. |
| BUG-MU097BLS-RVZ9 | Chart | NEEDS-OWNER | Wristband issue and bedside band check already exist (chart, Wristband; identity-tag.js). Questions: what goes in the QR (an opaque token, never the MRN in clear); should a scan in the StewardMD app open the WardSynQ chart; which sticker printers and NFC tag types; which label sizes for medication stickers. |
| BUG-MU094L5G-HO2V | Chart | NEEDS-OWNER | StewardMD's scheme package search (/api/schemes) exists and now accepts wardsynq.com (`99aa40522`). Question: where a chosen package code is recorded (the TPA pre-authorisation's treatment, or a claim code line), and which state's scheme list a hospital uses by default. |
| BUG-MU091LTG-5A0Q | Blood bank | NEEDS-OWNER | Urgency is already chosen on the request. The old auto-detected Hb/platelets banner invented units and was removed (`f7fd8dac2`). Question: may the request show the latest recorded Hb, platelets and blood group with their time and unit, and how old may a value be before it is not shown? |
| BUG-MU090GYQ-3O7Y | Blood bank | FIXED-ALREADY | Components include PRBC, whole blood, FFP, platelets, cryoprecipitate, granulocytes, other (`84a5f176d`); compatibility for an unmodelled component is refused, not assumed. |
| BUG-MU08YQ9A-A6EJ | Chart | FIXED-ALREADY | Chart, Radiology: reports per study and a launch link into the hospital's own DICOM viewer (owner answer S5, a plug for any DICOMweb/PACS). |
| BUG-MU08XZRV-6BS7 | Chart | FIXED-ALREADY | Chart, Cardiology: 2D echo, coronary angiogram and ECG reference entries, saved as real notes (`84a5f176d`, fixed to save honestly in `f7fd8dac2`). |
| BUG-MU08X4L2-2DD8 | Oncology | NEEDS-OWNER | Questions: which protocol source is authoritative in the ward (the ONCqis plan, or the protocol files StewardMD's OPD loads from kb/protocols); and what makes a patient an oncology patient for hiding the module (a C00-D49 problem, an oncology ward or department, or an ONCqis link). |
| BUG-MU08VUB6-XJUZ | Chart, Follow-up | NEEDS-OWNER | Question: should a WardSynQ follow-up request enrol the patient in FollowCare/MAiTRI (consent capture, which phone, who owns the enrolment), given FollowCare must never change prescriptions? Nothing claims an enrolment today. |
| BUG-MU08TSKI-NA5L | A card with no icons | NEEDS-OWNER | Not reproduced from the code: the only `d-card` is the discharge summary's, and discharge.css and the icon font have shipped with wardsynq.com since 2026-09-12; not checked on the live site. Question: which screen, and a screenshot. |
| BUG-MU08T4RL-GU0N | Chart, Transfer | BUG | `468533783`: the destination was typed beside a fixed list of department names, so a transfer could name a ward that does not exist. Transfer now opens the bed board: the hospital's real wards, each with its department, pick a free bed or move to a ward with no bed yet. |
| BUG-MU08OVM4-NH64 | A home card | NEEDS-OWNER | Question: which card, and what should the explanation cover? (No selector survived in the report.) |
| BUG-MU08NPGV-0MZX | Every text box | UX | `7d4c108cd`: voice typing buttons at the right edge inside every free-text box (on-device speech only, owner answer D1). Previously two boxes. |
| BUG-MU08MEQI-JZH1 | Timeline | BUG | Grouping existed (`84a5f176d`) but by substring, so a lab value such as Thrombocytes was filed as a vital sign. `9d6d4f074`: only the server's vital-sign names group. |
| BUG-MU08KBN9-4EML | Dashboard | NEEDS-OWNER | Question: which dashboard, and what looks unprofessional (spacing, density, the order of cards)? A screenshot marked up would settle it. |
| BUG-MU08J970-DOGM | Chart, notes | FIXED-ALREADY | Built-in note "Clinical assessment and admission": complaints, HPI, past history, medications and allergies, examination, assessment, plan (`84a5f176d`); opening it is one step now (`424f6c9e1`). |
| BUG-MU08HC82-82EQ | Problem certainty | FIXED-ALREADY | The certainty choices are statements (Provisional, Differential, Confirmed, Refuted), not a question. |
| BUG-MU08G0GA-VB5E | Inpatient home | FIXED-ALREADY | Tools left, patient list right on wide screens (`84a5f176d`); checked in headless Chrome in `7d4c108cd`. |
| BUG-MU08DSH6-N7FM | Bed board | BUG | `b02fd5954`: tapping an occupied bed did nothing (it called a route that does not exist); it now opens that patient's chart. Pictorial arrangement is a question: may the hospital draw each ward's room layout in Admin (bed positions per room), and who maintains it? |
| BUG-MU073XKT-7KZW | Inpatient home | UX | `7d4c108cd`: on a phone the patient list now comes before the tools. (The note also says tools right; the owner's G0GA said tools left, which is kept.) |
| BUG-MU072XAL-4EHO | Bed board | FEATURE | Server-backed add exists (Admin Center, Wards: POST /bed, staff.admin, audited). `516cca290`: the bed board links there; Admin Center gains Retire / Bring back into use (audited, history kept), refused for a bed with a patient in it. No browser-only bed list. |
| BUG-MU0710W4-04KD | Ward list | BUG | `d7d3f5e94`: Department filter from the ward's master data; the Ward and Stay selects closed themselves on tap and now apply; the search's "doctor" matched a field the list never had and is removed. Questions: floor is not in the ward master (add a floor field to wards?); filter by doctor needs the admitting doctor's name on the list (show it?). Admission date is covered by Stay. |
| BUG-MU06Z46U-DMDX | ED, Admit | BUG | `468533783`: the department was asked from a fixed 38-name list, shown as chosen and recorded nowhere. The department is now chosen on the bed board from the hospital's own departments (each ward's department). A department list "of everything" is the hospital's to maintain in Admin, Departments. |
| BUG-MU06X41N-V874 | Problem list, ICD code | BUG | The problem list already searched StewardMD's ICD list, but wardsynq.com was refused by the API and the refusal read as "No matching code". `99aa40522`: accepted, an unavailable search says so, typing in the code box searches too. |
| BUG-MU06OZMW-YWFH | ED board | FIXED-ALREADY | Scroll and focus kept after every action (G13, `90a551839`). |
| BUG-MU06NW2S-8D53 | ED board | BUG | `d6da89c80`: the bold sex read a field the ED list never sent, so it never showed. The list now sends name and recorded sex; unknown shows nothing. |
| BUG-MU06N5NW-3550 | Investigations | NEEDS-OWNER | No investigation master list exists in this repo to reuse. Questions: which list (LOINC order codes, the hospital's own tariff/test master, or a national list), is a custom test allowed when not found, and which imaging modality and body-part list (for example RadLex playbook or the hospital's own). |
| BUG-MU06I7WA-JUXY | ED | NEEDS-OWNER | Question: which ED card or step is confusing? |
| BUG-MU06HOBO-488C | Prescribing | BUG | `ac650861e`: the carrier and duration fields turned "3 hrs" into the frequency; now a real frequency is required and the route reads "IV infusion in 100 mL D25 over 3 hrs". Running drips are charted on Drips. Question: should an infusion be a structured order (carrier, volume, rate or duration) the Drips screen starts from, instead of route text? |
| BUG-MU06FU4H-JE2F | Fluid balance | FIXED-ALREADY | Output kinds include urine, drain, vomit, stool, blood loss (`84a5f176d`; the server accepts them). |
| BUG-MU06DWAT-VZ9C | ED chart | BUG | `424f6c9e1`: a note opens when chosen (no separate Open), and a note list that failed to load no longer hides the card. Vitals and the note were already first on an ED chart. |
| BUG-MU06CD49-YUKI | ED card | NEEDS-OWNER | Question: which card should move to the end? (No selector survived in the report.) |
| BUG-MU06BLM1-1T0P | ED arrival | FIXED-ALREADY | An unidentified arrival is filed as trauma only when Trauma arrival is ticked (`f7fd8dac2`); pinned again in `d6da89c80`. |

Counts: BUG 11, UX 3, FEATURE 1 (built), FIXED-ALREADY 9, NEEDS-OWNER 12, not a report 1.
