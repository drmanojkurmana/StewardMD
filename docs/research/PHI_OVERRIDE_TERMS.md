Draft v1 for counsel to settle

# Patient Identifier Override Terms (`rmd-phi-override-v1`)

Version: `rmd-phi-override-v1`
Scope: interactive `POST /v1/projects/{id}/ai-draft` requests only.
Status: not enabled in production. The override exists only while the Pages environment variable
`RESEARCH_PHI_OVERRIDE` is `"1"`, which is unset in production. Counsel must settle this text before the
switch is turned on. The governing statute is the Digital Personal Data Protection Act 2023 (DPDP Act).

The legal text below is reproduced verbatim from legal review F-03. It is legal copy, so the app's
no-em-dash rule does not apply to it. The em dashes are part of the approved wording and must not be
changed.

## Dialog title

> Before you send — patient information check

## Dialog body

> This text was flagged because it may contain patient identifiers (for example, a name, phone number, ID number, address or date). StewardMD blocks such text by default. You may send it for this one draft only if one of the following is true. Select which applies:

## Options (radio group, nothing preselected)

1. > This is a false positive — the flagged text does not identify any patient.
2. > The text has been anonymised — no patient can be identified from it, directly or in combination with other information.
3. > I have the patient's valid consent to share this text for this purpose, with institutional approval where required, and I can evidence it if asked.

Options that the server does not allow for the flagged categories are disabled, with a one-line reason.

## Confirmation

> By continuing, you confirm that the statement you selected is true; that you are the Data Fiduciary for this patient data (or are acting for the Data Fiduciary) and that this sharing is lawful under the Digital Personal Data Protection Act 2023, the IT Act 2000 and your institution's rules; and that only the text needed for this draft will be sent.

> The text will be sent to our AI providers — Runware and Google Vertex AI (Gemini) — whose servers may be outside India. StewardMD acts only as a Data Processor on your instructions. StewardMD logs this override (your user ID, the time, the type of identifier flagged and these terms version) but never the text itself. Always check AI output before use — it may be inaccurate, incomplete or biased.

## Note

> Note: overrides are not available for Aadhaar/ID numbers or phone numbers unless you have selected the third option (patient consent with institutional approval). If you are unsure, keep the block and remove the identifiers before drafting.

## Consent evidence fields

When the third option is selected, the dialog requires:

1. Date consent was given (a date, not in the future).
2. Consent reference (form number or where it is filed).

The reference is sent to the server for validation and is never logged.

## Server rules (legal review F-02)

1. `termsVersion` must be `rmd-phi-override-v1`. Version `rmd-phi-override-v0` is rejected.
2. `condition` must be one of `false_positive`, `anonymised` or `consent`. A missing or unknown
   condition is rejected and the request stays blocked.
3. High-risk categories (`aadhaar`, `abha`, `ssn`, `nhs`, `mrn` and `phone`) allow only the `consent`
   condition, with a `consentEvidence` object containing a valid past-or-today `consentDate` in
   `YYYY-MM-DD` form and a non-empty `reference` of 1 to 80 characters.
4. A `patient_name` hit is never overridable. A name together with clinical detail plainly identifies
   a patient.
5. Low-risk categories (`email`, `dob`, `address`, `dates`, `admission_date`) allow any of the three
   conditions.
6. A blocked 422 body reports `overridable: true|false` and `allowedConditions: [...]` (empty when not
   overridable). It never echoes the flagged text.
7. Only interactive `/ai-draft` honours the override. Jobs, PaperOrchestra, suggestions and every
   automated path ignore it.

## Audit record (legal review F-04)

Each accepted override writes one `ai_phi_override` row to `research_audit_events`. Its metadata is
exactly:

```
{ route, task, categories, termsVersion, condition, consentEvidenced, consentDate? }
```

- `consentDate` is present only when consent was evidenced, and holds only the date.
- The flagged text is never logged, cached or sent to analytics.
- The consent reference string is never logged or stored in the audit record.

Retention: `research_audit_events` is not purged by any code path (checked 2026-11-27). `ai_phi_override`
rows are retained for at least one year. If a purge or retention job is ever added, it must exempt
`ai_phi_override` rows until at least one year has passed.

## Data minimisation (legal review F-05)

The override resends only the same redacted `/ai-draft` input as the original request. It adds the
override object and no other data.