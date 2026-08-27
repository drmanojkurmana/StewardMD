# NMC PG Digital Logbook — requirement traceability

**Module:** NMC Logbook (`pglog`, flag family `smd_pglog`) · StewardMD
**Scope of this document:** Post-graduate (MD / MS / DM / M.Ch / PG Diploma) only. **UG / CBME is out of
scope and not built** — see [§9 Future UG compatibility](#9-future-ug-compatibility) for how the same
engine will carry it later.
**Written:** 2026-08-27. **Sources fetched:** 2026-08-27 (see [§10](#10-source-register)).

---

## 0. The rule this document exists to enforce

> **Nothing in the module claims an NMC requirement that is not quoted, with its clause, in this file.**

Every requirement below carries `source → clause → verbatim text`. Anything the code needs that the NMC
does **not** specify (a procedure target for a specialty whose curriculum gives no number, an
institutional attendance threshold, a per-department review SLA) is **configuration, not regulation** —
it is marked `CONFIG` and the UI labels it as institutional policy, never as an NMC rule.

**The module does not claim "NMC compliant."** It claims, and only claims:

- *"Structured to PGMER-2023 §5.2(v)–(vi)"* — for the weekly e-logbook + monthly guide authentication,
  because those clauses are quoted verbatim below and implemented literally.
- *"Curriculum pack: NMC <specialty> guidelines, <year>"* — per pack, with the PDF URL and the clause.

Certification of a logbook as acceptable to a University / examiner is **the institution's decision**,
not the software's. The module says so on the resident dashboard and on every exported report.

### Provenance grades used in the curriculum packs

| Grade | Meaning | Where it may appear |
|---|---|---|
| `nmc_regulation` | Quoted from PGMER-2023 (the gazette). | Requirements that apply to every specialty. |
| `nmc_curriculum` | Quoted from an NMC specialty curriculum PDF. | Per-specialty requirements + counts. |
| `institution` | Set by the institution's Academic Cell in-app. | Local targets, thresholds, SLAs. |
| `unspecified` | The NMC text mandates the activity but gives **no number**. | Target is `null`; UI shows a count, never a "x/y" bar. |

`unspecified` is the important one. Most NMC specialty curricula say *"a specified number of cases"* and
leave the number to the department. The module therefore **counts** those and never invents a target.

---

## 1. PGMER-2023 — the regulation that applies to every PG student

Source: **Post-Graduate Medical Education Regulations, 2023 ("PGMER-23")**, National Medical Commission,
Post-Graduate Medical Education Board. File No. N-P016(11)/2/2023-PGMEB-NMC. Gazette of India,
Extraordinary, Part-III, Section-4. Signed Dr Vijay Oza, President (PGMEB).
PDF: `https://www.nmc.org.in/MCIRest/open/getDocument?path=%2FDocuments%2FPublic%2FPortal%2FLatestNews%2FMER.pdf`

### 1.1 The e-logbook itself — §5.2(v)

> **(v)** Post-graduate students of broad and super specialty degree courses shall maintain a **dynamic
> e-log book which needs to be updated on weekly basis** about the work being carried out by them and the
> training programme undergone during the period of training. **MS/M.Ch students shall mandatorily enter
> details of surgical procedures assisted or done independently.**

| Digital feature | Field / mechanism | Evidence | Verification | Report |
|---|---|---|---|---|
| The logbook is the module. Entries are timestamped server-side. | `pg_entries` doc per activity; `createdAt`, `occurredAt`, `submittedAt` | attachments (optional) | faculty verify (§1.2) | Individual resident logbook |
| **Weekly update cadence is measured, not assumed** | `weeklyCadence()` in `pglog-model.js` → ISO-week buckets from `programme.startDate` to today; a week with zero submitted entries is a **gap** | — | — | Training progress report ("weeks logged N/M", gap list) |
| Surgical-procedure entry is **mandatory for MS / M.Ch** | `requiresProcedureLog(degree)` → true for `MS`, `MCh`; the procedure kind cannot be hidden and `role` is required on every procedure entry | — | — | Procedure/operation report |
| Resident role on a procedure | `role ∈ observed \| assisted \| performed_supervised \| performed_independent` — the two NMC-named states (`assisted`, `done independently`) plus the two the curricula use (`observed`, DOAP-supervised) | — | — | Procedure report groups by role |

**Note on `dynamic`:** the regulation's word. Implemented as: an entry can be edited by its author **while
`draft` or `returned`**, and every edit writes a revision; once `verified` the record is immutable (§1.9).

### 1.2 Faculty authentication — §5.2(vi)

> **(vi)** The record (Log) books shall be **checked, assessed and authenticated monthly by the
> postgraduate guide** imparting the training.

| Digital feature | Field / mechanism | Evidence | Verification | Report |
|---|---|---|---|---|
| Per-entry verification | `status: draft → submitted → verified \| returned`; `verifiedBy`, `verifiedAt`, server-stamped | — | faculty / guide only | every report shows the verified count |
| **Monthly guide authentication** — the clause's actual unit is the *month*, not the entry | `pg_attestations/{residentId__YYYY-MM}` — one signed monthly attestation per resident per calendar month, by the **guide**; lists the entry ids in scope + counts by kind | attestation snapshot | `attestedBy`, `attestedAt`, immutable | Individual resident logbook (monthly attestation ledger); Final PG training portfolio |
| Overdue detection | a month that closed >`CONFIG pglog.attestationGraceDays` (default 7) ago with no attestation → faculty dashboard "authentication overdue" | — | — | Faculty feedback report; Department summary |

This is the clause most digital logbooks implement as a per-entry tick and nothing else. The module
implements **both**: per-entry verification *and* the monthly attestation the clause actually names.

### 1.3 Teaching undergraduates — §5.2(vii)

> **(vii)** The post-graduate students shall be required to **participate in the teaching and training
> programme of undergraduate students and interns.**

→ Academic activity type `ug_teaching`. Present in **every** curriculum pack (it is a regulation, not a
specialty rule). Target: `unspecified` unless the specialty curriculum gives one.

### 1.4 Academic activity types — §5.2(x)

> **(x)** Post-graduate training shall consists of training of the students through **lectures, seminars,
> journal clubs, group discussions, participation in laboratory and experimental work, involvement in
> research, clinical meetings, grand rounds, clinico-pathological conferences**, practical training in
> diagnosis and medical and surgical treatment, training in the basic medical sciences as well as in
> allied clinical specialties, etc. as per the requirement of speciality training.
>
> Specialities where patient treatment is involved the teaching and training of the students shall
> include **graded responsibility** in the management and treatment of patients entrusted to their care.
>
> A post-graduate student of a degree course in broad specialties/super specialties **would be required to
> present one poster presentation or to read one paper at a national/Zonal/state conference of the
> respective specialty or to have one research paper published/accepted for publication as the first
> author** in the journal of the respective specialty to make him eligible to appear in the post-graduate
> degree examination.

| Requirement | Digital feature |
|---|---|
| The nine named activity types | `ACADEMIC_TYPES` in `pglog-model.js` — exactly these, plus `ug_teaching` (§1.3), `cme_conference`, `symposium`, `mortality_morbidity`, `case_presentation`, `thesis_presentation` (all curriculum-sourced, see §2) |
| **Graded responsibility** | the `role` ladder on clinical + procedure entries (observed → assisted → supervised → independent) and the progress view's "role mix over time" |
| **Exam-eligibility disjunction** (poster **or** paper read **or** first-author publication) | `examEligibility()` in `pglog-model.js` — evaluated as a real OR over `research` entries of subtype `poster` / `conference_paper` / `publication(firstAuthor:true)`. Shown as a single "Exam eligibility" checklist row with which of the three satisfied it. **Not** three separate targets. |

⚠ **Deliberate conflict handling:** several specialty curricula demand *more* than §5.2(x) (e.g. MD General
Medicine: *"At least two presentations at national level conference. One research paper should be
published / accepted in an indexed journal"*). The engine evaluates **both** and reports them separately —
the regulation's floor (`nmc_regulation`) and the specialty's requirement (`nmc_curriculum`). It never
silently replaces one with the other, and it never averages them.

### 1.5 Common mandatory course work — §5.2(xi)

> **(xi) Common Course work** — The following course work shall be common and mandatory for all broad and
> super specialty post-graduate students irrespective of the specialty.
>
> **(a) Course in Research Methodology** — i. All post-graduate students shall complete an online course in
> Research Methodology. … iii. The students shall **complete the course in the first year**. iv. The online
> certificate generated on successful completion … will be acceptable evidence. v. The above certification
> shall be a **mandatory requirement to be eligible to appear for the final examination**.
>
> **(b) Course in Ethics** — i. All post-graduate students shall complete course in Ethics including Good
> Clinical Practices and Good Laboratory Practices … ii. **first year**. iii. **No post-graduate student
> shall be permitted to appear in the examination without completing the above course.**
>
> **(c) Course in Cardiac Life Support Skills** — i. All post-graduate students shall complete a course in
> **Basic Cardiac Life Support (BCLS) and Advanced Cardiac Life Support (ACLS)** … ii. **first year**.
> iii. No post-graduate student shall be permitted to appear in the examination without the above
> certification.

| Digital feature | Field | Evidence | Verification | Report |
|---|---|---|---|---|
| Three `certification` requirements, `mandatoryForExam: true`, `dueBy: {year: 1}` | `pg_entries` kind `certification`, `subtype ∈ research_methodology \| ethics_gcp_glp \| bcls_acls` | **certificate attachment required** (the clause names the certificate as the evidence) | faculty verify | Exam-eligibility block on every progress report + the final portfolio |
| First-year deadline is enforced as a **warning, not a block** | `dueAt = programme.startDate + 12 months`; overdue → resident "Outstanding actions" + faculty "requires intervention" | — | — | Training progress report |

### 1.6 Attendance — §5.6

> **5.6 LEAVE RULES** … a. Every post-graduate student will be given **minimum 20 days of paid leave per
> year**. b. Subject to exigencies of work, post-graduate students will be **allowed one weekly holiday**
> … e. In addition to minimum 20 days' paid leave, the candidates will be allowed **academic paid leave of
> 5 days per year** … If a candidate avails leave in excess than the permitted number of days, his/her term
> of course shall be extended by the same number of days … However, one shall be able to **appear in the
> examination if one has 80% (eighty percent) of the attendance.**

**PGMEB FAQ clarification (10 April 2024)** quantifies it: *80% attendance = **751 days for a three-year
course** and **501 days for a two-year course***.

| Digital feature | Field | Notes |
|---|---|---|
| `attendance` entry kind: `present \| leave_paid \| leave_academic \| leave_maternity \| leave_paternity \| absent` | one row per day, or a date-range that expands | The module **records**; it does not adjudicate leave. |
| `attendanceSummary()` → days present, leave by type, % against course days | `pglog-model.js`, pure + unit-tested | |
| **80%** threshold, and the 751/501-day figures | `CONFIG` **seeded from** PGMER §5.6 + the FAQ, flagged `nmc_regulation` for the 80% and `nmc_faq` for the day counts, editable by the Academic Cell | The regulation states the **percentage**; the day counts come from the FAQ, which is a clarification, not the gazette. They are stored with **different provenance grades** and the UI shows which. |
| Leave allowances (20 + 5 days/yr) | shown as institutional counters against §5.6 | The module never blocks a leave entry. |

⚠ **This is the requirement most easily got wrong.** The regulation gives a *percentage of attendance*;
the FAQ gives *days*. Neither says what counts as an attended day, and institutions differ. The module
therefore computes **both** views (percentage of elapsed course days, and absolute days present) and
labels the threshold's source. It does **not** declare a resident exam-ineligible on attendance — it
surfaces the number and says whose rule it is.

### 1.7 Academic Cell — §5.2(iii)

> **(iii)** Every institution undertaking post-graduate training programme shall set up an **Academic
> Cell**, under the chairmanship of a senior faculty member, which shall **ensure and monitor the
> implementation of training programmes** in each specialities.

→ The `academic_cell` role (§7) and the institution-wide oversight dashboard exist because of this clause.
Its capabilities — curriculum configuration, institution-wide progress, audit access — are the clause's
"ensure and monitor", not an invented admin tier.

### 1.8 District Residency Programme — §5.2(xii)

> **V.** All post-graduate students pursuing MD/MS in broad specialties … shall undergo a **compulsory
> residential rotation of three months in District Hospitals/District Health System** … Such rotation shall
> take place in the **3rd or 4th or 5th semester** …
>
> **VIII.(a)** Quality of training shall be **monitored by log books**, supportive supervision and
> continuous assessment of performance. The attendance and performance of District Residents shall be
> tracked by the **District Residency Programme Coordinator (DRPC)** … through an appropriate
> **electronic/digital or mobile enabled system.**
>
> **VIII.(c)** Satisfactory completion of the District Residency shall be an **essential condition before
> the candidate is allowed to appear in the final examination.**

| Digital feature | Field |
|---|---|
| DRP is a **first-class rotation type**, not a free-text posting | `pg_rotations.kind = "drp"`, `externalSite` (district hospital name), `coordinator` (DRPC identity), `durationMonths` default 3 |
| Semester window check | `drpWindowOk(rotation, programme)` → semester 3/4/5; outside the window → a **warning on the rotation**, attributed to §5.2(xii)V (not a hard block — a State posting schedule is not the resident's to fix) |
| DRPC verification | the DRPC is a `pg_faculty` membership scoped to that rotation; their verification is what makes DRP entries count |
| Exam-eligibility row | `drpComplete` in `examEligibility()`, source `nmc_regulation` |

The module is exactly the "electronic/digital or mobile enabled system" VIII(a) asks for, for the
**parent college** side. It does not claim to be the State's tracking system.

### 1.9 Records, audit and the reason immutability is mandatory — §6.2, §9.2(c)

> **6.2** … the concerned University and medical institutions under them shall ensure that **proper records
> of the work be maintained so that they form the basis of objective, efficient and transparent internal
> assessment** of scholars. Provided further that, these maintained and well-classified documents shall be
> **made available for consultation at all times**, particularly for the purposes of assessment …

> **9.2(c)** monetary penalty not exceeding Rupees five lakhs for the faculty/Head of the Department
> (HoD)/Dean/Director/Doctor **submitting false declaration/documents/records (including patients'
> records).** Further, they can also be charged or penalized for misconduct …

**This is why the audit trail is not a nice-to-have.** A verified logbook record is a document whose
falsification carries a statutory penalty for a named person. The module therefore guarantees:

| Guarantee | Mechanism |
|---|---|
| A verified record is **never silently overwritten or deleted** | `pglog-model.applyEdit()` **throws** on any edit to a `verified` entry. Correction goes through `amend()`, which creates a **new revision** and re-opens verification, keeping the verified original in `revisions[]` intact. |
| Every state change is attributable | `history[]`: `{at, by, action, from, to, reason}` — append-only, server-stamped `at`, never client-supplied |
| Deletion is soft only | `deleted:true` + `deletedBy/At/Reason`; a **verified** entry cannot be deleted at all, only amended |
| A return needs a reason | `return` without a non-empty `reason` throws at the model layer (not just the UI) |
| Server time is authoritative | every `*At` is stamped in the Function; a client-supplied timestamp is ignored except `occurredAt` (when the work happened), which is validated to be ≤ now and ≥ programme start |
| Cross-checkable | `q_events` audit rows via the existing `qAudit()`, PHI-free |

### 1.10 Assessment — Chapter VI §6.1(e), Chapter VIII §8.1

> **6.1(e)** provide a **combination of both formative and summative assessment** for overall successful
> completion of the Post-graduate programme.

> **8.1** The medical college/institute will conduct the **Formative Assessment** (examination) and the
> University will conduct the **Summative Assessment** (examination).

→ The module implements **formative assessment only** — the college side. It has no summative/university
examination surface, does not compute or store examination marks, and says so. `pg_assessments` records
faculty formative assessments against configurable templates (§2.4).

### 1.11 What PGMER-2023 does **not** say (and the module therefore does not claim)

- **No procedure counts.** PGMER-2023 contains no procedure-number requirement for any specialty. Counts
  in the module come from specialty curricula only (§2), or are `unspecified`.
- **No "5.3 THESIS" clause.** The gazette PDF numbering runs 5.2 → 5.4; thesis provisions live in
  §2.2(iii) ("Writing thesis" as a curriculum component), §8.1 (5% of practical marks), and the
  specialty curricula. A published review (Chaudhari *et al.*, *Indian J Psychol Med*, PMC12054657) is
  literally titled *"Confusion Surrounding the Mandatory Requirement of Thesis Submission"* over this.
  **The module does not present a "PGMER §5.3" thesis clause, because there isn't one.** Thesis milestones
  are `nmc_curriculum` + `CONFIG`.
- **No logbook field schema.** NMC prescribes *that* a logbook exists and *what it records* — never a
  column list. The field sets in §3 come from the specialty curricula's own tables (notably MD Emergency
  Medicine 2024, which prints its logbook tables) and are otherwise `CONFIG`.
- **No verification SLA.** "Monthly" (§5.2(vi)) is the only cadence NMC gives. Any "verify within N days"
  is `CONFIG`.

---

## 2. Specialty curricula — where the specialty-specific requirements come from

15 packs shipped, each built **only** from its own NMC PDF. Pack format:
`pglog/curricula/<id>.json`, index at `pglog/curricula/index.json`.

### 2.1 The curriculum text that is common to the modern (2022-revised) curricula

MD General Medicine (revised 2022), MS Orthopaedics (revised), MD Paediatrics (revised), MD Pathology
(revised) all carry the same **Log book §J**:

> **J. Log book** — During the training period, the postgraduate student should maintain a Log Book
> indicating the **duration of the postings/work done in Wards, OPDs, Casualty and other areas of
> posting**. This should indicate the **procedures assisted and performed and the teaching sessions
> attended**. The **log book entries must be done in real time.** The log book is thus a record of various
> activities by the student like: (1) Participation & performance, (2) attendance, (3) participation in
> sessions, (4) completion of pre-determined activities, and (5) **acquisition of selected competencies**.
>
> The purpose of the Log Book is to: a) help maintain a record of the work done during training, b) enable
> Faculty/Consultants to have **direct information about the work done and intervene, if necessary**,
> c) provide **feedback and assess the progress of learning** with experience gained periodically,
> d) Documentation of acquisition required competencies.
>
> The Log Book should be **used in the internal assessment** of the student; should be **checked and
> assessed periodically by the faculty members** imparting the training. The PG students will be required
> to **produce completed log book in original at the time of final practical examination. It should be
> signed by the Head of the Department.** A **proficiency certificate from the Head of Department**
> regarding the clinical competence and skillful performance of procedures by the student will be
> submitted by the PG student at the time of the examination.
>
> The PG students shall be **trained to reflect and record their reflections in log book particularly of
> the critical incidents.** Components of good teaching practices must be assessed in all academic activity
> conducted by the PG student and **at least two sessions dedicated for assessment of teaching skills must
> be conducted every year** of the PG program.

Every sentence of that maps to something:

| Curriculum sentence | Digital feature |
|---|---|
| duration of postings in Wards / OPDs / Casualty / other | rotations (§1.8 shape) + the three clinical entry kinds `opd` / `ipd` / `emergency` |
| procedures assisted and performed | procedure entries with the role ladder |
| teaching sessions attended | academic entries, `role: attended` vs `presented` |
| **real time** | `occurredAt` vs `createdAt` are separate fields; a `latencyDays` is computed and shown on the entry and in the progress report. Late logging is **visible**, not blocked. |
| (5) acquisition of selected competencies | `requirementIds[]` on every entry — the competency/requirement link |
| enable faculty to **intervene, if necessary** | faculty dashboard "residents falling behind" + "requires remediation" |
| **HoD signature** on the completed log book | `pg_attestations` kind `hod_final`, distinct from the monthly guide attestation |
| **proficiency certificate from HoD** | `pg_attestations` kind `hod_proficiency`, generated from the procedure report, HoD-signed |
| **reflections, particularly critical incidents** | entry kind `reflection`, subtype `critical_incident` — a first-class kind, not a notes field |
| **two teaching-skill assessments every year** | requirement `teaching_skill_assessment`, target **2 per year**, `nmc_curriculum` |

### 2.2 Formative-assessment cadence — MD General Medicine, *Assessment*

> Quarterly assessment during the MD training should be based on: **Case presentation, case work up, case
> handling/management : once a week · Laboratory performance : twice a week · Journal club : once a week ·
> Seminar : once a fortnight · Case discussions : once a fortnight/month · Interdepartmental case or
> seminar : once a month** … **Attendance at Scientific meetings, CME programmes (at least 02 each)**

and *Teaching and learning methods*: **Lectures** *"A minimum of 10 lectures per year"* · **Journal club**
*"Minimum of once in 1-2 weeks"* · **Student Seminar** *"Minimum of once every 1-2 weeks"* · **Student
Symposium** *"Minimum of once every 3 months"* · **Bedside clinics** *"Minimum - once every 1-2 weeks"* ·
**Interdepartmental colloquium** *"monthly"*.

These become **cadence requirements** (`per: "week" | "fortnight" | "month" | "quarter" | "year"`), not
absolute totals — because that is how the curriculum states them. The progress engine converts a cadence
to an expected-to-date count using elapsed programme time, and shows *"expected ~N by now"*, never a hard
denominator for the whole course.

MS Orthopaedics states its quarterly assessment as **counts** instead:
> Mini Cex encounter – **at least 4** · Clinical encounter cards - at least **4** · Direct observation of
> procedural skills – **at least 6** including Cadaver dissection

→ absolute per-quarter targets in the orthopaedics pack.

### 2.3 Procedure counts — the one specialty where NMC prints numbers

**MD Emergency Medicine (NMC, 2024)**, *Procedural skills: (Minimum number of procedures that a candidate
needs to perform are:)* — 100+ named procedures with explicit minima. Shipped verbatim in
`pglog/curricula/emergency-medicine.json`, e.g.:

| Procedure | Min |
|---|---|
| Basic airway management (opening airway by various methods) | 100 |
| Bag mask ventilation | 100 |
| Advanced airway management | 25 |
| Tracheal intubation | 100 |
| Paediatric airway management | 25 |
| Neonatal airway management | 5 |
| CPR — Basic / Advanced | 50 / 50 |
| Cardioversion / defibrillation | 40 |
| ECG interpretation | 250 |
| Ventilator management | 100 |
| Intercostal chest tube | 10 |
| ED thoracotomy | 1 |
| Central venous access | 25 |
| FAST / E-FAST | 50 |
| … (full list in the pack, each with `source: nmc_curriculum`, clause `Procedural skills`) | |

**Every other specialty pack ships its procedure list with `target: null` (`unspecified`)** unless its own
PDF gives a number. MS General Surgery, for instance, says only:

> **3. Log book:** Each student must be asked to present a **specified number** of cases for clinical
> discussion, perform procedures/tests/operations/present seminars/review articles … They should be
> entered in a Log Book.

*"a specified number"* — specified by the department. So the surgery pack's procedure requirements count
and do not target, and the Academic Cell can set institutional targets (which then display as
`institution`, in a visibly different style from `nmc_curriculum`).

### 2.4 Assessment templates — from the curricula, not invented

**MD Emergency Medicine 2024** prints three assessment proformas and a 0–5 anchored scale. Shipped as
`pglog/assessment-templates.json`:

| Template | Source | Criteria | Scale |
|---|---|---|---|
| `dops` — Directly Observed Procedural Skills | MD Emergency Medicine 2024, Annexure I | Technical Skill · Indications and Contraindications · Informed Consent · Preparation and planning · Situational Awareness · Prevention and Management of Complications · Post Procedure Management · Discharge Advice to Patient/Carers | 0–5, **8 × 5 = 40** + Logbook **10** = **50** |
| `wpba_shift` — Workplace Based Observation, Shift Based | ibid., Annexure II | Medical Expertise · Prioritisation and Decision Making · Communication · Leadership and Management · Scholarship and Teaching · Health Advocacy · Professionalism | 0–5, **7 × 5 = 35** + Logbook **15** = **50** |
| `wpba_clinical` — Workplace Based Observation, Clinical Skills | ibid., Annexure III | History Taking · Physical Examination · Clinical Synthesis · Shared Decision Making · Communication · Professionalism · Organisation and Efficiency | 0–5, **7 × 5 = 35** + Logbook **5** = **40** |
| `appraisal` — PG student appraisal form | MD General Medicine (revised 2022), Annexure 1 | 1 Scholastic Aptitude and Learning (1.1–1.6) · 2 Care of the patient (2.1–2.6) · 3 Professional attributes (3.1–3.3) · 4 additional comments · 5 Disposition | 1–9 banded *Less than Satisfactory (1-3) / Satisfactory (4-6) / More than satisfactory (7-9)*, plus **"Has this assessment been discussed with the trainee? Yes/No"** |

The 0–5 anchors are the curriculum's own words and ship verbatim:

> **0** Trainee did not perform · **1** Trainee performed; senior clinician input required for majority of
> shift · **2** … input required for minority of shift · **3** performed independently; senior clinician
> observed and advised for trouble shooting · **4** performed independently; senior clinician required to
> check · **5** performed independently at Senior resident level

The **appraisal form's "discussed with the trainee? Yes/No"** is implemented as a required field on that
template — because an assessment the trainee never saw is not feedback.

### 2.5 The 15 packs shipped

| Pack id | Degree | NMC source PDF (year) | Counts? |
|---|---|---|---|
| `general-medicine` | MD | MD in General Medicine (revised) 2022 | cadences; no procedure counts |
| `general-surgery` | MS | MS Surgery 2019 | none — "a specified number" |
| `obstetrics-gynaecology` | MS | MS OBGY 2019 | none |
| `paediatrics` | MD | MD Paediatrics (revised) 2022 | cadences |
| `anaesthesiology` | MD | MD Anaesthesia 2019 | none |
| `orthopaedics` | MS | MS Orthopedics (revised) 2022 | per-quarter counts (Mini-CEX 4, encounter cards 4, DOPS 6) |
| `radiodiagnosis` | MD | MD Radiodiagnosis 2019 | none |
| `pathology` | MD | MD Pathology (revised) 2022 | cadences |
| `psychiatry` | MD | MD Psychiatry (revised) 2022 | none |
| `dermatology` | MD | MD Dermatology 2019 | **5 case presentations/year**; JC presentation **4×/year** |
| `ophthalmology` | MS | MS Ophthalmology 2019 | none |
| `ent` | MS | MS ENT 2019 | none |
| `community-medicine` | MD | MD Community Medicine 2019 | none |
| `emergency-medicine` | MD | MD Emergency Medicine 2024 | **full procedure minima + rotation schedule** |
| `respiratory-medicine` | MD | MD Pulmonary Medicine 2019 | none |

Adding a 16th specialty is a JSON file. No code change.

---

## 3. Field-level mapping — the brief's sections → what was built

The brief (§5–§8) lists fields. Where NMC names the field, it is cited; where it does not, it is `CONFIG`
and marked so.

### 3.1 Clinical — OPD / IPD / Emergency

Single entry kind `clinical`, `setting ∈ opd | ipd | emergency`. Shared fields, then setting-specific ones.

| Brief field | Implemented as | Source |
|---|---|---|
| Date | `occurredAt` (date) | curriculum §J "real time" |
| Department / unit | `departmentId`, `unit` — from the resident's current rotation, **prefilled** | §J "areas of posting" |
| Clinical activity / Case / problem | `title` + `category` | `CONFIG` |
| Diagnosis / category | `diagnosis` — **free text or an ICD-style pick from the existing StewardMD KB** (`kb-loader.js` disease index) | `CONFIG`; reuses existing infra |
| Resident role | `role` ladder | §5.2(x) graded responsibility |
| Relevant competency / activity | `requirementIds[]` | §J (5) "acquisition of selected competencies" |
| Faculty / supervisor | `supervisor` (identity) | §5.2(vi) |
| Remarks | `remarks` | `CONFIG` |
| Verification status | `status` + audit | §5.2(vi) |
| *(IPD)* clinical decisions / work performed | `work[]` free-text lines | `CONFIG` |
| *(IPD)* procedures | **linked** procedure entries, not duplicated fields | design |
| *(Emergency)* intervention / procedure | same link | design |
| Outcome | `outcome ∈ improved \| unchanged \| worsened \| referred \| died \| unknown` | `CONFIG` |

### 3.2 Procedures and operations

| Brief field | Implemented as | Source |
|---|---|---|
| Date | `occurredAt` | §5.2(v) |
| Specialty / department | `departmentId` / programme specialty | — |
| Procedure / operation | `procedureId` (from the curriculum pack) **or** `procedureText` free text — a resident is never blocked by a pack that lacks their procedure | design |
| Patient / hospital reference | `caseRef` — **MRN-style reference only**, see §5 | §5 privacy |
| Resident role (4 levels) | `role` | §5.2(v) "assisted or done independently" + DOAP |
| Faculty / supervisor | `supervisor` | §5.2(vi) |
| Outcome | `outcome` | `CONFIG` |
| Complications | `complications[]` + `complicationNotes` | `CONFIG` |
| Competency / training requirement | `requirementIds[]` | §J(5) |
| Assessment | linked `pg_assessments` (DOPS) | §2.4 |
| Feedback | on the assessment | §J(c) |
| Verification | `status` | §5.2(vi) |
| Audit history | `history[]` + `revisions[]` | §6.2, §9.2(c) |
| Column set matches NMC's own table | *Date · Procedure · Number assisted · Number performed · Comments · Faculty signature with date* | **MD Emergency Medicine 2024, "Total procedures (consolidated)"** — the procedure report renders exactly these columns |

Note: the NMC table is a *consolidated* count row. The module stores **one entry per procedure event**
(which is what "real time" requires) and **renders** the consolidated table from them.

### 3.3 Academic activities

Columns from **MD Emergency Medicine 2024, "Academic activities (consolidated…)"**:
*S.No · Date · Academic activity · Place · Comments · Faculty signature* — plus the activity types it
names: *Journal Club Presentation performance · Thesis review Presentation & performance · Seminar
Presentation · Presentation in conferences & CME · Publications & Posters · Mortality & Morbidity audit*.

`scope ∈ within_department | peripheral_posting | outside_department | outside_institution` — also that
document's own parenthetical.

### 3.4 Research / thesis

PGMER-2023 §2.2(iii) makes thesis a curriculum component; §8.1 gives it 5% of practical marks; the
curricula give the milestones. Milestones are therefore **a configurable ordered list**, seeded from
MD General Medicine's own statement:

> Thesis shall be **submitted at least six months before** the Theory and Clinical / Practical
> examination. The thesis shall be examined by a **minimum of three examiners; one internal and two
> external**… A post graduate student in broad specialty shall be **allowed to appear for the Theory and
> Practical/Clinical examination only after the acceptance of the Thesis** by the examiners.

Default milestone chain (`CONFIG`, reorderable, per programme): `topic_selected → guide_allotted →
protocol_drafted → protocol_approved (IEC) → ethics_approval → data_collection → analysis →
draft_written → submitted → accepted`. Each carries `dueAt`, evidence attachment, and faculty
verification. `ethics_approval` requires an attachment — PGMER §10.2 makes ethics binding where animals
are involved, and no institution accepts a thesis without IEC clearance.

Additional research project — **MD General Medicine**:
> In addition to the thesis project, **every postgraduate trainee shall participate in at least one
> additional research project** … preferable that this project will be in an area different from the
> thesis work.

→ requirement `additional_research_project`, target 1, `nmc_curriculum`.

### 3.5 Rotations

PGMER §5.2(xii) (DRP) + the curricula's rotation schedules. MD Emergency Medicine 2024 prints a full
three-year schedule (ED 8 months, Paediatric Emergency 1 month, Dermatology 2 weeks, …) — shipped in its
pack as a **suggested** schedule the Academic Cell instantiates. Every other pack ships no schedule; the
department creates rotations.

### 3.6 Attendance

§1.6. One row per day. `CONFIG` thresholds with regulation provenance.

---

## 4. Verification, assessment and remediation state machines

```
ENTRY:      draft ──submit──▶ submitted ──verify──▶ verified ─(amend)─▶ submitted
                  ▲                    │                          (original kept)
                  └────return(reason)──┘
            any non-verified ──delete(reason)──▶ deleted (soft)
            verified ── delete ──▶ ✖ THROWS

ASSESSMENT: draft ──▶ completed ──sign──▶ signed
            completed with outcome=remediation ──▶ remediation_plan ──▶ reassessment ──▶ signed

ATTESTATION (§5.2(vi)): open month ──▶ attested (guide, immutable)
                        end of course ──▶ hod_final + hod_proficiency (HoD, immutable)
```

Invariants enforced in `pglog-model.js` (pure, unit-tested), **not** only in the UI or the API:

1. `verify()` **throws** if `actor === entry.createdBy` — *a resident can never verify their own record*
   (brief §21; and §9.2(c) makes self-certification a statutory risk).
2. `return()` **throws** on an empty reason.
3. `applyEdit()` **throws** on a `verified` entry.
4. `amend()` on a verified entry pushes the full prior document into `revisions[]` before mutating.
5. `assess()` **throws** if the assessor is the assessee.
6. Attestation is per `(residentId, YYYY-MM, kind)` and **create-if-absent** (Firestore
   `currentDocument.exists:false`) — a month cannot be attested twice or re-signed.
7. Server timestamps only. `occurredAt` is validated `programmeStart ≤ occurredAt ≤ now`.

---

## 5. Patient privacy — what is deliberately *not* stored

The brief (§18) and StewardMD's DPDP posture both require this, and PGMER §9.2(c) explicitly extends the
false-records penalty to *"patients' records"*.

| Rule | Enforcement |
|---|---|
| **No patient name, no phone, no address, no Aadhaar** — ever, in any logbook entry | `pglog-model.sanitizeCaseRef()` strips them; the entry schema has **no field** for them. The API rejects unknown fields rather than storing them. |
| Patient identity is a **reference only** | `caseRef` = free-text hospital/MRN reference, max 32 chars, **stored hashed-at-rest?** No — stored as typed, because a resident must be able to find the case again for the examiner. It is instead **withheld from every cross-resident surface**. |
| `caseRef` is visible to: the resident who wrote it, the verifying faculty, the HoD of that department | Field-level projection in `_pglog_store.js` — `publicEntry()` drops `caseRef` and `diagnosis` for Academic-Cell / institution-wide views, which see counts only |
| Reports: `caseRef` appears **only** on the individual resident logbook and the procedure report, both of which are the resident's own record | report builders take an `includeCaseRef` flag, default `false` |
| No free-text field is AI-summarised without the resident's action | §6 |
| Age/sex, if entered, are `ageBand` (decade) + sex — never DOB | schema |

The module is **not a second EMR**. Where StewardMD already holds the clinical context (an OPD Queue
ticket, an ICU patient, a SURGX operative note), an entry links by **id** and copies nothing.

---

## 6. AI — what it may and may not do

Brief §19. Implemented in `pglog-ai.js`, gated by `smd_pglog_ai` (default ON) and by the existing MaiK
usage/quota engine (`_ai_usage.js`). Every AI surface in the module is **advisory and labelled**.

| Allowed | Implementation |
|---|---|
| Suggest which requirement(s) an activity maps to | deterministic keyword matcher **first** (`pglog-curriculum.suggestRequirements()`, pure + tested); the LLM is a *second* opinion that can only **propose**, never apply |
| Detect missing / incomplete entries | pure `gaps()` over the cadence engine — **no AI at all** |
| Summarise resident progress / generate a faculty review draft | LLM, output is a **draft in a text box the faculty edits and owns**; never stored as the assessment until the human saves it |
| Smart reminders | pure, from due dates |

| Forbidden | Enforcement |
|---|---|
| AI must not invent NMC requirements | the prompt is given the resolved requirement list and instructed to choose from it; the client **rejects any returned id not in the pack** |
| AI must not fabricate clinical activity | no AI path creates an entry. `createEntry` has no AI caller. |
| AI must not mark a competency complete | progress is computed from **verified entries only**, by pure code |
| AI must not replace faculty verification | `verify()` requires a human `actor` uid with `PGLOG_VERIFY` cap; there is no service-account verify path |
| Official records deterministic | every number on every report is produced by `pglog-model.js` / `pglog-reports.js`, both pure and unit-tested |

---

## 7. Permissions — mapped onto StewardMD's existing RBAC

**No parallel permission system.** Capabilities are added to the existing `functions/_queue_roles.js`
`CAPS` matrix and granted through the existing `q_members` org-membership + `authorizeOrgAccess()` gate.

New caps: `PGLOG_LOG_OWN`, `PGLOG_SUBMIT_OWN`, `PGLOG_VIEW_OWN`, `PGLOG_VIEW_ASSIGNED`,
`PGLOG_VERIFY`, `PGLOG_ASSESS`, `PGLOG_ATTEST`, `PGLOG_VIEW_DEPT`, `PGLOG_VIEW_INSTITUTION`,
`PGLOG_CONFIGURE`, `PGLOG_AUDIT`.

| Role | Caps | Brief §21 requirement |
|---|---|---|
| `pg_resident` | LOG_OWN, SUBMIT_OWN, VIEW_OWN | create/view own, submit, see feedback, see progress. **Holds no VERIFY/ASSESS/ATTEST cap at all** — "cannot approve own official records" is enforced by the *absence* of the capability **and** by the model-layer self-verify throw (§4.1). Two independent locks. |
| `pg_faculty` | VIEW_ASSIGNED, VERIFY, ASSESS, ATTEST, LOG_OWN | view assigned residents, review, assess, feedback, verify/return |
| `pg_hod` | + VIEW_DEPT, AUDIT | department oversight, progress, reports, remediation oversight |
| `academic_cell` | + VIEW_INSTITUTION, CONFIGURE, AUDIT | institution-wide oversight, curriculum config, reports, audit access |
| existing `admin` (org owner) | inherits all **except** it is not auto-granted VERIFY/ATTEST | a technical admin must not be able to sign a clinical training record — the same separation `_queue_roles.js` already applies to the ONCQIS approval caps |

Scope (`membership.scope.departments`) is honoured by the existing `withinScope()`, so a faculty member
scoped to one department cannot read another's residents.

---

## 8. Notifications — reusing existing transport

Brief §16. **No new notification system.** Targeted device push reuses
`sendNativeToAll(env, msg, { uid })` from `functions/_nativepush.js` (the same per-uid path
`_taskpush.js` uses for ICU instructions), plus an in-module inbox (`pg_notifs`) for anything the user
should see when they open the app.

| Event | To | Trigger |
|---|---|---|
| Entry returned for correction | resident | on `return` (carries the reason) |
| Verification pending | faculty | daily digest of `submitted` entries |
| Verification overdue | faculty + HoD | `submitted` age > `CONFIG` verifySlaDays (default 7) |
| **Monthly authentication due / overdue** | guide + HoD | month close + grace (§1.2) |
| Assessment pending | faculty | procedure entry verified without a linked DOPS, where the pack requires one |
| Training gap identified | resident (+ faculty weekly) | pure `gaps()` |
| Rotation ending | resident + faculty | `endDate - CONFIG rotationEndNoticeDays` (default 7) |
| Required activity approaching / overdue | resident | due dates (§1.5 certifications, §3.4 thesis milestones) |
| Thesis milestone reminder | resident + guide | ditto |

---

## 9. Future UG compatibility

**UG is not built.** The engine underneath is programme-generic:

```
Programme → Curriculum → Requirement → Activity → Evidence → Assessment → Verification → Progress
```

- `pg_programmes.programmeType = "PG"` today. `"UG"` is a valid value the engine already carries.
- A curriculum pack has `programmeType`, `levels[]` (PG: training years 1-3; UG: CBME phases I-III),
  `subjects[]` (PG: one specialty; UG: many), and `requirements[]` with a `competencyCode` field that is
  unused for PG and is exactly where a CBME code (`IM 1.1`) will go.
- Requirement kinds (`procedure`, `academic`, `clinical`, `certification`, `research`, `attendance`,
  `reflection`) already cover CBME's activity types.
- The verification/audit/assessment layers are programme-agnostic: they know `residentId` /
  `supervisorId`, never "PG".

Adding UG later = new packs + a UG dashboard. It does **not** touch the model, store, API, RBAC or audit.

---

## 10. Source register

**The extracted plain text of every PDF below is checked into `pglog-sources/`**, and
`test/pglog-provenance.test.mjs` verifies every quotation and every number in every pack against it.
A claim that is not in those files fails the build. (Added 2026-08-27 after R1 found that the
previous test compared each procedure count against a quotation the generator had synthesised from
that same count — see §12.)

| # | Source | Retrieved | URL / locator |
|---|---|---|---|
| S1 | **PGMER-2023** — Post-Graduate Medical Education Regulations, 2023, NMC/PGMEB, File No. N-P016(11)/2/2023-PGMEB-NMC, Gazette of India Extraordinary Part-III §4 | 2026-08-27 | `nmc.org.in/MCIRest/open/getDocument?path=/Documents/Public/Portal/LatestNews/MER.pdf` (23 pp + annexures) |
| S2 | **PGMEB clarification / FAQs on PGMER-23** — PUBLIC NOTICE, F.No. N-P016(11)/2/2023-PGMEB-NMC, dated **10.04.2024**, signed Dr Vijay Oza, President PGMEB | **2026-08-27, PRIMARY — obtained** | `nmc.org.in/MCIRest/open/getDocument?path=/Documents/Public/Portal/LatestNews/FAQs+on+PGMER-2023.pdf`. The PDF is a **scan**; OCR text is checked into `pglog-sources/PGMEB-FAQ-2024-04-10.txt` with its OCR caveats stated. Everything from it is now graded `nmc_faq`, not `nmc_faq_secondary`. **It corrected this module** — see §14. |
| S3 | MD in General Medicine (revised), NMC 2022 | 2026-08-27 | `nmc.org.in/wp-content/uploads/2022/revised/MD-in-General-Medicine-(revised).pdf` |
| S4 | MD Emergency Medicine curriculum V6, NMC 2024 | 2026-08-27 | `nmc.org.in/wp-content/uploads/2024/10/NMC MD EM CURRICULUM-V6 with logo revised-1.pdf` |
| S5 | MS Orthopedics (revised), NMC 2022 | 2026-08-27 | `.../2022/revised/MS_Orthopedics_( revised ).pdf` |
| S6 | MD Paediatrics (revised), NMC 2022 | 2026-08-27 | `.../2022/revised/MD_Peadiatrics_( revised ).pdf` |
| S7 | MD Pathology (revised), NMC 2022 | 2026-08-27 | `.../2022/revised/MD_Pathology_(revised).pdf` |
| S8 | MD Psychiatry (revised), NMC 2022 | 2026-08-27 | `.../2022/revised/MD_Psychiatry_( revised ).pdf` |
| S9 | MS Surgery, NMC 2019 | 2026-08-27 | `.../2019/09/MS-Surgery.pdf` |
| S10 | MS OBGY, NMC 2019 | 2026-08-27 | `.../2019/09/MS-OBGY.pdf` |
| S11 | MD Anaesthesia, NMC 2019 | 2026-08-27 | `.../2019/09/MD-Anesthesia.pdf` |
| S12 | MD Radiodiagnosis, NMC 2019 | 2026-08-27 | `.../2019/09/MD-Radiodiagnosis.pdf` |
| S13 | MD Dermatology, NMC 2019 | 2026-08-27 | `.../2019/09/MD-Dermatology.pdf` |
| S14 | MS Ophthalmology, NMC 2019 | 2026-08-27 | `.../2019/09/MS-Ophthamology.pdf` |
| S15 | MS ENT, NMC 2019 | 2026-08-27 | `.../2019/09/MS-ENT.pdf` |
| S16 | MD Community Medicine, NMC 2019 | 2026-08-27 | `.../2019/09/MD-Community-Medicine.pdf` |
| S17 | MD Pulmonary Medicine, NMC 2019 | 2026-08-27 | `.../2019/09/MD-Pulmonary-Medicine.pdf` |
| S18 | Chaudhari *et al.*, *Confusion Surrounding the Mandatory Requirement of Thesis Submission: Review of the PGMER of the NMC* | 2026-08-27 | PMC12054657 — cited only for §1.11's statement that the thesis clause numbering is contested |

### Sources sought and **not** obtained (open items)

| Wanted | Status | Consequence |
|---|---|---|
| ~~PGMEB FAQ / clarification PDF (10.04.2024), primary~~ | **OBTAINED 2026-08-27** | Closed. See S2 and §14. |
| **PG-MSR 2023 / Revised PGMSR (23.08.2024)** | Downloaded (`11RevisedPGMSR2023dated23082024.pdf`, 1.0 MB) but it is a **scanned image PDF** — no extractable text | No MSR-derived requirement is claimed anywhere in the module. If MSR turns out to specify logbook content, this doc and the packs must be revisited. |
| Specialty curricula for the remaining ~20 broad specialties and all DM/M.Ch | Not fetched | Those specialties get the **generic PG pack** (PGMER-2023 requirements only, no specialty layer) with an explicit "no NMC specialty pack loaded" notice, rather than a guessed one. |

---

## 11. Clause index

Every PGMER-2023 clause a curriculum pack cites, so the doc is the index it claims to be. Sub-items
are quoted in full in §1.

`2.2(iii)` · `5.2(iii)` · `5.2(v)` · `5.2(vi)` · `5.2(vii)` · `5.2(x)` · `5.2(xi)` · `5.2(xi)(a)` ·
`5.2(xi)(b)` · `5.2(xi)(c)` · `5.2(xii)V` · `5.2(xii)VIII` · `5.6` · `5.6(a)` · `5.6(e)` · `6.2` ·
`8.1` · `9.2(c)`

Specialty-curriculum clauses are PDF headings rather than numbered sections; they are verified
directly against the source text in `pglog-sources/` rather than being re-listed here.

## 12. Corrections after R1 review — 2026-08-27

R1 (clinical safety & evidence gate) returned **NO-GO** on the first cut of this module and found
seven critical and nine important defects. What changed, and why each mattered:

| # | Was | Now |
|---|---|---|
| C1 | A **77-day** District Residency satisfied "three months" — the check was `months >= 2.5`, a tolerance that appears in no NMC source. | The floor is **89 days**, the shortest possible three calendar months (1 Feb → 1 May). `drpMonths()` is display-only; `drpMeetsThreeMonths()` decides. |
| C2 | Statutory leave was silently counted as **non-attendance** under a §5.6 badge — 20 days of granted paid leave pushed a resident to exactly 80%, and 90 days of maternity leave read as **47%**. | §5.6 *grants* that leave and extends the term only for leave **in excess** of what is permitted. Every permitted leave state now counts by default; the map is institutional configuration and the summary reports `interpretationSource: "institution"` separately from the regulation's 80%. |
| C3 | A whole-course target was "expected" **from day one**, so a resident three days into residency saw 72 high-severity gaps and "about 100 intubations expected by now". | Prorated against the programme's own length; with the length unknown there is **no expectation and no gap**, and the state is `in_progress`, not `behind`. |
| C4 | MD Paediatrics and MD Pathology residents were shown General Medicine's summative pre-requisites as their own NMC requirement. Paediatrics actually requires **one** presentation, accepts **state** level, and treats the publication as an **alternative**. | The pre-requisites moved out of the shared 2022 pack into each specialty's own, quoted from its own PDF. Paediatrics is evaluated as a real OR (`anyOf`). |
| C5 | **Any** faculty member in the institution could read **any** resident's case references, diagnoses, remarks and reflections — both branches of the guard returned the same value. | Guide, co-guide, or the supervisor named on that specific entry get `verifier`; everyone else falls through to `aggregate`. A department head is scoped to their department. |
| C6 | A rotation `PATCH` was gated on a **caller-supplied** org but written to the rotation's own org — cross-institution write, including flipping a DRP to `completed`. | Gated on the rotation's own `orgId`, loaded from the document, like every sibling route. |
| C7 | The "authenticated monthly **by the postgraduate guide**" artefact, and the **HoD's** proficiency certificate, could be signed by any faculty member holding the cap. | Monthly needs the guide, a co-guide, or the HoD (recorded in `attestedRole`); the two HoD documents need `pg_hod`. |
| I1 | The Emergency Medicine pack shipped **64 of the 81** procedure minima the NMC prints — NG tube insertion (100) and lab/imaging interpretation (100) among the 17 missing — behind a complete-looking checklist. | All **87** entries ship (81 with a number, 6 the NMC lists without one), verified against `pglog-sources/emerg.txt`. |
| I2 | A resident could edit an entry **while it sat in the verifier's queue**, so a guide could sign a document different from the one they read. | `applyEdit()` throws on `submitted`. The author `withdraw()`s it first, which clears it from the queue and is recorded. |
| I3 | `history[]` truncated at 200 and `revisions[]` at 30 **silently**, against a doc that promised the original is "preserved in full". | Still bounded for the Firestore document limit, but `overflowedHistory` / `overflowedRevisions` record that older rows were shed, so a truncated chain cannot be presented as complete. |
| I5 | The MD General Medicine appraisal form produced a **"105 / 135"** total. That form is a banded per-element rating with **no total row**. | The template carries `noTotal`; the report prints the element ratings and no synthesised sum. |
| I6 | The self-assess guard compared against a `residentUid` that was `""` when the resident could not be resolved — a silently disabled check. | Fails closed: the assessment is refused if the resident cannot be resolved. |
| I8 | The DRP semester window ignored the clause's own two exceptions. | §5.2(xii)V restricts a post-diploma entrant and a PG Diploma student to the **third semester only**, and the warning now says so. |
| — | Three quotations were **wrong**, and one was **fabricated**: the shared 2022 pack dropped "the" from "from **the** Head of Department"; MD Radiodiagnosis says "training **program**", not "programme"; MS OBGY prints "**clinic**-pathological", which had been silently tidied to "clinico-"; and MD Pathology carried a CPC requirement quoting "…clinico-pathological conferences…" **to a clause that does not exist in that PDF**. | All quoted as printed; the fabricated Pathology requirement was **deleted** rather than given an invented replacement. PGMER-2023 §5.2(x) already covers CPCs for every specialty. |
| — | The Research Methodology clause was shared across the four 2022-revised curricula. Paediatrics says "an **NMC recognized** course" where the others say "an **online** course". | Moved into each specialty pack with its own wording. |

**The test that should have caught all of this.** `test/pglog-curriculum.test.mjs` claimed to fail the
build if a numeric target did not appear in its own quotation — but the generator synthesised each
procedure's quotation *from that target*, so the assertion compared a number with itself and passed
for all 64 shipped minima without ever reading the PDF. `test/pglog-provenance.test.mjs` now checks
every quotation and every count against the checked-in source text in `pglog-sources/`, and the
Emergency Medicine procedure count is asserted **exactly**, not as a floor.

## 14. The PGMEB FAQ, obtained 2026-08-27 — and what it corrected

The FAQ PDF listed in §10 as unobtainable was found while reviewing a competing product, which cites
NMC document numbers on its dashboard. Getting it changed three things, one of them a correctness
defect in this module.

### 14.1 The attendance denominator was wrong

PGMER-2023 §5.6 gives only a percentage. **FAQ Q2 defines what it is a percentage of**, verbatim:

> **For Three-Year Course:** Total days in a three-year course will be 1095 days. So the total
> **working days will be 939 days after deducting weekly offs (52 x 3 years = 156 days)**. A student
> will require **80 per cent attendance of working days (i.e. 751 days of 939 days)** for appearing in
> the examination. However, period of training will be extended by the same number of days for which
> maternity/paternity leave and total excess casual leave have been availed in three years.
>
> **For Two-Year Course:** Total days … 730 days … working days will be **626 days** … (i.e. **501**).

So the denominator is **working days** — calendar days minus 52 weekly offs a year. This module was
computing two other things: a percentage of the days the resident had *recorded*, and a percentage of
elapsed *calendar* days. Neither is the FAQ's definition, and **the first is worse than merely wrong —
it flatters**: a resident who records only the days they were present scores 100%, and that was the
headline number on their dashboard.

`workingDays()` and `requiredAttendanceDays()` now **reproduce the FAQ's arithmetic** rather than
copying its answers, and a unit test asserts they land on 1095 → 939 → 751 and 730 → 626 → 501.
`pctOfWorkingDays` is the headline; `pctOfRecorded` is kept, demoted and labelled secondary.

### 14.2 Two things the gazette does not say, now sourced

| FAQ | What it settles |
|---|---|
| Q1 | *"Five days Academic Leave per year, if availed by a student **will be counted as duty**."* — this is why academic leave counts toward attendance here, and it is now quoted rather than assumed. |
| Q1, Q2 | Maternity/paternity leave and **excess** casual leave do not reduce the percentage; they **extend the period of training by the same number of days**. Implemented as `termExtensionDays()` and surfaced as its own statement, not as a deduction. |
| Q3, Q4, Q5 | DRP posting: *"posting in any post-graduate medical institution or super specialty hospital is **not permitted**"*; ESIC hospitals allowed only if they run neither; other States/UTs by mutual agreement with PGMEB approval; NEZ students may stay in their own State. |
| Q7 | *"The PG students from **2023-24 batch** will maintain log book digitally."* — the applicability date for the digital mandate. |
| Q8, Q9 | Ethics and Cardiac Life Support apply to *"all the PG students admitted **from 2021** and after"*, and are *"designed and conducted by the **Academic Cell** of the respective medical college"* — the issuer, which §5.2(xi) leaves open. |
| Q6 | The full dissertation mark split: **Clinical/Practical 280 + Dissertation 20 + Viva Voce 100**. |

### 14.3 A second document, and what it is not

The NMC *"Guidelines for preparing Logbook"* (17.01.2020) — which the 2022-revised PG curricula tell
faculty to consult (*"referred to the MCI Logbook Guidelines uploaded on the Website"*) — turns out to
be **for the UNDERGRADUATE programme**, written against the CBME 2018 curriculum and GMER 2019. It is
checked into `pglog-sources/MCI-Logbook-Guidelines-2020-UG.txt` for the UG phase. **No PG requirement
in this module is derived from it**, and the PG curricula's cross-reference to it should be read with
that in mind.

## 15. Changelog of this document

| Date | Change |
|---|---|
| 2026-08-27 | Created from S1–S18. |
| 2026-08-27 | §11 clause index, §12 R1 corrections. Source extracts checked into `pglog-sources/`. |
| 2026-08-27 | §14: PGMEB FAQ **obtained** (S2 upgraded to primary) and the attendance denominator corrected to working days. Specialty picker generated from Annexure-1/-2 — all 84 recognised qualifications. |

**Maintenance rule:** if an NMC amendment lands, update **this file first**, then the packs, then the
code. A pack requirement whose `source` clause is not in this file is a bug.
