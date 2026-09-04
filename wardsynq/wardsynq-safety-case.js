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
      kind: "identity and merge control", adequacy: "partial",
      module: "wardsynq/wardsynq-mpi.js",
      summary: "Probabilistic matching with an explainable breakdown, a name-only candidate that can never auto-link, provisional identities for unidentified arrivals, and a reversible merge that lists conflicts rather than resolving them.",
    },
    verification: {
      file: "test/wardsynq-mpi.test.mjs",
      tests: ["merge", "unmerge", "provisional", "auto"],
      matchMode: "fragment",
    },
    residualRisk: "reduced for merge; the ordering surface is unverified",
    approver: "Chief Medical Information Officer",
    caveat: "Merge and matching are verified. The spec also requires that an open chart cannot be contaminated across tabs or sessions; NOTHING verifies that, and the workstation is single-context.",
  },
  {
    id: "HAZ-DOWN-01",
    hazard: "Clinical data lost or silently overwritten",
    initialRisk: "catastrophic x occasional",
    requirement: "Charting must survive interruption, and no write may silently overwrite another.",
    control: {
      kind: "append-only store", adequacy: "partial",
      module: "wardsynq/wardsynq-store.js",
      summary: "Every write creates a new version and keeps all prior ones; transactions are all-or-nothing; reads and writes are deep-copied so a caller cannot mutate stored state.",
    },
    verification: {
      file: "test/wardsynq-store.test.mjs",
      tests: ["version", "history", "transaction", "deep"],
      matchMode: "fragment",
    },
    residualRisk: "partially addressed",
    approver: "Chief Information Officer and Disaster Committee",
    caveat: "Append-only history is verified. Offline operation, reconnection and three-way merge of conflicting offline edits are NOT built and NOT verified.",
  },
  {
    id: "HAZ-DIAG-01",
    hazard: "An unacknowledged critical result",
    initialRisk: "catastrophic x probable",
    requirement: "A critical value must force acknowledgement and escalate on a timer if it is not acknowledged.",
    control: { kind: null, adequacy: "none", module: null, summary: "Not built. Results carry a source system's own critical flag as data, and the adapter deliberately refuses to promote it to a control." },
    verification: { file: null, tests: [] },
    residualRisk: "unmitigated",
    approver: "Head of Laboratory Medicine and ICU Director",
    caveat: "No closed-loop acknowledgement, no escalation timer, no notification path exists.",
  },
  {
    id: "HAZ-BLD-01",
    hazard: "Transfusion of an ABO or Rh incompatible unit",
    initialRisk: "catastrophic x rare",
    requirement: "Release and bedside infusion must enforce verified crossmatch compatibility.",
    control: { kind: null, adequacy: "none", module: null, summary: "Not built." },
    verification: { file: null, tests: [] },
    residualRisk: "unmitigated",
    approver: "Blood Bank Director and Transfusion Safety Officer",
    caveat: "No blood product, crossmatch or transfusion model exists in this build.",
  },
  {
    id: "HAZ-SURG-01",
    hazard: "Wrong-patient, wrong-site or wrong-procedure surgery",
    initialRisk: "catastrophic x rare",
    requirement: "Incision must be gated behind signed WHO Surgical Safety Checklist milestones.",
    control: { kind: null, adequacy: "none", module: null, summary: "Not built." },
    verification: { file: null, tests: [] },
    residualRisk: "unmitigated",
    approver: "Head of Surgery and Head of Anaesthesiology",
    caveat: "No surgical module exists in this build.",
  },
  {
    id: "HAZ-AI-01",
    hazard: "An AI-authored medication, dose or clinical history reaching the record",
    initialRisk: "catastrophic x occasional",
    requirement: "AI output must be confined to draft status and must never commit without a clinician signature.",
    control: {
      kind: "model fields only", adequacy: "partial",
      module: "wardsynq/wardsynq-model.js",
      summary: "Orders and notes carry aiDrafted and signedBy, and an AI-drafted order is constructed in draft status with no signature.",
    },
    verification: {
      file: "test/wardsynq-p0-core.test.mjs",
      tests: ["model: AI-authored records default to unsigned and flagged"],
    },
    residualRisk: "high: the boundary is a convention, not a control",
    approver: "AI Clinical Governance Committee",
    caveat: "Nothing ENFORCES the boundary. The spec requires EXECUTE to be blocked at the API layer for AI actors; the store will accept a signed-looking record from any caller, because there is no actor model.",
  },
  {
    id: "HAZ-DEV-01",
    hazard: "Corrupted or misattributed device telemetry",
    initialRisk: "major x occasional",
    requirement: "Telemetry must be positively associated with a patient, and artefacts excluded from automated scores.",
    control: {
      kind: "model fields only", adequacy: "partial",
      module: "wardsynq/wardsynq-model.js",
      summary: "Observation carries signalQualityIndex and an artifact flag so an unreliable reading can be marked and excluded downstream.",
    },
    verification: {
      file: "test/wardsynq-p0-core.test.mjs",
      tests: ["model: device observations carry signal quality and artifact flags"],
    },
    residualRisk: "unmitigated in practice",
    approver: "Biomedical Engineering Director and Nursing Director",
    caveat: "The FIELDS exist. No device gateway, no positive patient-device association, no artefact detection and no score exclusion are built, so nothing sets the flag.",
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
  const lines = [
    "WardSynQ clinical safety case",
    `${s.verifiedFraction} hazards fully verified. ${s.partial} partially controlled, ${s.uncontrolled} uncontrolled, ${s["no-evidence"]} without evidence, ${s.failing} failing.`,
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
