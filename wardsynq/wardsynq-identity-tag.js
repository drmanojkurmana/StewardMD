/* wardsynq/wardsynq-identity-tag.js — TASK 6.14: the physical tag's own lifecycle.
 *
 * wristbandBarcode has been a real Patient field since early in this build, and meds/transfusion/
 * specimen-collection/device-association all already compare a scan against it - wrong-patient
 * prevention through a physical tag is real and tested. What has never existed is the tag's OWN
 * governance: who put this code on this patient, when, and what happened to the last one. A
 * comparator that trusts whatever code is currently on the field is only as safe as the process that
 * put it there, and today that process is "somebody wrote to the field."
 *
 * NFC UID IS AN IDENTIFIER, NOT PROOF OF IDENTITY - the plan's own words. This file governs the
 * ASSIGNMENT (which code names which patient, by whose authority, since when); it is not, and does
 * not become, the identity confirmation itself - wardsynq-meds.js's five-rights check and its
 * siblings remain the place a scan is actually trusted at the bedside. This is upstream of that: the
 * record those checks compare against.
 *
 * NEVER SILENTLY REASSIGN AN ACTIVE TAG - the plan's own words, made structural: assignTag() has no
 * way to know about a patient's other tags (it is pure, and does not query), so the wiring layer
 * MUST check for an existing active tag before calling it, and this file's own replaceTag()/
 * deactivateTag() are the only paths that end an active tag's life. Two tags active on one patient at
 * once, for the SAME type, is the exact failure this file exists to prevent - one nurse scans the
 * old one, another scans the new one, and a system with no memory of the swap tells them both they
 * are right.
 *
 * WHY LOST IS ITS OWN STATE, NOT A DEACTIVATION REASON: task 6.21 asks for "tag reassignment
 * attempts" to be monitorable, and a hospital that is losing wristbands weekly on one ward has a
 * different problem than one that is deliberately replacing them at shift change. Collapsing the two
 * into "deactivated, reason: free text" would bury exactly the signal that operational monitoring is
 * for.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT wired to any physical scanner in this build - a real barcode/
 * QR/NFC reader is a real-device integration this environment cannot prove, the same honest
 * distinction this project has held for every other hardware-adjacent claim.
 *
 * node --test test/wardsynq-identity-tag.test.mjs
 */

const TAG_TYPES = Object.freeze(["wristband", "qr", "nfc"]);
const STATUS = Object.freeze({
  ACTIVE: "active",
  REPLACED: "replaced",     // superseded by a newer tag, in an unbroken chain
  DEACTIVATED: "deactivated", // ended deliberately (discharge, damaged, policy) - not lost
  LOST: "lost",              // ended because the physical tag went missing
});

class IdentityTagError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "IdentityTagError";
    this.code = code || "IDENTITY_TAG_VIOLATION";
  }
}

/** Codes are compared normalised: case/whitespace differences are not a different tag. */
function normaliseCode(code) {
  return String(code == null ? "" : code).trim().toUpperCase().replace(/\s+/g, "");
}

let seq = 0;

/**
 * Assigns a new tag. PURE - has no knowledge of any tag this patient already holds; the caller
 * (the wiring layer, which can actually query) is responsible for refusing this when an active tag
 * of the same type already exists, per the file header's central rule.
 */
function assignTag({ patientId, tagType, code, assignedBy, now } = {}) {
  if (!patientId) throw new IdentityTagError("a tag needs the patient it identifies", "NO_PATIENT");
  if (!TAG_TYPES.includes(tagType)) throw new IdentityTagError(`tagType must be one of ${TAG_TYPES.join(", ")}`, "BAD_TAG_TYPE");
  const norm = normaliseCode(code);
  if (!norm) throw new IdentityTagError("a tag needs the code that was actually scanned or printed", "NO_CODE");
  if (!assignedBy) throw new IdentityTagError("assigning a tag must name who did it", "NO_ACTOR");

  const at = now || new Date().toISOString();
  return {
    id: `tag-${++seq}`,
    patientId, tagType, code: norm,
    status: STATUS.ACTIVE,
    assignedBy, assignedAt: at,
    replacesTagId: null,
    endedBy: null, endedAt: null, endedReason: null,
    history: [{ at, event: "assigned", by: assignedBy, detail: tagType }],
  };
}

/**
 * Does a scanned code match this tag? Pure, read-only - the comparator this file's header says
 * remains the bedside checks' own job to CALL, not to reimplement; this is the one normalisation
 * rule (case/whitespace) kept in one place so every caller compares the same way.
 */
function verifyTag(tag, scannedCode) {
  if (!tag) return { matches: false, reason: "no tag on record" };
  if (tag.status !== STATUS.ACTIVE) return { matches: false, reason: `this tag is ${tag.status}, not active` };
  const matches = normaliseCode(scannedCode) === tag.code;
  return { matches, reason: matches ? null : "scanned code does not match the active tag on record" };
}

function endTag(tag, status, { by, reason, now } = {}) {
  if (!tag) throw new IdentityTagError("no tag to end", "NO_TAG");
  if (tag.status !== STATUS.ACTIVE) {
    throw new IdentityTagError(`this tag is already ${tag.status}, not active`, "NOT_ACTIVE");
  }
  if (!by) throw new IdentityTagError("ending a tag must name who did it", "NO_ACTOR");
  if (!reason || String(reason).trim().length < 3) {
    throw new IdentityTagError("ending a tag needs a real reason - deactivated/lost with no reason is unauditable", "NO_REASON");
  }
  const at = now || new Date().toISOString();
  tag.status = status;
  tag.endedBy = by; tag.endedAt = at; tag.endedReason = String(reason).trim();
  tag.history.push({ at, event: status, by, detail: tag.endedReason });
  return tag;
}

/** Deliberate end: discharge, damaged, replaced by policy - never "lost". */
function deactivateTag(tag, opts) { return endTag(tag, STATUS.DEACTIVATED, opts); }

/** The tag went missing. Its own state, per the file header, so operational monitoring can tell the
 * two apart. */
function reportLost(tag, opts) { return endTag(tag, STATUS.LOST, opts); }

/**
 * Replaces an active (or lost) tag with a new one, in one call. Never leaves a gap where the old
 * tag is still active and a new one exists too - the two mutations either both happen or the caller
 * gets an error and neither has, which the wiring layer's own persistence step must honour (write
 * both records, or write neither).
 */
function replaceTag(currentTag, { newCode, by, reason, now } = {}) {
  if (!currentTag) throw new IdentityTagError("no tag to replace", "NO_TAG");
  if (currentTag.status !== STATUS.ACTIVE && currentTag.status !== STATUS.LOST) {
    throw new IdentityTagError(`this tag is ${currentTag.status} and cannot be replaced - assign a fresh tag instead`, "NOT_REPLACEABLE");
  }
  if (!by) throw new IdentityTagError("replacing a tag must name who did it", "NO_ACTOR");
  if (!reason || String(reason).trim().length < 3) {
    throw new IdentityTagError("replacing a tag needs a real reason", "NO_REASON");
  }
  const at = now || new Date().toISOString();
  const wasLost = currentTag.status === STATUS.LOST;
  const old = { ...currentTag, history: [...currentTag.history] };
  if (!wasLost) {
    // Already-lost tags keep their LOST state and reason (the loss, not the replacement, is why it
    // ended) - only an active tag transitions to REPLACED here.
    old.status = STATUS.REPLACED;
    old.endedBy = by; old.endedAt = at; old.endedReason = String(reason).trim();
    old.history.push({ at, event: "replaced", by, detail: old.endedReason });
  }
  const next = assignTag({ patientId: currentTag.patientId, tagType: currentTag.tagType, code: newCode, assignedBy: by, now: at });
  next.replacesTagId = currentTag.id;
  next.history.push({ at, event: "issued-as-replacement", by, detail: `replaces ${currentTag.id}` });
  return { old, next };
}

export { TAG_TYPES, STATUS, IdentityTagError, normaliseCode, assignTag, verifyTag, deactivateTag, reportLost, replaceTag };
