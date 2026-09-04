/* wardsynq/wardsynq-safety-case.js — the clinical safety case, as executable evidence.
 *
 * The spec opens with a hazard table and calls it the central assurance contract: hazard, risk,
 * requirement, control, verification, residual risk, sign-off. In most projects that table is a
 * document, it is written once, and it drifts from the software the week after it is signed.
 *
 * Here it is code, and its verification column names REAL TESTS. `assess()` cross-references the
 * declared evidence against a live test run and answers one question per hazard: is the control
 * that this hazard is argued against actually verified right now.
 *
 * The point is the failures. A hazard whose control does not exist yet reports UNCONTROLLED, and a
 * hazard whose control exists but whose named test does not reports NO EVIDENCE. Both are louder
 * here than they would be in a document nobody re-reads, which is the entire reason for the file.
 *
 * WHAT THIS IS NOT. It is not a regulatory submission, it does not compute risk, and a hazard
 * marked VERIFIED means only that the named tests pass. Whether the control is clinically adequate
 * is a judgement for the named approver, and no code can make it.
 *
 * node --test test/wardsynq-safety-case.test.mjs
 * node scripts/wardsynq-assurance.mjs        prints the assurance table against a live test run
 */

/**
 * How far a hazard has actually been engineered against, worst first.
 *
 * PARTIAL exists because of a result this file produced on its first run: HAZ-AI-01 and HAZ-DEV-01
 * came back VERIFIED because their declared tests passed, while their own caveats said no control
 * had been built and nothing ever sets the fields those tests check. A green row for a control that
 * does not exist is worse than no safety case at all, so a control declared partial can never reach
 * VERIFIED however many tests pass. Passing tests raise a partial control to PARTIAL and no higher.
 */
const STATUS = Object.freeze({
  UNCONTROLLED: "uncontrolled", // no control has been built at all
  NO_EVIDENCE: "no-evidence",   // a control exists but nothing verifies it
  FAILING: "failing",           // evidence exists and is currently failing
  PARTIAL: "partial",           // the control only addresses part of the requirement
  VERIFIED: "verified",         // the control is whole and every named test passes
});

/**
 * The hazards, transcribed from the spec's assurance table.
 *
 * `control.module` is null where nothing has been built. `verification.tests` lists test names, or
 * distinctive fragments of them, that constitute the evidence. Empty means no evidence is claimed,
 * which is deliberately different from claiming evidence that does not run.
 */
const HAZARDS = Object.freeze([
  {
    id: "HAZ-MED-01",
    hazard: "Co-prescription of a contraindicated drug pair",
    initialRisk: "catastrophic x occasional",
    requirement: "Commitment of a prescription containing an absolutely contraindicated pair must be prevented without senior intervention.",
    control: {
      kind: "deterministic hard-stop", adequacy: "full",
      module: "wardsynq/wardsynq-safety.js",
      summary: "Pairwise and class-indexed interaction check before commit. A contraindicated finding is dispositioned BLOCK and no override payload can clear it.",
    },
    verification: {
      file: "test/wardsynq-safety.test.mjs",
      tests: [
        "interaction: a contraindicated class-to-generic pair blocks",
        "override: NO override can clear an absolute block",
        "integration: the StewardMD pack loads and finds its own contraindicated pairs",
        "integration: a full evaluation against real data meets the 10 ms p95 budget",
      ],
    },
    residualRisk: "reduced, not eliminated: the pack's coverage is the limit of the control",
    approver: "Chief Medical Officer and Head of Clinical Pharmacy",
    caveat: "Verifies the mechanism. The clinical completeness of the rule pack is a separate question and is not asserted here.",
  },
  {
    id: "HAZ-MED-02",
    hazard: "Drug given to a patient with a documented severe allergy",
    initialRisk: "catastrophic x probable",
    requirement: "Active allergies, cross-class sensitivity and class membership must be checked; a verified severe reaction must be non-overridable.",
    control: {
      kind: "deterministic hard-stop", adequacy: "full",
      module: "wardsynq/wardsynq-safety.js",
      summary: "Direct substance, class membership and documented cross-reactivity are checked. A verified severe reaction is dispositioned BLOCK.",
    },
    verification: {
      file: "test/wardsynq-safety.test.mjs",
      tests: [
        "allergy: a verified severe direct match is an absolute block",
        "allergy: a class-level allergy catches a member drug",
        "allergy: cross-reactivity fires across classes and is weaker evidence than a direct match",
        "integration: the seeded allergy shield works against real drug names",
      ],
    },
    residualRisk: "elevated while the allergy content is unapproved seed data",
    approver: "Clinical Safety Officer and Allergy Committee",
    caveat: "The allergy class and cross-reactivity content is UNAPPROVED seed data. The mechanism is verified; the content is not.",
  },
  {
    id: "HAZ-MED-03",
    hazard: "Lethal medication overdose, paediatric or adult",
    initialRisk: "catastrophic x probable",
    requirement: "Age-specific, weight-based and absolute ceiling checks must be enforced on every order.",
    control: {
      kind: "dosing ceiling guard", adequacy: "full",
      module: "wardsynq/wardsynq-safety.js",
      summary: "Absolute single-dose ceiling blocks; recommended maximum is overridable; a weight-based drug on an unweighed patient refuses rather than passes; paediatric mg/kg is capped at the adult maximum.",
    },
    verification: {
      file: "test/wardsynq-safety.test.mjs",
      tests: [
        "dose: exceeding the absolute ceiling is an absolute block",
        "dose: a weight-based drug with no recorded weight refuses rather than passes",
        "dose: a paediatric mg/kg dose is capped at the adult maximum",
        "dose: a unit mismatch does not silently compare numbers",
        "dosing: the adult maximum caps a weight-based paediatric dose",
        "ADVERSARIAL: a weight-based dose cannot be calculated without a weight",
        "ADVERSARIAL: an implausible weight is caught, because a mistyped weight is invisible once it is arithmetic",
      ],
    },
    residualRisk: "high: the dose table covers eight drugs",
    approver: "Head of Paediatrics and Head of Clinical Pharmacology",
    caveat: "The dose ceiling table is an eight-drug UNAPPROVED seed. Frequency errors, such as a weekly methotrexate dose given daily, are NOT detected by a per-dose ceiling. Paediatric support in wardsynq-paediatrics.js supplies age banding, an adult cap on weight-based ceilings, and a plausibility check on the recorded weight itself, since a mistyped weight is invisible once it has become arithmetic; the paediatric dose CONTENT is still absent and must be supplied per band.",
  },
  {
    id: "HAZ-MED-04",
    hazard: "Wrong-patient, wrong-drug or wrong-dose administration at the bedside",
    initialRisk: "major x probable",
    requirement: "Administration must require positive physical verification of both patient identity and the unit dose.",
    control: {
      kind: "bedside verification gate", adequacy: "full",
      module: "wardsynq/wardsynq-meds.js",
      summary: "Closed-loop state machine where ADMINISTERED is reachable only from SCANNED, a five-rights check where an unscanned wristband or product is a failure rather than a skip, and a second-nurse witness for high-alert products.",
    },
    verification: {
      file: "test/wardsynq-p0-core.test.mjs",
      tests: [
        "emar: a dose can never reach ADMINISTERED without a bedside scan",
        "five rights: each right fails independently on the wrong input",
        "five rights: an unscanned wristband or product is a failure, never a skip",
        "emar: high-alert medication requires an independent second nurse",
        "emar: the audit trail appends on every transition and on every block",
      ],
    },
    residualRisk: "reduced: the gate is structural rather than procedural",
    approver: "Nursing Director and Patient Safety Committee",
    caveat: "No barcode hardware is integrated. The gate is verified against supplied scan values, not against a scanner.",
  },
  {
    id: "HAZ-ID-01",
    hazard: "Acting on the wrong patient's chart",
    initialRisk: "major x probable",
    requirement: "Positive identity must be maintained, and a duplicate or merged record must not silently lose data.",
    control: {
      kind: "identity, reversible merge, and session-bound writes", adequacy: "full",
      module: "wardsynq/wardsynq-mpi.js + wardsynq/wardsynq-actors.js",
      summary: "Probabilistic matching with an explainable breakdown, a name-only candidate that can never auto-link, provisional identities for unidentified arrivals, and a reversible merge that lists conflicts rather than resolving them. Separately, every governed write carries the chart the actor actually had open, and a record whose patient does not match is refused, which is what stops a second tab, a stale form or a mid-write patient switch committing to the wrong aggregate.",
    },
    verification: {
      file: "test/wardsynq-mpi.test.mjs and test/wardsynq-actors.test.mjs",
      tests: [
        "ADVERSARIAL: a write cannot land on a chart the actor does not have open",
        "session: the correct chart still works, and the session cannot be re-pointed",
        "merge", "unmerge", "provisional", "auto",
      ],
      matchMode: "fragment",
    },
    residualRisk: "reduced: cross-chart writes are refused structurally rather than by convention",
    approver: "Chief Medical Information Officer",
    caveat: "IMPLEMENTED and TESTED, not clinically validated or approved. The workstation rebinds its session on every patient switch, and a cross-chart write from the live session was refused with WRONG_CHART in a browser. The binding only protects writes made through a bound session, so an unbound session or a batch handle (asStoreFor) deliberately gets no cross-chart protection and must not be used for charting. Positive identification at the bedside still depends on scan hardware that is not integrated.",
  },
  {
    id: "HAZ-DOWN-01",
    hazard: "Clinical data lost or silently overwritten",
    initialRisk: "catastrophic x occasional",
    requirement: "Charting must survive interruption, and no write may silently overwrite another.",
    control: {
      // Both halves are now closed. This sat at PARTIAL while the journal was in memory, because a
      // workstation losing power mid-outage took the charting with it; the durable journal is what
      // moved it, not a change to the criteria.
      kind: "append-only store, durable journal, three-way reconciliation", adequacy: "full",
      module: "wardsynq/wardsynq-store.js + wardsynq/wardsynq-offline.js",
      summary: "Every write creates a new version and keeps all prior ones; transactions are all-or-nothing; reads and writes are deep-copied. Offline edits go to a DURABLE append-only journal, and record() does not resolve until the entry has reached storage, so a UI can never report a note saved that was not. A failed write reports failure and is not held in memory. On reconnection, edits are compared three-way against the ancestor they were derived from: only disjoint field changes combine automatically, anything signed or administered is never folded into, and the same field changed on both sides becomes a CONFLICT carrying both versions and the ancestor. A conflict cannot be resolved without a named clinician and a rationale, the discarded version is kept, and unresolved conflicts stay in the journal across a restart.",
    },
    verification: {
      file: "test/wardsynq-store.test.mjs and test/wardsynq-offline.test.mjs",
      tests: [
        "ADVERSARIAL: the same field changed on both sides is a CONFLICT, never last-write-wins",
        "ADVERSARIAL: a signed record is never folded into, even when the fields are disjoint",
        "ADVERSARIAL: an administered record is never folded into",
        "ADVERSARIAL: a conflict is never written to the store by reconciliation",
        "ADVERSARIAL: a conflict cannot be resolved without a person and a reason",
        "resolution: the discarded version is kept on the record",
        "reconnect: a hundred offline edits all survive to a decision",
        "durability: an edit is on disk BEFORE record() resolves",
        "durability: a failed write does NOT report success, and is not held in memory",
        "durability: charting survives the workstation dying mid-outage",
        "durability: restored charting reconciles normally",
        "durability: reconciled entries leave the journal, unresolved conflicts stay",
        "durability: a corrupted row is skipped rather than poisoning the restore",
        "version", "history", "transaction", "deep",
      ],
      matchMode: "fragment",
    },
    residualRisk: "reduced: charting survives a power cut and no write silently overwrites another",
    approver: "Chief Information Officer and Disaster Committee",
    caveat: "IMPLEMENTED and TESTED, not clinically validated or approved. The workstation now journals to IndexedDB while offline and reconciles on reconnect, driven end to end in a browser: an order signed during a simulated outage was held durably, was still there when a fresh journal was opened over the same store (which is the restart case), and reconciled cleanly when the network returned. REMAINING GAP: a service worker, so the app itself LOADS without a network, is separate from data survival and is not built. A ward that reboots a workstation mid-outage keeps its charting but cannot open the app until the network returns.",
  },
  {
    id: "HAZ-DIAG-01",
    hazard: "An unacknowledged critical result",
    initialRisk: "catastrophic x probable",
    requirement: "A critical value must force acknowledgement and escalate on a timer if it is not acknowledged.",
    control: {
      kind: "closed-loop notification with time-driven escalation", adequacy: "full",
      module: "wardsynq/wardsynq-critical.js",
      summary: "Deterministic classification against a site threshold pack; the responsible clinician is identified; dispatch, delivery, viewing, acknowledgement and a documented action are separate states none of which may be skipped; timestamps are server-assigned so an acknowledgement cannot be backdated; escalation tiers are driven by a monitor and cannot be suppressed by any payload; an append-only ledger names an actor for every clinical act.",
    },
    verification: {
      file: "test/wardsynq-critical.test.mjs",
      tests: [
        "ADVERSARIAL: a result that was never delivered cannot be acknowledged",
        "ADVERSARIAL: a loop cannot be closed without an acknowledgement",
        "ADVERSARIAL: acknowledgement alone does not close the loop",
        "ADVERSARIAL: a clinician with no relationship to the patient cannot acknowledge",
        "ADVERSARIAL: a caller cannot backdate an acknowledgement to dodge escalation",
        "ADVERSARIAL: escalation cannot be suppressed by any payload",
        "ADVERSARIAL: the ledger cannot be rewritten through a handed-out view",
        "escalation: viewing does NOT stop escalation, acknowledging does",
        "monitor: a pump escalates every live loop that has become due",
        "loop: a source system's flag can never CLOSE or suppress a loop",
        "audit: the ledger records the whole loop and every entry is timestamped and attributed",
        "integration: every state change is persisted to the append-only store",
        "ADVERSARIAL: a child's potassium is NOT classified against the adult limit",
        "ADVERSARIAL: a neonate with no gestational age is refused before any number is compared",
        "ADVERSARIAL: a patient of unknown age is refused, not assumed adult",
        "ADVERSARIAL: an unassessable result RAISES a loop instead of vanishing",
        "ADVERSARIAL: an escalation whose channel reports failure is NOT recorded as sent",
        "ADVERSARIAL: an escalation with no channel at all is recorded as undelivered, not skipped",
      ],
    },
    residualRisk: "reduced: the loop is structural, but its thresholds and channels are site-supplied",
    approver: "Head of Laboratory Medicine and ICU Director",
    caveat: "IMPLEMENTED and TESTED, not clinically validated or approved. The threshold pack is UNAPPROVED seed content and still contains ADULT limits only, but a paediatric result is now REFUSED rather than judged against them: the classifier resolves an age band and declines to apply an unbanded range to a child, a neonate with no gestational age, or a patient of unknown age. A refused result RAISES a loop marked unassessable rather than falling through as normal, because declining to judge a child's potassium and telling nobody is at least as dangerous as judging it wrongly. Paediatric limits themselves still have to be supplied and signed by a paediatrician. No real notification channel is integrated: delivery is only as real as the channel adapter a site supplies, and a site that wires none gets NO_CHANNEL rather than silent success. A defect found while unifying this with the deterioration monitor: the ESCALATION path awaited its channel and ignored the result, so a channel reporting failure was recorded as though the consultant had been told and a missing channel was skipped in silence. Both paths now share one definition of delivery in wardsynq-notify.js.",
  },
  {
    id: "HAZ-BLD-01",
    hazard: "Transfusion of an ABO or Rh incompatible unit",
    initialRisk: "catastrophic x rare",
    requirement: "Release and bedside infusion must enforce verified crossmatch compatibility.",
    control: {
      kind: "compatibility and two-person bedside gate", adequacy: "full",
      module: "wardsynq/wardsynq-transfusion.js",
      summary: "ABO and RhD compatibility in code because it is immutable biology, with red cell and plasma tables kept separate because plasma is the inverse; a crossmatch binds one unit to one patient; the bedside check requires two different named people, a scanned wristband, a scanned unit, and RE-DERIVES compatibility from the physical bag rather than trusting the crossmatch record; expired units are refused; a reaction stops the episode terminally; every step is on an append-only ledger and a unit is traceable to every patient it touched.",
    },
    verification: {
      file: "test/wardsynq-transfusion.test.mjs",
      tests: [
        "compatibility: the full red cell matrix is exactly right",
        "compatibility: plasma is the INVERSE of red cells, and the module does not confuse them",
        "compatibility: an undetermined group on either side is never compatible",
        "ADVERSARIAL: an incompatible unit cannot be crossmatched, whatever the caller wants",
        "ADVERSARIAL: the right unit at the WRONG patient's bedside is refused",
        "ADVERSARIAL: a unit crossmatched for someone else cannot be given here",
        "ADVERSARIAL: a mislabelled unit is caught by re-reading the bag, not by trusting the paperwork",
        "ADVERSARIAL: a single person cannot complete the bedside check",
        "ADVERSARIAL: one person cannot be both checkers",
        "ADVERSARIAL: an expired unit is refused at the bedside",
        "ADVERSARIAL: a transfusion cannot start without a passed bedside check",
        "reaction: a suspected reaction stops the transfusion terminally",
        "traceability: a unit can be traced to every patient it ever touched",
        "ADVERSARIAL: a failed crossmatch is still persisted, so refusals are auditable",
      ],
    },
    residualRisk: "reduced for ABO and RhD and for bedside identity; unaddressed for everything else in transfusion practice",
    approver: "Blood Bank Director and Transfusion Safety Officer",
    caveat: "IMPLEMENTED and TESTED, not clinically validated or approved. ABO and RhD only. NOT modelled: antibody screening and identification beyond ABO/RhD, phenotype matching, special requirements such as irradiated, washed or CMV-negative, massive transfusion and emergency uncrossmatched protocols, neonatal transfusion, and platelet-specific rules. Platelets are explicitly REFUSED rather than guessed. No barcode hardware is integrated, so the bedside gate is verified against supplied scan values rather than a scanner.",
  },
  {
    id: "HAZ-SURG-01",
    hazard: "Wrong-patient, wrong-site or wrong-procedure surgery",
    initialRisk: "catastrophic x rare",
    requirement: "Incision must be gated behind signed WHO Surgical Safety Checklist milestones.",
    control: {
      kind: "checklist gate on incision", adequacy: "full",
      module: "wardsynq/wardsynq-surgical.js",
      summary: "Incision is unreachable until Sign In and Time Out are complete, where complete means every required item explicitly confirmed and three DIFFERENT people signing as surgeon, anaesthetist and nurse. The side is declared once at booking and re-asserted independently at marking, Sign In and Time Out, each compared to the BOOKING so an early error cannot propagate by agreement. Consent must match procedure and side. Sign Out cannot close over incorrect counts, and an operative record is refused while any milestone is outstanding.",
    },
    verification: {
      file: "test/wardsynq-surgical.test.mjs",
      tests: [
        "ADVERSARIAL: incision is locked without a Sign In",
        "ADVERSARIAL: incision is locked without a Time Out, even with a perfect Sign In",
        "ADVERSARIAL: one person cannot sign every role",
        "ADVERSARIAL: two people cannot cover three roles",
        "ADVERSARIAL: a missing role blocks the phase",
        "ADVERSARIAL: the site cannot be marked on the wrong side",
        "ADVERSARIAL: an early laterality error cannot propagate by agreement down the chain",
        "ADVERSARIAL: Time Out on the wrong side stops the case even after a correct Sign In",
        "ADVERSARIAL: consent for the other side is not consent",
        "ADVERSARIAL: an unconfirmed checklist item blocks the phase",
        "ADVERSARIAL: an item is not confirmed by anything other than an explicit true",
        "ADVERSARIAL: an operative record cannot paper over a bypassed checklist",
        "ADVERSARIAL: sign out cannot complete while counts are wrong",
        "governance: cases that reached the knife without a complete checklist are reportable",
      ],
    },
    residualRisk: "reduced: the gate is structural, and the laterality chain is compared to the booking at every step",
    approver: "Head of Surgery and Head of Anaesthesiology",
    caveat: "IMPLEMENTED and TESTED, not clinically validated or approved. The enforced item set is shorter than the full WHO checklist and than most local variants: implant and prosthesis checks, fire risk, VTE prophylaxis, glycaemic control and specimen chain of custody beyond labelling are NOT modelled. A completed checklist here is not equivalent to a site's own approved checklist.",
  },
  {
    id: "HAZ-AI-01",
    hazard: "An AI-authored medication, dose or clinical history reaching the record",
    initialRisk: "catastrophic x occasional",
    requirement: "AI output must be confined to draft status and must never commit without a clinician signature.",
    control: {
      kind: "capability ceiling enforced at the write path", adequacy: "full",
      module: "wardsynq/wardsynq-actors.js",
      summary: "A four-tier ladder where the ceiling is a property of the actor's KIND, not its configuration: no AI, device, adapter or service actor can hold EXECUTE, and a requested tier above the ceiling is clamped at construction on a frozen object. A signature is an act rather than a string: only a credentialed human writing as themselves may set signedBy. AI provenance is stamped by the store rather than policed, so it cannot be evaded by omitting or misspelling the claim. Every denial is recorded and announced as a governance event.",
    },
    verification: {
      file: "test/wardsynq-actors.test.mjs",
      tests: [
        "ADVERSARIAL: an AI cannot commit an active order",
        "ADVERSARIAL: an AI cannot forge a clinician signature",
        "ADVERSARIAL: an AI cannot reach EXECUTE by any status wording",
        "ADVERSARIAL: an AI cannot disguise its output as human-authored",
        "ADVERSARIAL: an actor cannot be promoted after it is issued",
        "ADVERSARIAL: an unrecognised actor kind gets no permissions at all",
        "ADVERSARIAL: a clinician cannot sign as somebody else",
        "ADVERSARIAL: a human without a credential cannot sign",
        "ADVERSARIAL: an unauthenticated write is refused outright",
        "ADVERSARIAL: a caller cannot spoof provenance by supplying writtenBy",
        "actors: every non-human kind is capped below EXECUTE",
        "the intended path: an AI drafts, a clinician signs, and the record shows both",
        "audit: every denial is recorded and announced as a governance event",
        "ADVERSARIAL: a hand-built AI actor claiming EXECUTE does not hold it",
        "ADVERSARIAL: a forged actor cannot commit an active record",
        "a deserialised actor behaves exactly like a constructed one",
        "every non-human kind is capped at the check, not just AI",
        "ADVERSARIAL: the injection SUCCEEDS COMPLETELY and still cannot commit anything",
        "ADVERSARIAL: an UNSIGNED document does not enter the context at all",
        "ADVERSARIAL: an output naming another patient is WITHHELD WHOLE, not redacted",
        "ADVERSARIAL: a shadow prediction cannot be shown to a clinician",
        "ADVERSARIAL: a breach WITHDRAWS the model rather than raising a ticket",
      ],
    },
    residualRisk: "reduced: the ceiling is structural and cannot be configured away",
    approver: "AI Clinical Governance Committee",
    caveat: "IMPLEMENTED and TESTED, not clinically validated or approved. The workstation now writes ONLY through a governed session, verified in a browser: a signed order carries a writtenBy stamp that only GovernedStore applies, and reconciliation was moved onto a governed handle after wiring exposed that it had been writing to the raw store with no actor. DEPLOYMENT REQUIREMENT that still stands for everything else: this governs writes that pass through GovernedStore, and any future surface or service that is handed the underlying ClinicalStore has enforced nothing, in the same way an API is not a control if the database is also exposed. A REAL DEFECT WAS FOUND IN THIS CONTROL while building wardsynq-secops.js, and it sat inside a row already marked VERIFIED: the AI ceiling was clamped in makeActor() and can() then trusted actor.tier, so any actor object that reached the check without passing through the factory held whatever tier it claimed. That is not an exotic path: an actor gets hand-built, deserialised from storage, or rebuilt across a process boundary as a matter of course. A ceiling enforced only at construction assumes every path went through the door. The ceiling is now re-applied inside can() itself and five regression tests hold it. wardsynq-secops.js adds structural isolation for AI reading the record: retrieved content is fenced with a per-request nonce and labelled untrusted, unsigned documents do not enter the context, and outputs naming another patient are withheld WHOLE rather than redacted. It does NOT claim to prevent prompt injection, and says so: the design assumption is that injection succeeds and the blast radius is bounded by the ceiling, which the model does not control. The document signing is a content DIGEST for tamper detection, explicitly not a cryptographic signature, and must be replaced by one. wardsynq-mlops.js gates any model on prospective shadow evidence rather than retrospective numbers, blocks on a subgroup gap however good the aggregate, and withdraws a breaching model automatically rather than raising a ticket.",
  },
  {
    id: "HAZ-DEV-01",
    hazard: "Corrupted or misattributed device telemetry",
    initialRisk: "major x occasional",
    requirement: "Telemetry must be positively associated with a patient, and artefacts excluded from automated scores.",
    control: {
      kind: "gateway with positive association and derived artefact", adequacy: "full",
      module: "wardsynq/wardsynq-iomt.js",
      summary: "A reading from an unassociated device is REFUSED rather than queued or attributed by bed. Association requires scanning both the patient's wristband and the device's asset tag, and moving a monitor explicitly ends the previous claim so no chart has two live claims on one device. Artefact is DERIVED from signal quality and physiological plausibility and cannot be overridden by a payload asserting its own data is clean. An implausible value is marked but never discarded. Clock skew is marked, never silently corrected. `scoreable()` is the supported entry point for anything automated.",
    },
    verification: {
      file: "test/wardsynq-iomt.test.mjs",
      tests: [
        "ADVERSARIAL: a reading from an unassociated device is REFUSED, not queued or guessed",
        "ADVERSARIAL: association requires BOTH scans, not a bed number",
        "ADVERSARIAL: moving a monitor to another bed does not keep charting to the old patient",
        "ADVERSARIAL: a reading cannot name its own patient",
        "ADVERSARIAL: a device cannot assert that its own data is clean",
        "quality: a missing signal quality is treated as unverified, not as good",
        "quality: a physiologically implausible value is marked but NEVER discarded",
        "scores: the filter is the supported entry point and excludes every flagged reading",
        "clock: skew beyond tolerance is marked, and the device's own time is not rewritten",
        "connectivity: a silent device is reported as disconnected",
        "ADVERSARIAL: a device observation excluded as artifact never reaches the score",
        "a device observation that passed the quality filter IS scored",
      ],
    },
    residualRisk: "reduced: attribution is structural and artefact is derived rather than asserted",
    approver: "Biomedical Engineering Director and Nursing Director",
    caveat: "IMPLEMENTED and TESTED, not clinically validated or approved. NOT modelled: PTP or NTP synchronisation itself (skew is detected, never corrected), waveform-level analysis, device firmware and calibration registries, and forwarding of the device's own alarms. Plausibility bounds are engineering limits for catching a detached lead, not clinical limits, and are deliberately far wider than any critical threshold. No barcode hardware is integrated, so association is verified against supplied scan values rather than a scanner. The spec's verification for this hazard names artefact exclusion from automated NEWS2 calculations; until wardsynq-deterioration.js existed there was no such calculation and that scenario was asserted rather than exercised. It is now exercised in both directions, and building it exposed a real defect: scoreEligible was bolted onto the observation after construction and was therefore dropped by the canonical model, which would have silently excluded every device reading from every automated score. It is now a modelled field.",
  },
  {
    id: "HAZ-DET-01",
    source: "LOCAL: not transcribed from the spec's assurance table. Added because failure to rescue is the largest avoidable category of inpatient death and the spec's table has no row for it. It is declared here so the gap is visible rather than absent.",
    hazard: "Unrecognised or unanswered clinical deterioration (failure to rescue)",
    initialRisk: "catastrophic x probable",
    requirement: "Deterioration must be scored from complete, current, non-artefactual observations; a score that cannot be computed must not read as reassuring; and an escalation nobody answers must escalate itself.",
    control: {
      kind: "early warning score with closed-loop escalation",
      // PARTIAL, and it stays partial until the escalation reaches a real human by a real channel.
      // A monitor that raises a correct escalation into an in-memory Map has not rescued anybody.
      adequacy: "partial",
      module: "wardsynq/wardsynq-deterioration.js",
      summary: "NEWS2 over observations that have passed the IoMT quality filter. A missing parameter makes the score INCOMPLETE rather than scoring zero; a stale observation is rejected rather than treated as current; Scale 2 requires a recorded prescription; a single parameter at its extreme escalates even when the total is low; children and pregnant patients are refused rather than approximated. Escalations carry the observation ids they were derived from, and an unanswered escalation re-escalates to a responder strictly above the one that ignored it.",
    },
    verification: {
      file: "test/wardsynq-deterioration.test.mjs",
      tests: [
        "ADVERSARIAL: a missing respiratory rate does NOT score zero",
        "ADVERSARIAL: a dangerously ill patient with one missing parameter is unscorable, not reassuring",
        "ADVERSARIAL: an unrecorded oxygen field is missing, not 'on air'",
        "ADVERSARIAL: a stale observation does not describe the patient now",
        "ADVERSARIAL: Scale 2 cannot be applied without a recorded prescription",
        "ADVERSARIAL: a total of 3 from ONE parameter outranks a total of 3 spread across three",
        "ADVERSARIAL: NEWS2 is refused for a child rather than approximated",
        "ADVERSARIAL: NEWS2 is refused in pregnancy, where the normal ranges move",
        "ADVERSARIAL: an UNSCORABLE patient is escalated too, not quietly skipped",
        "ADVERSARIAL: an escalation nobody answers re-escalates itself",
        "ADVERSARIAL: acknowledgement is not review, and does not stop the clock",
        "every score carries the observations it was derived from",
        "ADVERSARIAL: a monitor with NO channel refuses to raise rather than raising into a void",
        "ADVERSARIAL: a webhook returning 200 is SENT, and is NOT delivery",
        "ADVERSARIAL: DELIVERED is not SEEN, and only a human closes the loop",
        "ADVERSARIAL: outstanding INCLUDES the delivered ones, because that is the dangerous state",
        "ADVERSARIAL: the notice is in the outbox BEFORE any transport is touched",
        "ADVERSARIAL: a channel that has never succeeded is UNVERIFIED, not healthy",
        "ADVERSARIAL: the sweeps that nothing was calling now get called",
        "ADVERSARIAL: one throwing monitor does not stop the others",
        "ADVERSARIAL: a channel that throws is a FAILED attempt, not a delivered one",
        "ADVERSARIAL: a channel that returns nothing has confirmed nothing",
      ],
    },
    residualRisk: "high: the score is computed and the escalation is raised, but nothing yet delivers it",
    approver: "Resuscitation Committee and Director of Nursing",
    caveat: "PARTIAL, and the reason has changed. wardsynq-transport.js now ships the transport seam: a durable outbox written BEFORE any channel is attempted, a failover ladder that stops at the first CONFIRMED delivery rather than the first non-throw, three working adapters that need no vendor (an in-app ward station queue, browser notifications, an HTTP webhook), and a SweepDriver, which closes the separate defect that every monitor's sweep() was correct and nothing called it on a timer. It also separates SENT from DELIVERED from SEEN, and only a named human acknowledging moves a notice to SEEN, so a notice that reached a device and no person stays OUTSTANDING however many transports reported success. WHAT KEEPS IT PARTIAL: no REAL transport is integrated. There is no pager, no SMS gateway and no phone system in this build, because those need a vendor, credentials and a contract. Every shipped adapter reaches only somebody already looking at a screen. A site must wire a real channel and PROVE it with verify(), and until a channel has carried a test message it is reported as UNVERIFIED rather than as available, because an integration that broke three weeks ago looks exactly like one that works. The NEWS2 parameter bands are the RCP's published 2017 chart rather than seed content, but the ESCALATION POLICY attached to them (response windows and responder tiers) is UNAPPROVED and belongs to the resuscitation committee. NOT modelled: PEWS, so children are refused rather than scored. MEOWS is now modelled (wardsynq-obstetrics.js) and the obstetric refusal points at it; qSOFA and the sepsis bundle are modelled in wardsynq-emergency.js and are argued under HAZ-TIME-01, not here. Not clinically validated and not clinically approved.",
  },
  {
    id: "HAZ-TIME-01",
    source: "LOCAL: not transcribed from the spec's assurance table. The spec names wardsynq-emergency.js in its P1 file list but writes no hazard row for it. Declared here so the gap is visible rather than absent.",
    hazard: "Delayed time-critical treatment, and falsified bundle timing",
    initialRisk: "catastrophic x probable",
    requirement: "For a time-critical bundle the origin must be immutable, an element must count only when it was actually done rather than ordered, and a passed target must remain passed.",
    control: {
      kind: "immutable-origin bundle clock",
      // PARTIAL. The timing control is whole and adversarially tested. What is missing is the
      // trigger: nothing yet turns a positive screen or a NEWS2 escalation into a started bundle,
      // so a bundle exists only where a human already knew to open one -- which is exactly the
      // population that was least likely to be missed.
      adequacy: "partial",
      module: "wardsynq/wardsynq-emergency.js",
      summary: "Time zero is set once and is non-writable and non-configurable; it cannot be in the future and cannot precede the evidence that triggered it. A wrong origin is corrected only by voiding with a mandatory reason, leaving both bundles on the record. An element completes on its own named event, so an order is refused where an administration is required. Breach outranks completion, and status is recomputed from the immutable origin rather than stored. qSOFA reports NOT-POSITIVE rather than negative and states in words that it does not exclude sepsis; an incomplete screen that has not already reached two criteria cannot be reported as not-positive at all. The arrest clock gives intervals and deliberately carries no dose. wardsynq-recognition.js supplies the trigger: a positive qSOFA or a high NEWS2 raises a PROMPT to a named human rather than opening a bundle, since a screen is not a diagnosis. Accepting a prompt pins the bundle's time zero to the moment the machine knew, refused in BOTH directions, so the clock starts at recognition and not at whenever somebody got round to opening the bundle. Declining requires a clinical reason, an unanswered prompt escalates, and the delay between machine and human is reported as a number. wardsynq-bundle-binding.js completes elements from real eMAR administrations, so an antibiotic element can be anchored to a bedside wristband and product scan rather than to a claim, carrying the eMAR's own administration time so automation cannot make a bundle look faster. Manual completion stays possible, because a system that refuses to record what a team did is abandoned mid-resuscitation, but the two are kept apart as DERIVED and ATTESTED and reported separately.",
    },
    verification: {
      file: "test/wardsynq-emergency.test.mjs",
      tests: [
        "ADVERSARIAL: time zero cannot be reassigned, by anyone, ever",
        "ADVERSARIAL: time zero cannot be in the future",
        "ADVERSARIAL: time zero cannot precede the evidence that triggered it",
        "ADVERSARIAL: an element cannot be recorded as happening before time zero",
        "ADVERSARIAL: ordering an antibiotic is not administering it",
        "ADVERSARIAL: there is no path that turns a breached bundle back into a compliant one",
        "ADVERSARIAL: a qSOFA that is not met NEVER excludes sepsis",
        "ADVERSARIAL: an incomplete screen cannot be reported as not-positive",
        "ADVERSARIAL: qSOFA is refused for a child rather than approximated",
        "ADVERSARIAL: a screen cannot open a bundle by itself",
        "ADVERSARIAL: a monitor with no channel refuses to open a bundle",
        "ADVERSARIAL: an undelivered breach notice says so on the bundle's own record",
        "a wrong time zero is corrected by VOIDING and reopening, and both stay on the record",
        "the clock reads the administration, so an antibiotic ordered early and hung late is late",
        "the arrest clock says what is due and never what to give",
        "ADVERSARIAL: accepting a prompt makes it impossible to back-date the bundle past it",
        "ADVERSARIAL: raisedAt and evidenceAt cannot be reassigned",
        "ADVERSARIAL: declining requires a clinical reason",
        "ADVERSARIAL: an UNSCORABLE patient is not turned into suspected sepsis",
        "ADVERSARIAL: a queue with no channel refuses to raise",
        "an unanswered prompt goes overdue and escalates, once",
        "a bundle opened from an accepted prompt carries the prompt id, so the chain is traceable",
        "ADVERSARIAL: a bedside scan, and only a bedside scan, completes the antibiotic element",
        "ADVERSARIAL: a derived completion carries the eMAR's time, not the processing time",
        "ADVERSARIAL: an administration BEFORE time zero belongs to an earlier episode",
        "ADVERSARIAL: a manually completed element is ATTESTED and is never called derived",
        "ADVERSARIAL: the roll-up exposes a unit that is compliant on paperwork",
        "another patient's antibiotic never completes this patient's bundle",
        "ADVERSARIAL: a NORMAL lactate counts, because the element is 'measure it'",
        "ADVERSARIAL: the element anchors to when the sample was RESULTED, not when we saw it",
        "ADVERSARIAL: a bundle can now be MOSTLY derived rather than mostly attested",
      ],
    },
    residualRisk: "moderate: medication and laboratory elements can be evidenced, but nothing delivers the prompt and a bundle may still be compliant on attestation alone",
    approver: "Chief Medical Officer, Resuscitation Committee and Sepsis Lead",
    caveat: "PARTIAL. The original reason has been closed: wardsynq-recognition.js now prompts a named human on a positive screen or a high NEWS2, so the control no longer applies only to patients somebody had already recognised, and building it exposed a real hole in the timing guard. Time zero was protected against being moved EARLIER than its evidence and not against being moved LATER, which is the direction that is actually gamed, because moving it forward is what turns a two-hour wait into a compliant one-hour bundle. An accepted prompt now pins it in both directions. A second reason has now also been closed: bundle elements can be DERIVED from real eMAR administrations rather than asserted, and building that exposed a defect in the canonical model, where a MedicationAdministration recorded only its order id and so could not say what drug was given without the order still being fetchable. Laboratory and imaging elements can now be derived too, from a result.finalized event emitted BEFORE classification so that a reassuring lactate is as visible as an alarming one. What keeps this PARTIAL: attestation is still permitted, deliberately, so a bundle can be compliant on claims alone and only provenanceReport() will say so; elements that are purely human acts with no observing system, such as taking blood cultures, can never be more than attested; and, reduced but not closed by wardsynq-transport.js, which now supplies the delivery seam, the durable outbox and the sweep driver while integrating no real pager, SMS or phone system: no notification transport (channels are functions a site supplies and none are shipped), the monitor sweep is caller-driven, and there is no link from a bundle to the medication or order modules, so 'antibiotics administered' is asserted by whoever records it rather than derived from an eMAR administration. Bundle elements and targets are the published Surviving Sepsis and ACLS intervals; the local policy attached to them is UNAPPROVED. NOT modelled: the ACLS algorithm, drug doses, STEMI ECG interpretation, paediatric arrest. Not clinically validated and not clinically approved.",
  },
  {
    id: "HAZ-MAT-01",
    source: "LOCAL: not transcribed from the spec's assurance table, which has no obstetric row. Added because NEWS2 correctly REFUSES pregnant and postpartum patients, and a refusal with nothing behind it leaves the refused population less protected than before, not more.",
    hazard: "Unrecognised maternal deterioration, and haemorrhage judged by eye",
    initialRisk: "catastrophic x occasional",
    requirement: "A pregnant or recently delivered woman must be assessed on an obstetric chart rather than a general one, the assessment must not be readable as a reassuring total, and blood loss must not be treated as measured when it was estimated.",
    control: {
      kind: "trigger-based obstetric chart with measurement discipline",
      // FULL for what it claims. It claims detection and measurement discipline, not treatment: no
      // dosing, no fetal monitoring, and the bundles it defines run on the emergency module's clock
      // whose own limits are declared under HAZ-TIME-01 rather than re-declared here.
      adequacy: "full",
      module: "wardsynq/wardsynq-obstetrics.js",
      summary: "MEOWS is TRIGGER-based and returns no total at all, because summing lets one catastrophic parameter hide behind several normal ones. One red trigger, or two concurrent yellows, alerts; a missing parameter never suppresses a red one. Pregnancy is a state with a postpartum day rather than a boolean, so the guard covers the puerperium, where most haemorrhage deaths happen. Every result, including the ones with no triggers, carries the compensation warning: she can lose 1.5 litres with a normal blood pressure, and absence of triggers is not evidence that she is well. A visual blood-loss estimate is kept as an observation and REFUSED as a measurement, so a volume threshold returns unknown rather than false. The chart is built through the same gatherer as NEWS2, so stale and artefactual observations cannot reach it. No bundle element carries a drug dose, asserted by a test.",
    },
    verification: {
      file: "test/wardsynq-obstetrics.test.mjs",
      tests: [
        "ADVERSARIAL: there is no total anywhere in the result to be read as reassuring",
        "ADVERSARIAL: ONE red trigger is an alert, however normal everything else is",
        "ADVERSARIAL: a missing parameter does NOT suppress a red trigger",
        "ADVERSARIAL: the compensation warning is attached to EVERY result, including the calm ones",
        "ADVERSARIAL: risk does not end at delivery, it peaks there",
        "ADVERSARIAL: a visual estimate is an observation and never a measurement",
        "ADVERSARIAL: a threshold cannot be decided on a visual estimate",
        "ADVERSARIAL: an untrustworthy visual estimate PROMPTS rather than waiting for certainty",
        "ADVERSARIAL: no bundle element carries a magnesium dose",
        "ADVERSARIAL: a stale blood pressure does not become a current MEOWS parameter",
        "ADVERSARIAL: a detached lead never reaches the obstetric chart either",
        "ADVERSARIAL: the obstetric refusal covers the POSTPARTUM woman, not just the pregnant one",
        "a pregnant adolescent is flagged rather than silently scored or silently refused",
        "the obstetric bundles inherit every timing guarantee rather than growing a second clock",
      ],
    },
    residualRisk: "reduced for detection and measurement; unchanged for everything downstream of recognising her",
    approver: "Clinical Director of Obstetrics and Head of Midwifery",
    caveat: "IMPLEMENTED and TESTED, not clinically validated or approved. THE TRIGGER CUT-OFFS ARE UNAPPROVED and this matters more here than elsewhere: MEOWS charts differ substantially between units, and a chart with the wrong cut-offs is worse than no chart because it is trusted. The obstetric lead owns these values. NOT modelled: fetal monitoring and CTG interpretation of ANY kind, which is a large and separate hazard this file does not touch and must not be read as covering; labour progress, shoulder dystocia and other intrapartum emergencies; amniotic fluid embolism; pregnancy-specific sepsis scoring; gestational diabetes. NO DOSING of any kind, and magnesium sulphate deliberately so: the window between anticonvulsant effect and respiratory arrest is narrow and an unapproved regimen here would be a direct route to a maternal death. The bundles run on the emergency module's clock and inherit its limits, declared under HAZ-TIME-01: no notification transport is shipped and no element is derived from a real eMAR administration.",
  },
  {
    id: "HAZ-FLUID-01",
    source: "LOCAL: not transcribed from the spec's assurance table, which has no row for the flowsheet. Added because ICU prescribing is done off running totals rather than individual cells, and a total looks equally authoritative whether or not the hours underneath it are complete.",
    hazard: "Fluid or vasoactive therapy prescribed from an incomplete or miscomputed flowsheet total",
    initialRisk: "major x probable",
    requirement: "A running total must report its own completeness and name what is missing; an infusion volume must be integrated over its rate history; a weight-based rate must refuse to compute without a weight.",
    control: {
      kind: "arithmetic honesty on the hourly chart",
      // PARTIAL for one specific reason, stated in the caveat: a correction tells the person making
      // it that later totals are now wrong, and tells nobody who already acted on them.
      adequacy: "partial",
      module: "wardsynq/wardsynq-flowsheet.js",
      summary: "A missing hour is never zero: every balance names the hours nobody charted and states that the true figure differs by exactly that amount. An hour with intake charted and output blank is not a complete hour. An infusion volume is the rate history integrated over time rather than the current rate multiplied by elapsed time, which under-reports a weaned vasopressor. A weight-based rate refuses without a weight and flags an implausible one, because every mcg/kg/min in the unit is multiplied by it. SET and MEASURED are different kinds rather than a flag, so a set PEEP of 8 against a measured 12 is visible. observedAt and chartedAt are both mandatory, and an entry charted late is marked BACKFILLED by computation rather than by declaration. A correction supersedes rather than overwrites, so the chart can still show what a clinician saw.",
    },
    verification: {
      file: "test/wardsynq-flowsheet.test.mjs",
      tests: [
        "ADVERSARIAL: three unchared hours do NOT silently become zero",
        "ADVERSARIAL: an hour with intake charted and output blank is NOT a complete hour",
        "ADVERSARIAL: an infusion volume is an INTEGRAL, not the current rate times elapsed time",
        "ADVERSARIAL: a weight-based rate cannot be calculated without a weight",
        "ADVERSARIAL: an implausible weight is flagged, because every rate is multiplied by it",
        "ADVERSARIAL: a set PEEP and a measured PEEP that disagree is the finding",
        "ADVERSARIAL: observedAt and chartedAt are BOTH required",
        "ADVERSARIAL: a late entry is marked BACKFILLED, and the mark is computed not declared",
        "ADVERSARIAL: a correction supersedes rather than overwrites, and says what it invalidated",
        "ADVERSARIAL: an empty cell stays empty and is counted, never rendered as a zero",
        "a corrected entry is excluded from the total and its replacement included",
        "a balance over an empty window reports every hour missing rather than a tidy zero",
        "ADVERSARIAL: a correction reports exactly which cumulative totals changed",
        "ADVERSARIAL: a total that CROSSES zero is flagged, because that is a different patient",
        "ADVERSARIAL: the recomputation states the thing it CANNOT do",
      ],
    },
    residualRisk: "reduced: the total is now honest about itself. Unchanged: nothing stops anyone prescribing from it, and nobody is told when a correction invalidates what they already read",
    approver: "Clinical Director of Intensive Care and Lead ICU Pharmacist",
    caveat: "PARTIAL, for one specific reason. When a charted value is corrected, the correction tells the person MAKING it that every cumulative total after that hour is now wrong and that somebody may have acted on it. It tells nobody who actually did. recomputeAfterCorrection() now closes half of this: it reports exactly which cumulative totals changed, by how much, and flags the case that is not merely arithmetic, where a balance crosses a line somebody prescribes against, so a patient who read negative and now reads positive is stated as that rather than as '360 mL smaller'. What remains open is the half that matters most: a consultant who prescribed diuresis at 06:00 off a balance containing a urine output of 400 mL that was really 40 mL is still not notified when it is fixed at 08:00, because NOTHING IN THIS BUILD RECORDS THAT A TOTAL WAS READ. Closing it needs a view log, which does not exist, and the function says so in its own output rather than letting its absence imply otherwise. Also unbuilt: nothing gates prescribing on an incomplete balance, deliberately, because a system that blocked a consultant from reading a partial total would be worked around by adding it up on paper, but that means the honesty is advisory. NOT modelled: ventilator waveforms, the pump and ventilator protocols themselves, nutrition and calorie balance, drains and stomas, pressure-area and turning charts, and any local flowsheet layout. No rendering: this is the arithmetic and the honesty about it. Not clinically validated and not clinically approved.",
  },
]);

/**
 * Cross-references the safety case against a test run.
 *
 * @param {{name: string, file?: string, passed: boolean}[]} testResults flat list from a runner
 * @param {readonly object[]} [hazards]
 * @returns {{id, status, control, evidence: {name, found, passed}[], caveat, ...}[]}
 */
function assess(testResults, hazards = HAZARDS) {
  const results = Array.isArray(testResults) ? testResults : [];
  return hazards.map((h) => {
    const declared = h.verification.tests || [];
    const fragment = h.verification.matchMode === "fragment";

    const evidence = declared.map((name) => {
      const hit = results.find((r) => (fragment
        ? String(r.name || "").toLowerCase().includes(name.toLowerCase())
        : String(r.name || "") === name));
      return { name, found: !!hit, passed: !!hit && hit.passed === true };
    });

    let status;
    if (!h.control.module) status = STATUS.UNCONTROLLED;
    else if (!declared.length || evidence.every((e) => !e.found)) status = STATUS.NO_EVIDENCE;
    else if (evidence.some((e) => !e.found || !e.passed)) status = STATUS.FAILING;
    // A partial control is capped here however green its tests are. Tests can show that what was
    // built works; they can never show that what was NOT built was unnecessary.
    else if (h.control.adequacy !== "full") status = STATUS.PARTIAL;
    else status = STATUS.VERIFIED;

    return {
      id: h.id, hazard: h.hazard, status,
      control: h.control, evidence,
      missingEvidence: evidence.filter((e) => !e.found).map((e) => e.name),
      residualRisk: h.residualRisk, approver: h.approver, caveat: h.caveat,
    };
  });
}

/** Counts by status, plus the single number worth quoting: how many hazards are verified. */
function summarise(assessment) {
  const by = { uncontrolled: 0, "no-evidence": 0, failing: 0, partial: 0, verified: 0 };
  for (const a of assessment) by[a.status] += 1;
  return { total: assessment.length, ...by, verifiedFraction: `${by.verified} of ${assessment.length}` };
}

/** Plain-text assurance table. Deliberately leads with what is NOT covered. */
function report(assessment) {
  const s = summarise(assessment);
  const order = { uncontrolled: 0, "no-evidence": 1, failing: 2, partial: 3, verified: 4 };
  const rows = [...assessment].sort((a, b) => order[a.status] - order[b.status]);
  // The qualifier is printed every time and is not optional. A report whose headline is "11 of 11"
  // with nothing beside it will be read as "this software is safe to use on patients", which is not
  // what any row here says. VERIFIED is a statement about tests, not about clinical adequacy, and
  // the closer the count gets to complete the more that distinction has to be forced into view.
  const unapproved = assessment.filter((a) => /UNAPPROVED|not clinically validated|seed/i.test(a.caveat || "")).length;
  const lines = [
    "WardSynQ clinical safety case",
    `${s.verifiedFraction} hazards fully verified. ${s.partial} partially controlled, ${s.uncontrolled} uncontrolled, ${s["no-evidence"]} without evidence, ${s.failing} failing.`,
    "",
    "VERIFIED means the named tests pass. It does NOT mean the control is clinically adequate,",
    "and it does NOT mean the clinical content it runs on has been approved.",
    `${unapproved} of ${s.total} hazards carry a caveat about unapproved or unvalidated clinical content.`,
    "Nothing in this build is CLINICALLY VALIDATED or CLINICALLY APPROVED. Read the caveats.",
    "",
  ];
  for (const r of rows) {
    lines.push(`${r.status.toUpperCase().padEnd(13)} ${r.id}  ${r.hazard}`);
    lines.push(`              control: ${r.control.module || "none built"}`);
    if (r.missingEvidence.length) lines.push(`              MISSING TEST: ${r.missingEvidence.join("; ")}`);
    if (r.caveat) lines.push(`              caveat: ${r.caveat}`);
    lines.push("");
  }
  return lines.join("\n");
}

export { HAZARDS, STATUS, assess, summarise, report };
