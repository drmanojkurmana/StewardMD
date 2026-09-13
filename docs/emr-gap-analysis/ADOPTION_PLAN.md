# What to adapt from OpenMRS, Bahmni, and Danphe — and the plan to get WardSynQ to 100%

Drawn from `OPENMRS_BAHMNI_AUDIT.md`, `DANPHE_EMR_AUDIT.md`, and the live findings from this
session's own 17-role walkthrough. Nothing here means "import their code" — every item below is
"take the idea/shape, build it native, in WardSynQ's own style and permission model," for the
reasons already laid out in `LICENSING_ANALYSIS.md` (Bahmni's core is AGPL) and
`REUSE_VS_REBUILD.md` (neither project's actual code fits WardSynQ's serverless runtime).

## The four things actually worth adapting

### 1. From Bahmni: the composite clinical write (`BahmniEncounterTransaction`)
**What it is**: one consultation = one API call, not six. Obs, diagnoses, drug orders, and
disposition all go in a single transaction with pluggable handlers per resource type, instead of
the screen firing off separate calls for each.

**Why WardSynQ needs it**: this session found the exact bug this pattern prevents — the "shared
error slot" race in `ward.js`, where opening a chart fires 8+ parallel loads and whichever one's
`settle()` call finishes last silently overwrites every other one's error message. Cashier and
blood-bank both hit variants of this bug this session. A composite write removes the whole class.

**How it lands in WardSynQ**: a new `functions/_wardsynq/consultation.js` that accepts one POST
carrying `{ vitals?, problems?, orders?, note?, disposition? }`, resolves ONE actor/grant, and
writes each present piece through the existing per-resource governance (`actor.js`'s grant model
stays exactly as-is — this is an API shape change, not a permission-model change). `ward.js`'s
chart-open flow gets rewritten to build one payload and fire one request.

### 2. From Danphe: the append-only, multi-level approval chain
**What it is**: instead of a single `approved: true/false` flag anywhere, every approval step is
its own row pointing at the previous one (`ParentVerificationId`), so the full history — who
approved what, at which level, in what order — is always reconstructable. Bound to real per-store,
per-permission approval-level rules. This is, per the Danphe audit, "the one part of that whole
codebase whose authorization model is worth copying wholesale" — everything else in Danphe fails
exactly the discipline WardSynQ already has.

**Why WardSynQ needs it**: right now, approval-shaped decisions in WardSynQ (discharge sign-off,
incident closure, CAPA completion, claim adjudication) each have their own bespoke shape. A single,
reusable `Verification` pattern — append-only, leveled, tied into the existing two-layer
capability/grant model instead of Danphe's bolted-on one — means every future approval workflow
(pharmacy purchase-order sign-off, a big-ticket discount, a controlled-drug release) gets this for
free instead of being reinvented per feature.

**How it lands**: a small, generic `functions/_wardsynq/verification.js` — `requestVerification`,
`recordVerification` (append, never overwrite), `verificationHistory` — parameterized by a
`subjectType`/`subjectId` (an Invoice, a StockRequisition, whatever), with the required-level count
coming from org config the same way `noteWriterRoles` already does.

### 3. From Danphe: the pharmacy stock ledger's specific shape
**What it is**: append-only stock-movement rows (WardSynQ already does this — `stock.js` already
follows the "count is a belief, never a stored counter" discipline, which is actually MORE careful
than Danphe's). What Danphe has that WardSynQ doesn't: a real purchase-order → goods-receipt →
supplier-ledger → payment chain, and inter-store/dispensary transfer as first-class transactional
events.

**Why WardSynQ needs it**: this is the one confirmed, explicit gap in `stock.js` itself
("nothing here purchases anything"). Danphe proves the shape is buildable without compromising an
append-only ledger's integrity.

**How it lands**: extend `stock.js`'s existing movement-ledger model with three new movement
causes (`purchase-order`, `goods-receipt`, `supplier-payment`) plus new resource types
`PurchaseOrder` and `Vendor` — additive, the existing negative-balance-is-a-finding and
no-unit-guessing rules stay untouched.

### 4. From OpenMRS: the concept-dictionary *shape*, populated independently
**What it is**: not OpenMRS's code (it ships with zero actual ICD/SNOMED/LOINC content, confirmed)
— the *shape* of `Concept` → `ConceptMap` → `ConceptReferenceTerm` → `ConceptSource`, which lets one
internal concept carry mappings to several external vocabularies at once.

**Why WardSynQ needs it**: `terminology.js` admits outright it has no real code tables. This is the
single largest, hardest-to-rebuild-well gap found across all three audits.

**How it lands**: NOT by standing up OpenMRS. Call an external, purpose-built FHIR terminology
server (several exist as hosted or self-hostable options) for `$lookup`/`$validate-code`/`$expand`,
and shape `terminology.js`'s internal cache the way OpenMRS models the mapping (one WardSynQ concept
id, several external codes) so a future change of terminology vendor doesn't touch every caller.

## What NOT to adapt, and why (confirmed, not assumed)

- Danphe's authorization model — it's disabled in their own code. Nothing to copy.
- Danphe's "load everything as JSON, trust the client" pattern on money/status fields — the opposite
  of WardSynQ's server-is-sole-authority discipline, confirmed working correctly all session.
- Bahmni's AngularJS frontend or bahmnicore's Java services — wrong runtime, AGPL licensing risk.
- OpenMRS's REST/FHIR API shape — confirmed it can't even write orders over FHIR; not something to
  imitate as an integration target.
- Any of the three projects' billing/RIS/pharmacy-inventory code wholesale — all three audits
  independently confirm WardSynQ's own (post-reachability-fix) logic is already more careful in
  these areas than any of the three comparison systems.

---

# The plan to get WardSynQ to 100%

"100%" here means: every backend module has a real UI route to it, the four adaptations above are
built, and the small confirmed native gaps are closed. This is a rewrite of nothing — it is
additive work on top of what already exists, sequenced by leverage.

## Phase 0 — stop the bleeding (do this first, before any new feature)
**Build the reachability checker.** A CI script that fails the build when: (a) an exported function
in `functions/_wardsynq/*.js` has no import+call site in the router, or (b) a route registered in
the router has no UI element in `ward.js`/`shell.js`/`opd.html` that calls it. This is what would
have caught incidents.js, billing.js, migrate-emar.js, news2-view.js, mpi-view.js, read-log.js, and
wardsynq-safety-case.js automatically, instead of needing a manual 17-role walkthrough to find them
one at a time. Estimated effort: 2-3 days for one engineer. This is the highest-leverage single item
in this entire plan — everything after it is safer because of it.

## Phase 1 — the four adaptations (2-4 weeks each, can run in parallel across engineers)
1. Composite clinical write (`consultation.js` + `ward.js` chart-open rewrite).
2. Generic verification/approval chain (`verification.js`), then migrate ONE existing bespoke
   approval flow (discharge sign-off is the best test case) onto it to prove the shape before
   wiring in new ones.
3. Pharmacy purchase-order/goods-receipt/vendor extension to `stock.js`.
4. External terminology service integration in `terminology.js`.

## Phase 2 — the remaining confirmed native gaps (from `IMPLEMENTATION_ROADMAP.md`, unchanged)
- Live payment gateway behind the existing `wardsynq-payment-adapter.js` seam.
- Patient relationships, deceased-patient handling, fuzzy patient search.
- Staff shift rostering.
- Referrals.
- Document/object storage (infrastructure decision first — needs a bucket).

## Phase 3 — hardening pass
- Re-run the full 17-role live walkthrough (this session's own method) after Phase 0-2 land, to
  catch anything the reachability checker's static analysis can't see (a route that exists and is
  called, but behaves wrong for a specific role — the class of bug that needed a human clicking
  through screens to find, not a static check).
- Audit-log coverage check: confirm every new resource type introduced in Phases 1-2 is covered by
  the audit trail from day one (Danphe's biggest audit gap — money and demographics only, nothing
  clinical — is the one mistake this plan should make sure never repeats in WardSynQ).

## Sequencing rationale
Phase 0 before anything else because it changes the cost of every subsequent phase — without it,
each new module built in Phase 1-2 risks becoming the ninth instance of "finished, unreachable"
code. Phase 1's four items are independent of each other and of Phase 2, so they can run in
parallel rather than sequentially. Phase 3 last because it needs Phase 0-2's surface area to exist
before it can meaningfully re-test it.

---

# What actually got built (2026-09-12)

Phase 0 and all four adaptations are implemented, tested and live. What follows is what was
built, and — more usefully — where the plan above turned out to be wrong.

## Phase 0 — the reachability checker: DONE
`scripts/wardsynq-reachability.mjs`, running as part of the test suite. Screens are discovered
rather than listed, so a new screen file is covered automatically.

**The first run was worse than the plan assumed.** The plan named 7-8 unreachable modules found
by hand. The checker found **65 routes with no screen at all**, out of 291 (206 reachable, 20
machine-to-machine by design). Care plans, handover, wound care, medication reconciliation,
order sets, patient record merge, break-glass, infusions and more are finished backend work
nobody can reach.

Those 65 are a recorded baseline worklist, not an ignore-list: the build fails on any NEW
unreachable route, and also fails if a listed gap gets wired up without being removed from the
list. The number can only go down. It caught its own author's new route within a second of it
being written.

## The four adaptations — DONE

1. **Composite consultation write** (Bahmni's `BahmniEncounterTransaction`) —
   `functions/_wardsynq/consultation.js` plus a new Consultation screen. One save for vitals,
   diagnosis, prescription, test and note. The actor is resolved once and every piece checked
   against their grant *before* anything is written, so "half a consultation" cannot happen from
   a permission failure. A genuine mid-way failure reports what reached the chart, where it
   stopped, and what was never attempted.

2. **Append-only approval chain** (Danphe) — `functions/_wardsynq/verification.js` plus an
   Approvals screen. This closed a **real security hole**, not a hypothetical one: `formulary.js`
   accepted *any non-empty string* as the approval reference that clears a restricted drug, so a
   prescriber blocked by antimicrobial stewardship at 2am could type one character and be
   through. Two existing tests asserted that behaviour, which is how it survived. A reference now
   has to name a real, standing, this-drug approval granted by somebody other than whoever asked.

3. **Purchase order / goods receipt** (Danphe) — `functions/_wardsynq/purchasing.js` plus a
   Purchasing screen. How much has arrived is summed from receipts, never stored. A goods receipt
   is the stock movement `stock.js` already has, not a second ledger. Over-delivery and
   wrong-unit delivery are recorded and named, never silently dropped or refused.

4. **Terminology — DELIBERATELY NOT BUILT AS PLANNED.** The plan called for a concept-mapping
   layer. On reading the code, the external terminology-server validation path *already exists*
   in `terminology.js` and is already wired into the FHIR inbound and `$validate-code` routes.
   What is actually missing is populated ICD/SNOMED/LOINC content, which is a licensing and data
   problem, not a code one — and the audit's own finding was that OpenMRS ships this machinery
   with zero content. Building an empty copy would have been another finished module nobody can
   reach, which is the exact thing Phase 0 exists to prevent. What was built instead is the thing
   that was genuinely missing: diagnosis code lookup on the new consultation screen.

## Bugs found and fixed while building

- A restricted drug could be unlocked with any made-up approval reference (above).
- The consultation form was wiped by its own repaints, including by its own validation messages.
- Its dropdowns snapped back to their first option on repaint — turning "on oxygen" into "not
  recorded", and a NEWS2 score computed from it wrong in the reassuring direction.
- A goods receipt naming line 0 double-counted against every other line holding the same item.
- The purchase-order approval lookup had a ternary whose branches were identical, so an approval
  for a different subject would have read as that order's.
- Render helpers read module state rather than the state passed in, so the screen and the state
  it claimed to show could disagree.

## Still open

The 65 unreachable routes are the real remaining work, and they are now a tracked list rather
than a discovery problem. Phase 2 and Phase 3 above are unchanged.
