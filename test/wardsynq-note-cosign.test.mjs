/* test/wardsynq-note-cosign.test.mjs — the note that needs a second name on it. Pure half.
 *
 * node --test test/wardsynq-note-cosign.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signingState, waitingMinutes, maySign } from "../functions/_wardsynq/note-cosign.js";

const REGISTERED = { id: "cfa:consultant", credential: "TSMC-2019-44821" };
const UNREGISTERED = { id: "cfa:pin-doctor", credential: null };
const NOTE = { id: "n1", authorId: "cfa:pin-doctor", signedBy: null, submittedAt: null };

test("THE CO-SIGNATURE IS THE SIGNATURE: a note signed by someone else is a countersigned note", () => {
  /* There is no separate coSignedBy field on purpose. The registration is what makes a signature a
   * signature, and the store already polices `signedBy`; a second field would have created a weaker
   * kind of signature that nothing checks. */
  assert.equal(signingState({ ...NOTE, authorId: "a", signedBy: "a" }), "signed");
  assert.equal(signingState({ ...NOTE, authorId: "a", signedBy: "b" }), "cosigned");
  assert.equal(signingState({ ...NOTE, submittedAt: "2026-09-07T09:00:00.000Z" }), "awaiting");
  assert.equal(signingState(NOTE), "draft", "nobody has said this one is finished");
  assert.equal(signingState(null), "draft");
});

test("AN UNREGISTERED CLINICIAN IS TOLD WHY, and told what to do instead", () => {
  const r = maySign(NOTE, UNREGISTERED);
  assert.equal(r.ok, false);
  assert.equal(r.error, "no_credential");
  /* The store would refuse this write anyway. Saying it here means a clinician reads "you hold no
   * verified registration, submit it for a colleague" rather than a governance code for a state the
   * system knew about before they clicked. */
  assert.match(r.detail, /verified medical registration/);
  assert.match(r.detail, /submitted for a colleague/);
});

test("NOBODY SIGNS AN UNFINISHED NOTE THEY DID NOT WRITE", () => {
  /* A supervisor putting their name to work the author has not declared finished is how a
   * co-signature becomes a rubber stamp. */
  const early = maySign(NOTE, REGISTERED);
  assert.equal(early.ok, false);
  assert.equal(early.error, "not_submitted");

  const submitted = { ...NOTE, submittedAt: "2026-09-07T09:00:00.000Z" };
  const ok = maySign(submitted, REGISTERED);
  assert.deepEqual([ok.ok, ok.coSign], [true, true]);

  // The author signing their own note needs no submission step: they are already the one saying it
  // is finished.
  const own = maySign({ ...NOTE, authorId: REGISTERED.id }, REGISTERED);
  assert.deepEqual([own.ok, own.coSign], [true, false]);
});

test("a signed note is never re-signed, and the refusal names who signed it", () => {
  const r = maySign({ ...NOTE, signedBy: "cfa:someone" }, REGISTERED);
  assert.equal(r.error, "already_signed");
  assert.match(r.detail, /cfa:someone/);
  assert.match(r.detail, /a correction is a new note/);
  assert.equal(maySign(null, REGISTERED).error, "note_not_found");
});

test("HOW LONG IT HAS WAITED is computed, so it cannot go stale", () => {
  const n = { ...NOTE, submittedAt: "2026-09-07T09:00:00.000Z" };
  assert.equal(waitingMinutes(n, Date.parse("2026-09-07T11:30:00.000Z")), 150);
  // A note nobody is waiting on has no waiting time, rather than a zero that reads as "just now".
  assert.equal(waitingMinutes(NOTE, Date.now()), null);
  assert.equal(waitingMinutes({ ...n, signedBy: "x" }, Date.now()), null);
  // An unparseable timestamp reports nothing rather than a number derived from NaN.
  assert.equal(waitingMinutes({ ...NOTE, submittedAt: "whenever" }, Date.now()), null);
});
