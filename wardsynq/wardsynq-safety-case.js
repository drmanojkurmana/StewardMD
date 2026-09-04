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
      ],
    },
    residualRisk: "high: the dose table covers eight drugs",
    approver: "Head of Paediatrics and Head of Clinical Pharmacology",
    caveat: "The dose ceiling table is an eight-drug UNAPPROVED seed. Frequency errors, such as a weekly methotrexate dose given daily, are NOT detected by a per-dose ceiling.",
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
      ],
    },
    residualRisk: "reduced: the loop is structural, but its thresholds and channels are site-supplied",
    approver: "Head of Laboratory Medicine and ICU Director",
    caveat: "IMPLEMENTED and TESTED, not clinically validated or approved. The threshold pack is UNAPPROVED seed content and models ADULT limits only, so a paediatric result classified against it would be wrong. No real notification channel is integrated: delivery is only as real as the channel adapter a site supplies, and a site that wires none gets NO_CHANNEL rather than silent success.",
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
      ],
    },
    residualRisk: "reduced: the ceiling is structural and cannot be configured away",
    approver: "AI Clinical Governance Committee",
    caveat: "IMPLEMENTED and TESTED, not clinically validated or approved. The workstation now writes ONLY through a governed session, verified in a browser: a signed order carries a writtenBy stamp that only GovernedStore applies, and reconciliation was moved onto a governed handle after wiring exposed that it had been writing to the raw store with no actor. DEPLOYMENT REQUIREMENT that still stands for everything else: this governs writes that pass through GovernedStore, and any future surface or service that is handed the underlying ClinicalStore has enforced nothing, in the same way an API is not a control if the database is also exposed.",
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
      ],
    },
    residualRisk: "reduced: attribution is structural and artefact is derived rather than asserted",
    approver: "Biomedical Engineering Director and Nursing Director",
    caveat: "IMPLEMENTED and TESTED, not clinically validated or approved. NOT modelled: PTP or NTP synchronisation itself (skew is detected, never corrected), waveform-level analysis, device firmware and calibration registries, and forwarding of the device's own alarms. Plausibility bounds are engineering limits for catching a detached lead, not clinical limits, and are deliberately far wider than any critical threshold. No barcode hardware is integrated, so association is verified against supplied scan values rather than a scanner.",
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
