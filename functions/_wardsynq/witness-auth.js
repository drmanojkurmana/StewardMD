/* functions/_wardsynq/witness-auth.js — the second person at a bedside dose proves who they are (CLIN-18).
 *
 * A witness used to be an identifier typed into a box: any active colleague's name passed, whether or not that
 * colleague was in the room. Now the witness enters their OWN staff PIN on the nurse's device, and it is checked
 * exactly as a PIN sign-in is (functions/_opd_auth.js: verifySecret, pinLocked, nextPinState): the same hash, the
 * same five attempts, the same fifteen-minute lockout, recorded on the same member and audited under the hospital.
 * Nothing here mints a session: the witness proves presence for this one dose and is never signed in by it.
 *
 * The store is injected (deps), so the route keeps the one membership store and this stays testable:
 *   deps.getMemberAuth(identity)          -> the member's auth fields, or null
 *   deps.recordAttempt(auth, patch)       -> persist nextPinState()'s patch on that member
 *   deps.audit(identity, action, detail)  -> the hospital's sign-in audit (never the PIN)
 */
import { verifySecret, pinLocked, nextPinState, PIN_MAX_ATTEMPTS } from "../_opd_auth.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** { ok: true, identity } or { ok: false, error, detail }. Never throws for a wrong or missing PIN. */
async function verifyWitnessPin(deps, witnessId, pin, nowMs) {
  const id = str(witnessId), clean = str(pin), now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (!id) return { ok: false, error: "witness_required", detail: "Name the second person who witnessed this dose." };
  if (!clean) return { ok: false, error: "witness_pin_required", detail: "The witness enters their own staff PIN. A name alone is not a witness." };
  const auth = await deps.getMemberAuth(id);
  if (!auth || !auth.active || !auth.pinHash) {
    await deps.audit(id, "witness:pin_refused", !auth ? "unknown" : !auth.active ? "disabled" : "no_pin");
    return { ok: false, error: "witness_pin_unavailable", detail: "The witness is not an active member of this hospital with a staff PIN." };
  }
  const gate = pinLocked(auth, now);
  if (gate.locked) {
    await deps.audit(auth.identity, "witness:pin_locked", "");
    return { ok: false, error: "witness_pin_locked", detail: "The witness's PIN is locked after too many wrong attempts. Try again later, or another witness.", retryInMs: gate.remainingMs };
  }
  const good = await verifySecret(clean, auth.pinSalt, auth.pinHash);
  const nx = nextPinState(auth, now, good);
  await deps.recordAttempt(auth, nx);
  await deps.audit(auth.identity, good ? "witness:pin_ok" : nx.pinLockedUntil ? "witness:pin_lockout" : "witness:pin_failed", good ? "" : "attempt " + nx.pinAttempts);
  if (!good) return { ok: false, error: "witness_pin_wrong", detail: "The witness's PIN is not right.", attemptsLeft: Math.max(0, PIN_MAX_ATTEMPTS - nx.pinAttempts) };
  return { ok: true, identity: auth.identity || id };
}

export { verifyWitnessPin };
