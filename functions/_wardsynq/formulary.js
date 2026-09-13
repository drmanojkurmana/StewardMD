/* functions/_wardsynq/formulary.js — what this hospital stocks, and what it guards.
 *
 * A FORMULARY IS NOT A SAFETY CHECK, and conflating the two is the mistake this file is written to
 * avoid. The safety engine answers "would this harm this patient" and it is allowed to block. A
 * formulary answers "does this hospital stock this, and does it want a word first" - an economic and
 * stewardship control. A drug that is not on the list is not dangerous; it is not stocked. Refusing
 * an order on those grounds, silently, would teach prescribers that the safety warnings are also
 * bureaucratic, which is how the ones that matter stop being read.
 *
 * SO OFF-FORMULARY DOES NOT BLOCK. It is flagged, and it is recorded on the order. Prescribing off
 * the formulary is a real and legitimate act: a patient's own supply from home, a specialist drug
 * started elsewhere, a shortage. The hospital may configure that a REASON is required - that is
 * their control to switch on - and even then the reason is recorded rather than adjudicated.
 *
 * RESTRICTED IS DIFFERENT, AND IT DOES BLOCK - because the hospital said so. Antimicrobial
 * stewardship is the reason this exists in India and everywhere else: meropenem needs a word with
 * microbiology, and a system that lets it be ordered at 2am without one is the system that produces
 * the resistance. The refusal names exactly what is missing and who grants it, because a refusal a
 * prescriber cannot act on at 2am is a refusal they will work around.
 *
 * NOTHING IS MATCHED FUZZILY. "Amoxicillin" does not match "amoxicillin-clavulanate" and must not:
 * they are different drugs with different restrictions, and a formulary that guessed would apply the
 * wrong rule with total confidence. Matching is on the normalised whole name, or on a code, or on an
 * alias THE HOSPITAL WROTE. Never on a prefix, never on a substring.
 *
 * AN UNKNOWN DRUG IS "NOT ON THE FORMULARY", NEVER "DOES NOT EXIST". The hospital's list is a list of
 * what it stocks, not a census of medicine.
 */

const str = (v) => (v == null ? "" : String(v).trim());
/** Case, spacing and punctuation are not identity; the words are. */
const norm = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const STATES = Object.freeze(["formulary", "restricted", "non-formulary"]);

/**
 * PURE. The hospital's formulary, validated. An entry it cannot use is REPORTED, never silently
 * dropped: a missing entry looks exactly like a drug the hospital does not stock, and somebody will
 * add a second one.
 */
function resolveFormulary(list) {
  const rows = Array.isArray(list) ? list : [];
  const entries = [], problems = [];
  const byName = new Map(), byCode = new Map();

  rows.forEach((raw, index) => {
    const r = raw && typeof raw === "object" ? raw : {};
    const drug = str(r.drug);
    const code = str(r.code);
    if (!drug && !code) { problems.push({ index, reason: "no_drug_or_code" }); return; }

    const restricted = r.restricted === true;
    const requiresApproval = r.requiresApproval === true;
    /* A restriction with nothing to satisfy it is unusable: it would refuse every order and no
     * prescriber could ever clear it. Reported rather than enforced. */
    if (restricted && !requiresApproval && !(Array.isArray(r.restrictedTo) && r.restrictedTo.length)) {
      problems.push({ index, drug: drug || code, reason: "restriction_has_no_route" });
      return;
    }

    const entry = {
      drug: drug || null, code: code || null,
      aliases: Array.isArray(r.aliases) ? r.aliases.map(str).filter(Boolean) : [],
      restricted, requiresApproval,
      restrictedTo: Array.isArray(r.restrictedTo) ? r.restrictedTo.map(str).filter(Boolean) : [],
      approvedBy: str(r.approvedBy) || null,          // who grants it, so a refusal is actionable
      note: str(r.note) || null,
    };
    entries.push(entry);
    for (const n of [drug, ...entry.aliases]) if (n) byName.set(norm(n), entry);
    if (code) byCode.set(norm(code), entry);
  });

  return { ok: entries.length > 0, entries, byName, byCode, ...(problems.length ? { problems } : {}) };
}

/**
 * PURE. The entry for this drug, or null. NEVER a near match.
 *
 * A prefix or substring match would make "Amoxicillin" find "Amoxicillin-clavulanate" and apply its
 * restriction to a drug that does not have one - or worse, miss the restriction on the one that does.
 */
function lookup(formulary, drug, code) {
  const f = formulary || {};
  if (!f.byName) return null;
  const c = norm(code);
  if (c && f.byCode.has(c)) return f.byCode.get(c);
  const n = norm(drug);
  return (n && f.byName.get(n)) || null;
}

/**
 * PURE. Where this order stands against the formulary.
 *
 * `state` is one of formulary / restricted / non-formulary. `blocked` is true ONLY for a restriction
 * the hospital configured and the prescriber has not satisfied - never for being off-formulary.
 */
function formularyStatus(input) {
  const i = input || {};
  const f = i.formulary;
  // No formulary configured at all is not "everything is off-formulary". It is no opinion.
  if (!f || !f.ok) return { state: "not-configured", blocked: false, detail: "This hospital has not configured a formulary." };

  const entry = lookup(f, i.drug, i.code);
  if (!entry) {
    return {
      state: "non-formulary", blocked: false, entry: null,
      /* Off-formulary NEVER blocks by itself. A drug not on the list is not dangerous - it is not
       * stocked, and the ward needs to know so it can get hold of it. */
      detail: "Not on this hospital's formulary. The order stands; the ward may need to obtain this.",
      ...(i.requireReasonOffFormulary === true && !str(i.reason)
        ? { blocked: true, needs: "reason", detail: "This hospital requires a reason for an off-formulary order. Say why this drug rather than one on the formulary." }
        : {}),
      ...(str(i.reason) ? { reason: str(i.reason) } : {}),
    };
  }

  if (!entry.restricted) return { state: "formulary", blocked: false, entry };

  /* RESTRICTED. This one does block, because the hospital said so - antimicrobial stewardship is the
   * commonest reason and it is the whole point. The refusal has to be actionable at 2am, so it names
   * what is missing AND who grants it. */
  const approvalRef = str(i.approvalRef);
  const specialty = norm(i.specialty);
  const allowedHere = entry.restrictedTo.length > 0 && entry.restrictedTo.some((s) => norm(s) === specialty);
  if (allowedHere) return { state: "restricted", blocked: false, entry, satisfiedBy: "specialty" };
  /* THE REFERENCE HAS TO NAME A REAL APPROVAL.
   *
   * This used to read `if (entry.requiresApproval && approvalRef)` - any non-empty string. A
   * prescriber blocked by stewardship at 2am could type one character and be through, and the block
   * that the hospital had configured to protect its last-line antibiotics was a formality that
   * looked like a control. The reference is now resolved against the approval chain
   * (_wardsynq/verification.js) BEFORE this function is called, and `approvalVerified` is that
   * answer: the chain exists, it is for this very drug, it holds as many distinct approvers as the
   * hospital asked for, none of them is the person who asked, and none has withdrawn. */
  if (entry.requiresApproval && approvalRef && i.approvalVerified === true) {
    return { state: "restricted", blocked: false, entry, satisfiedBy: "approval", approvalRef };
  }
  if (entry.requiresApproval && approvalRef) {
    // Named separately from "no approval at all", because the two need different things done about
    // them: one prescriber has to go and get an approval, the other is holding one that does not
    // apply, and telling them both the same thing sends one of them looking in the wrong place.
    return {
      state: "restricted", blocked: true, entry, needs: "approval", approvalRef,
      detail: `That approval reference does not cover ${entry.drug || entry.code}. An approval has to be granted for this drug, by someone other than the person asking, and still stand.`,
      ...(entry.note ? { note: entry.note } : {}),
    };
  }

  const needs = [];
  if (entry.restrictedTo.length) needs.push(`a prescriber in ${entry.restrictedTo.join(" or ")}`);
  if (entry.requiresApproval) needs.push(`an approval reference${entry.approvedBy ? ` from ${entry.approvedBy}` : ""}`);
  return {
    state: "restricted", blocked: true, entry,
    needs: entry.requiresApproval ? "approval" : "specialty",
    detail: `${entry.drug || entry.code} is restricted at this hospital. It needs ${needs.join(" or ")}.`,
    ...(entry.note ? { note: entry.note } : {}),
  };
}

export { STATES, norm, resolveFormulary, lookup, formularyStatus };
