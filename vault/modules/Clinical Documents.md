---
tags: [module, opd, documents, clinical-content]
status: built 2026-09-25 (flag ON). Templates ai_drafted, translations machine_drafted, PENDING review.
flag: smd_clinical_docs (client, def:true, ?docs=0 hides the Home tile and the kit button)
---
# Clinical Documents

Printable documents a doctor writes every day, from the owner's ticked list (C1 to C5, B3):
medical leave and fitness certificates, referral letter, **consent forms** (8 templates in English,
Telugu and Hindi), **patient handouts** (every kit's advice text, in the three languages), **police
intimation for a medico-legal case**, **MCCD draft** (Form 4 / 4A, Part I (a) to (c)), and an
**I-PASS shift handover** sheet.

Opened from Home ("Documents" tile, defOn) or from a kit ("Certificate, referral letter, consent form
or handout for this patient"), where it is prefilled from the consult (`kitHost.consult()`: name, age,
sex, and the assessment values the form uses). Preview is an `iframe srcdoc`; Print/Share writes a
self-contained HTML file to the cache and opens the share sheet on native (Filesystem + Share), or the
print dialog on the web.

## Rules
- The doctor fills and signs; the app never signs. The footer names the template and its review state.
- **Reg. No. is printed only when the app has verified it** (`SMD_RX.verifiedInfo()`); otherwise a blank
  line for the doctor to write. Name, degree and speciality come from the account and the profile.
- **Nothing is stored.** Form values, the consult context and the handover list live in memory and are
  cleared on close. The handover (bed, severity, summary, actions, contingency) is never saved on the
  phone; the doctor shares or prints it before closing.
- Patient text is escaped everywhere (unit test injects an `<img onerror>`).
- MLC: an intimation letter to the SHO, not the MLC register entry. MCCD: a draft to copy onto the
  official form; it says so.

## Key files
- `clinical-docs.js` (`window.SMD_DOCS`: `open({type, ctx, consentId})`, `_bodyHtml`, `_documentHtml`),
  `clinical-docs.css` (#smdDocs z 12040: above the OPD EMR 12010, discharge 12020, MaiK 12030; below the
  Rx pad 16000; also styles [[Review Desk]]).
- `kb/documents/consent/<id>.json` (surgery-general, anaesthesia, caesarean-section, dental-extraction,
  cataract-surgery, endoscopy, blood-transfusion, hiv-test), `kb/documents/handouts-te.json`,
  `handouts-hi.json` (keys `<kitId>/<adviceId>`), bundled into `kb/documents/documents.json` by
  `scripts/build-documents.mjs` (schema + validator in its header; `--check`, `--validate`). The build
  syncs `DOCS_V` and the `clinical-docs.js?v=` token.
- Tests: `test/kit-tools-docs.test.mjs`, `test/run-specialty-kits-ui.mjs` (documents over the consult).

## Content status
- Consent templates cite the Samira Kohli judgment (2008), IMC Regulations 2002 (7.16), RCOG Consent
  Advice 14, RCoA leaflets, NHSBT, NACO 2024 and the HIV and AIDS Act 2017. Risk figures are mostly UK
  data and the forms say so; spinal headache rate, transfusion infection rates, dry socket and caesarean
  VTE rates were left out (no fetchable Indian source). NACO pages refused connections (read from search
  results).
- Telugu and Hindi are machine-drafted (`review.translation`): a native-speaker clinician must check
  them. The sheet says so on every non-English form. Handouts: 88 of 88 advice texts in each language;
  numbers kept as digits. Check first (translator's own list): `nephrology-urology/stone-prevention`
  (2 to 2.5 L is urine output, not intake), `cardiology/after-heart-attack` ("vanaspati" avoided: patients
  read it as Dalda), `neurology/headache-warning` and `palliative/when-to-call` (English is ambiguous;
  pick one reading, the second is the cord compression warning), `ent/nosebleed-first-aid` (15 minutes in
  total), `neurology/seizure-safety` (bucket baths), `nephrology-urology/urology-warning-signs` (fistula
  thrill, PD fluid, "bagal" avoided), `emergency/sepsis-warning-signs` ("pale"), `cardiology/heart-failure-self-care`
  (low sodium salt gloss), `community-medicine/anc-care` (a quarter more food), `forensic/cause-of-death-certificate`
  (official form names), and the narrower words chosen for ringworm, scabies, gout and anaesthetic.
- The handout list puts the kit the sheet was opened from first and has a search box; ticked items stay.

Deps: [[Specialty Kits]] · [[OPD Queue]] · [[Home Tools]] · [[Review Desk]].
