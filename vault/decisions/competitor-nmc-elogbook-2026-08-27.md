---
tags: [competitive, education, regulatory]
date: 2026-08-27
subject: NMC eLogbook (Neugenic Mediventure Collective Pvt Ltd)
---
# Competitor teardown — "NMC eLogbook" by Neugenic Mediventure

Reviewed 2026-08-27 from two screen recordings and twelve App Store screenshots supplied by the
owner. This is the closest direct competitor to [[NMC Logbook]].

## What it is

| | |
|---|---|
| Product | **NMC eLogbook** — "SKILL, SCORE, SUCCEED." (™) |
| Vendor | Neugenic Mediventure Collective Private Limited · legal docs effective 9 Apr 2025 |
| Pricing | **₹4,999 + 18% GST per resident, valid 3 years** (list ₹9,999). Sold per batch: PG 2023, PG 2024, PG 2025. |
| Model | Direct-to-resident. Self-service signup; a **Referral ID** field on registration. |
| Scope | PG only (Post Graduate / Super Speciality / Diploma streams). MBBS/UG claimed on their website. |
| Compliance claim | *"Developed in compliance with NMC Postgraduate Medical Education Board guidelines D 11011/1/22/AC/Guidelines/22 Date: 02-11-2022"* |

That reference number is the file number on the **2022-revised competency-based curriculum
guidelines** — a document we already source. Notably, one of their own App Store screenshots ships
the string with the placeholders **unfilled**: *"guidelines refNo refDate"*. Their screenshots also
contain live test data (`xyz`, `test`, `Wert`, `ggvv`, `Demo Pathology`).

## Their surface

- **Student**: Dashboard · Mandatory Checklist · Log Book › · Thesis & Pub. › · DRP › · Quarterly
  Appraisal Form · Memo · **Aetcom** · Support. Bottom tabs: CheckList · Notification · Profile.
- **HOD/Faculty**: Dashboard · All Staffs · All Students · Main Checklist · (same sections).
  HOD home is **Pending Verifications**, searchable by name/topic/status.
- **Dashboard tiles**: Mandatory Checklist 3/8 · Academic Activity 24 · Diagnostic Skills 4 ·
  Procedures 11.
- **Department picker**: ~35 departments, including non-clinical (Anatomy, Biochemistry, Physiology,
  Pharmacology, Forensic, Microbiology) and **"General surgery (DNB)"** — i.e. NBEMS, not just NMC.

## What they do that we did not — and what we did about it

### 1. Faculty is a DROPDOWN, ours was a text box → this was a real bug in ours

Their Academic Activity form has **"Select Teacher name"** as a roster dropdown. Ours was free text,
and `pendingFor` is a denormalised copy of it. So a resident typing "Dr Sharma" when the guide's
identity is `fb:abc123` produced an entry that was `submitted`, counted toward nothing, sat in
**nobody's** queue, and looked sent. Silent loss on a regulatory record.

**Fixed:** `facultyRoster()` (org members who actually hold `PGLOG_VERIFY`), `resolveSupervisor()`
(guide → co-guides → roster, by identity or email), submit **refuses** an unresolvable supervisor
instead of orphaning the entry, and the form is a picker. Four tests.

### 2. Their compliance citation led us to the PGMEB FAQ we could not find

Chasing their document number surfaced the **primary PGMEB FAQ PDF of 10.04.2024** — the one
`NMC_PG_LOGBOOK_REQUIREMENTS.md` §10 had listed as *sought and not obtained*.

**It corrected our attendance model.** §5.6 gives only "80%"; FAQ Q2 defines the denominator:
**working days** = calendar days − 52 weekly offs/year (939 in a three-year course; 80% = 751). We
were computing a percentage of *recorded* days, which **flatters** — a resident who records only the
days they attended scored 100%, and that was the headline. Now `workingDays()` reproduces the FAQ's
own arithmetic (1095→939→751, 730→626→501), `pctOfWorkingDays` is the headline, and academic leave
counting as duty / maternity-paternity extending the term are quoted rather than assumed. Full write-up
in **§14** of the requirements doc.

### 3. Coverage: ~35 departments vs our 15 packs

**Closed differently.** `pglog/specialties.json` is generated from **PGMER-2023 Annexure-1 and
Annexure-2** — **84 recognised qualifications** (38 broad + 46 super). 15 have a real curriculum pack;
the rest resolve to `generic-pg`, which carries the PGMER requirements and *says* no specialty pack is
loaded. Sourced from the gazette, so the picker cannot drift from the regulation.

## Where we are clearly ahead

| | Them | Us |
|---|---|---|
| **Compliance claim** | "Developed in compliance with NMC…" — asserted, once with the reference left as `refNo refDate` | We refuse to claim compliance. Every report says eligibility is the University's decision. |
| **Provenance** | None visible. A requirement is a row. | Every requirement carries source + clause + verbatim quote, rendered as a visually distinct badge per grade, and **verified against the checked-in NMC PDF text by a test that fails the build**. |
| **Mandatory Checklist** | **Three items**: Research Methodology, DRP Certificate, Audit. **Ethics/GCP-GLP and BCLS/ACLS are absent** — both are §5.2(xi) examination pre-requisites. | All three §5.2(xi) certifications + DRP + the §5.2(x) dissemination disjunction + thesis + attendance + specialty requirements, each with its clause. |
| **Procedure minima** | Not evident | 81 NMC-stated minima for MD Emergency Medicine, verified against the PDF; every other specialty counts without inventing a target. |
| **Audit trail** | Not evident | Verified records immutable; correction is `amend()` keeping the original in full; append-only history; exactly-once monthly attestation; self-verify refused at the data layer. |
| **Offline** | Not evident (all screens are server tables) | Drafts work with no network and are never presented as submitted. |
| **UI** | Horizontally-cut data tables on a phone — `Sr. No. / Topic / Training Type…` with columns off-screen | Cards, a three-tap add, thumb-reachable actions. |
| **Privacy** | Free-text `Student Remark` on every form; no visible minimisation | No schema field for patient identity; scrubbing on write; `publicEntry()` withholds case reference and diagnosis from every cross-resident view. |
| **Attendance** | Not evident | Now the FAQ's own definition, with term-extension tracked separately. |

## Where they are ahead, and what we are doing about it

| Gap | Status |
|---|---|
| **Self-service onboarding.** A resident registers in ~2 minutes: pick institution → department → course, OTP-verified mobile + email, done. Ours needs the Academic Cell to create a programme and enrol. | **Deliberate, and defensible — but it is our biggest adoption risk.** Verification requires a real guide, so an unenrolled resident cannot get a verified record from anyone. We already let them log device-local drafts. **Owner decision needed:** whether to add self-registration that produces an *unverified* record pending institutional claim. |
| **"Memo"** — an administrative/disciplinary note channel. | Not built. Cheap to add; needs a use-case from a real HOD first. |
| **"Aetcom"** as a first-class section. | Not built. AETCOM is a real NMC component; PGMER-2023 §2.2(iv) has "Soft skill attributes including communication skills". **Worth adding**, but only once quoted properly. |
| **"Diagnostic Skills"** as a distinct tile. | We fold this into clinical/procedure entries. Cosmetic; revisit if residents ask. |
| **DNB coverage.** They list "General surgery (DNB)". | Out of scope — PGMER-2023 §7.1 says NBEMS courses are *not permissible against the same units*. Would be a separate regulator. |
| **Super-specialty curriculum packs.** | 46 DM/MCh qualifications are selectable but none has a sourced pack. Honest fallback today; real packs are just fetch-and-quote work. |

## Pricing read

₹4,999 + GST per resident per 3 years, from the resident's own pocket. That sets the reference price
for an institutional or bundled offer, and it tells us the buyer they have chosen is **the resident**,
not the college. Our institutional model (Academic Cell enrols, HOD oversees) sells to the college —
a slower sale with a much stickier account, and the only model in which the verification chain is
actually real.
