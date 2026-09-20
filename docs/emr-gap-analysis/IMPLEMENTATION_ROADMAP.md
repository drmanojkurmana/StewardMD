# Implementation roadmap

## P0 — absolutely required for a credible hospital EMR

### 1. Reachability audit of every existing `functions/_wardsynq/*.js` module
- OpenMRS/Bahmni: n/a — this is a WardSynQ-specific discipline problem, not a feature gap.
- WardSynQ status: 7+ confirmed cases this session of finished, correct, tested backend logic with
  zero route/UI ever calling it. This session fixed incidents, note-writer-roles-actually-working,
  and confirmed billing/invoice/emar/news2/mpi/read-log/safety-case are now wired — but the
  discovery method was manual, role-by-role, live clicking. There is no reason to believe every
  instance has been found.
- Recommendation: build a **static reachability checker** — a script that, for every exported
  function in `functions/_wardsynq/*.js`, confirms at least one `import` + call site exists in
  `functions/api/queue/[[path]].js` (or another real router), and for every route registered there,
  confirms at least one UI element (`ward.js`/`shell.js`/`opd.html`) issues a request to it. Run in
  CI. This single tool would have caught every "nothing called it" bug this session found by hand,
  automatically, forever.
- Complexity: low (a grep-based static analysis script). Migration risk: none. **This is the highest
  leverage single item on this entire roadmap.**

### 2. Terminology service integration
- OpenMRS: has it (Concept Dictionary).
- Bahmni: inherits OpenMRS's.
- WardSynQ: explicit, admitted gap.
- Recommendation: REUSE via external call (see `TARGET_ARCHITECTURE.md`) — stand up a
  narrowly-scoped, MPL-licensed terminology service and call `$lookup`/`$validate-code`/`$expand`
  from `terminology.js`, replacing its current "no LOINC release, cannot validate" honesty note with
  an actual answer.
- Complexity: medium (new external dependency, network call in a previously pure module). Migration
  risk: low — this is additive; existing manually-seeded codes keep working exactly as before.

### 3. Live payment gateway
- OpenMRS/Bahmni: neither has one either.
- WardSynQ: `NullAdapter` default, confirmed.
- Recommendation: REBUILD NATIVE — integrate a real Indian payment gateway (Razorpay/PayU/UPI) behind
  the existing `wardsynq-payment-adapter.js` seam, which was clearly built expecting exactly this.
- Complexity: medium. Migration risk: low (the adapter boundary already exists; this is filling it in,
  not redesigning it).

### 4. Pharmacy purchase/vendor/goods-receipt workflow
- OpenMRS/Bahmni: neither solves this well either.
- WardSynQ: explicitly absent.
- Recommendation: REBUILD NATIVE, scoped down to what an Indian hospital pharmacy actually needs
  (a purchase order, a vendor record, a goods-receipt event that feeds the existing append-only
  stock-movement ledger — do not touch the ledger's own append-only/no-clamping discipline, extend
  it).
- Complexity: medium. Migration risk: low (additive to `stock.js`'s existing model).

## P1 — required for strong production deployment

| Feature | OpenMRS | Bahmni | WardSynQ | Recommendation | Complexity | Risk |
|---|---|---|---|---|---|---|
| Patient relationships (next of kin) | ✅ | ✅ (inherits) | ❌ | Rebuild native | low | low |
| Deceased-patient handling | ✅ | ✅ | ❌ | Rebuild native | low | low |
| Fuzzy/phonetic patient search | 🟡 | 🟡 | ❌ | Rebuild native | medium | low |
| Referrals | ❌ | 🟡 | ❌ | Rebuild native | medium | low |
| Staff shift rostering | ❌ | ❌ | ❌ | Rebuild native (nobody has this) | medium | low |
| Document/object storage | n/a | n/a | ❌ (no bucket at all) | Infrastructure decision (R2/S3), then native document model | medium | medium — first real infra addition |
| Dynamic clinical form builder | 🟡 | ✅ (JSON config pattern) | ❌ | Rebuild native, copying Bahmni's config-not-code PATTERN | medium-high | medium |
| Payer/TPA live transport | ❌ | ❌ | 🔴 (`NullAdapter`) | Rebuild native, per-payer adapter | high (many payer integrations) | medium |

## P2 — important advanced functionality
- Analyzer (ASTM/POCT1-A) lab integration.
- Microbiology/pathology-specific result workflows.
- Packages/bundle pricing in billing.
- 2FA / session-timeout / password-policy hardening.
- Nursing task/to-do list module.
- Radiology-modality-specific scheduling.

## P3 — nice-to-have / later
- True DICOM MWL (C-FIND) via a broker, for sites with legacy modality hardware that can't speak
  DICOMweb.
- True HL7 v2 MLLP via a broker, for sites with legacy interface engines.
- Patient portal.
- Population/public-health reporting beyond what `wardsynq-population.js` already does (verify scope
  first — this file already exists and was not audited in depth in this pass).

## Sequencing recommendation
Do #1 (the reachability checker) **before** anything else on this list. It is cheap, it is a tool not
a feature, and everything else on P0/P1 risks being invisible in production the same way incidents/
billing/emar were, unless the discipline that let that happen eight separate times is actually fixed
at the process level, not just patched instance by instance.
