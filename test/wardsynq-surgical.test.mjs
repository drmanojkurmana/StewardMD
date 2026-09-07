/* test/wardsynq-surgical.test.mjs — HAZ-SURG-01, wrong-site and unchecked surgery.
 *
 * Adversarial. Wrong-site surgery is not caused by ignorance of the side, it is caused by a
 * checklist performed as a ritual, so these tests try to reach the knife the way real theatres
 * actually drift: one person agreeing to everything, an item ticked without being asked, a Time Out
 * skipped because the list is running late, a consent form for the other side.
 *
 * node --test test/wardsynq-surgical.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { STAGE, CHECKLIST, SurgicalSafetyError, SurgicalCase, bypassed } from "../wardsynq/wardsynq-surgical.js";
import { ClinicalEventBus } from "../wardsynq/wardsynq-events.js";
import { ClinicalStore, MemoryBackend } from "../wardsynq/wardsynq-store.js";
import { Patient } from "../wardsynq/wardsynq-model.js";

function clock(startIso) {
  let t = Date.parse(startIso);
  return { now: () => new Date(t).toISOString(), advance: (m) => { t += m * 60000; } };
}

const patient = () => Patient({ mrn: "GH-7", name: "Test Patient", dob: "1972-05-05", wristbandBarcode: "GH-7" });
const engineOf = (over) => {
  const c = (over && over.clock) || clock("2026-09-04T07:30:00.000Z");
  return { engine: new SurgicalCase({ now: c.now, ...(over || {}) }), clock: c };
};

const allOf = (phase) => Object.fromEntries(CHECKLIST[phase].map((i) => [i, true]));
const THREE = [
  { role: "surgeon", actorId: "mr-surgeon" },
  { role: "anaesthetist", actorId: "dr-gas" },
  { role: "nurse", actorId: "sr-scrub" },
];

const CONSENT = { procedure: "total knee replacement", laterality: "left", signedByPatientOrProxy: true };

/** Books, consents and marks a left knee correctly. */
async function upToMarked(engine) {
  const c = await engine.book(patient(), { procedure: "total knee replacement", site: "knee", laterality: "left" }, "booking-clerk");
  await engine.recordConsent(c, CONSENT, "dr-ward");
  await engine.markSite(c, { laterality: "left", site: "knee" }, "mr-surgeon");
  return c;
}

async function upToTimedOut(engine) {
  const c = await upToMarked(engine);
  await engine.signIn(c, { items: allOf("signIn"), signatures: THREE, lateralityAsserted: "left" });
  await engine.timeOut(c, { items: allOf("timeOut"), signatures: THREE, lateralityAsserted: "left" });
  return c;
}

/* ------------------------------------------------------------------ booking and laterality */

test("booking: a case without a real side is refused", async () => {
  const { engine } = engineOf();
  for (const bad of [undefined, "", "l", "LEFT-ish", "either"]) {
    await assert.rejects(() => engine.book(patient(), { procedure: "knee replacement", laterality: bad }, "clerk"),
      (e) => { assert.equal(e.code, "NO_LATERALITY"); return true; }, `"${bad}" must not be accepted as a side`);
  }
});

test("ADVERSARIAL: the site cannot be marked on the wrong side", async () => {
  const { engine } = engineOf();
  const c = await engine.book(patient(), { procedure: "total knee replacement", site: "knee", laterality: "left" }, "clerk");
  await engine.recordConsent(c, CONSENT, "dr-ward");
  await assert.rejects(() => engine.markSite(c, { laterality: "right", site: "knee" }, "mr-surgeon"),
    (e) => { assert.equal(e.code, "LATERALITY_CONFLICT"); return true; });
  assert.equal(c.stage, STAGE.BOOKED, "the case does not advance on a marking conflict");
  assert.ok(c.ledger.some((l) => l.event === "marking-rejected"), "and the attempt is on the record");
});

test("ADVERSARIAL: an early laterality error cannot propagate by agreement down the chain", async () => {
  const { engine } = engineOf();
  const c = await upToMarked(engine); // booked and marked LEFT
  // Sign In is where a theatre would repeat back whatever the previous step said. Every assertion
  // is compared to the BOOKING, so a consistent-looking wrong answer still fails.
  await assert.rejects(() => engine.signIn(c, { items: allOf("signIn"), signatures: THREE, lateralityAsserted: "right" }),
    (e) => { assert.equal(e.code, "LATERALITY_CONFLICT"); return true; });
  await assert.rejects(() => engine.signIn(c, { items: allOf("signIn"), signatures: THREE }),
    (e) => { assert.equal(e.code, "LATERALITY_NOT_ASSERTED"); return true; },
    "the side must be said out loud at every phase, not inherited from the last one");
});

test("ADVERSARIAL: Time Out on the wrong side stops the case even after a correct Sign In", async () => {
  const { engine } = engineOf();
  const c = await upToMarked(engine);
  await engine.signIn(c, { items: allOf("signIn"), signatures: THREE, lateralityAsserted: "left" });
  await assert.rejects(() => engine.timeOut(c, { items: allOf("timeOut"), signatures: THREE, lateralityAsserted: "right" }),
    (e) => { assert.equal(e.code, "LATERALITY_CONFLICT"); return true; });
  assert.equal(c.stage, STAGE.SIGNED_IN);
});

/* ------------------------------------------------------------------ consent */

test("ADVERSARIAL: consent for the other side is not consent", async () => {
  const { engine } = engineOf();
  const c = await engine.book(patient(), { procedure: "total knee replacement", site: "knee", laterality: "left" }, "clerk");
  await assert.rejects(() => engine.recordConsent(c, { ...CONSENT, laterality: "right" }, "dr-ward"),
    (e) => { assert.equal(e.code, "CONSENT_MISMATCH"); return true; });
  assert.ok(c.ledger.some((l) => l.event === "consent-rejected"));
});

test("ADVERSARIAL: consent for a different procedure is not consent", async () => {
  const { engine } = engineOf();
  const c = await engine.book(patient(), { procedure: "total knee replacement", laterality: "left" }, "clerk");
  await assert.rejects(() => engine.recordConsent(c, { ...CONSENT, procedure: "knee arthroscopy" }, "dr-ward"),
    (e) => { assert.equal(e.code, "CONSENT_MISMATCH"); return true; });
});

test("ADVERSARIAL: unsigned or expired consent is refused", async () => {
  const c1 = engineOf();
  const case1 = await c1.engine.book(patient(), { procedure: "total knee replacement", laterality: "left" }, "clerk");
  await assert.rejects(() => c1.engine.recordConsent(case1, { ...CONSENT, signedByPatientOrProxy: false }, "dr-ward"),
    (e) => { assert.equal(e.code, "CONSENT_UNSIGNED"); return true; });

  const c2 = engineOf({ clock: clock("2026-09-04T07:30:00.000Z") });
  const case2 = await c2.engine.book(patient(), { procedure: "total knee replacement", laterality: "left" }, "clerk");
  await assert.rejects(() => c2.engine.recordConsent(case2, { ...CONSENT, expiresAt: "2026-09-01T00:00:00.000Z" }, "dr-ward"),
    (e) => { assert.equal(e.code, "CONSENT_MISMATCH"); return true; });
});

test("ADVERSARIAL: sign in is refused with no consent and with no site marking", async () => {
  const { engine } = engineOf();
  const noConsent = await engine.book(patient(), { procedure: "total knee replacement", laterality: "left" }, "clerk");
  // marking is attempted before consent exists, which is allowed, but sign in is not
  await engine.markSite(noConsent, { laterality: "left" }, "mr-surgeon");
  await assert.rejects(() => engine.signIn(noConsent, { items: allOf("signIn"), signatures: THREE, lateralityAsserted: "left" }),
    (e) => { assert.equal(e.code, "NO_CONSENT"); return true; });

  const unmarked = await engine.book(patient(), { procedure: "total knee replacement", laterality: "left" }, "clerk");
  await engine.recordConsent(unmarked, CONSENT, "dr-ward");
  await assert.rejects(() => engine.signIn(unmarked, { items: allOf("signIn"), signatures: THREE, lateralityAsserted: "left" }),
    (e) => { assert.equal(e.code, "OUT_OF_SEQUENCE"); return true; });
});

/* ------------------------------------------------------------------ ADVERSARIAL: the signatures */

test("ADVERSARIAL: one person cannot sign every role", async () => {
  const { engine } = engineOf();
  const c = await upToMarked(engine);
  await assert.rejects(() => engine.signIn(c, {
    items: allOf("signIn"), lateralityAsserted: "left",
    signatures: [
      { role: "surgeon", actorId: "mr-solo" },
      { role: "anaesthetist", actorId: "mr-solo" },
      { role: "nurse", actorId: "mr-solo" },
    ],
  }), (e) => {
    assert.equal(e.code, "SIGNATURES_NOT_INDEPENDENT");
    return true;
  }, "one person agreeing with themselves three times is the exact failure this checklist exists to prevent");
});

test("ADVERSARIAL: two people cannot cover three roles", async () => {
  const { engine } = engineOf();
  const c = await upToMarked(engine);
  await assert.rejects(() => engine.signIn(c, {
    items: allOf("signIn"), lateralityAsserted: "left",
    signatures: [
      { role: "surgeon", actorId: "mr-surgeon" },
      { role: "anaesthetist", actorId: "dr-gas" },
      { role: "nurse", actorId: "dr-gas" },
    ],
  }), (e) => { assert.equal(e.code, "SIGNATURES_NOT_INDEPENDENT"); return true; });
});

test("ADVERSARIAL: a missing role blocks the phase", async () => {
  const { engine } = engineOf();
  const c = await upToMarked(engine);
  await assert.rejects(() => engine.signIn(c, {
    items: allOf("signIn"), lateralityAsserted: "left",
    signatures: [{ role: "surgeon", actorId: "mr-surgeon" }, { role: "nurse", actorId: "sr-scrub" }],
  }), (e) => {
    assert.equal(e.code, "SIGNATURES_MISSING");
    assert.match(e.message, /anaesthetist/);
    return true;
  });
});

test("ADVERSARIAL: an invented role does not satisfy a required one", async () => {
  const { engine } = engineOf();
  const c = await upToMarked(engine);
  await assert.rejects(() => engine.signIn(c, {
    items: allOf("signIn"), lateralityAsserted: "left",
    signatures: [
      { role: "surgeon", actorId: "mr-surgeon" },
      { role: "assistant", actorId: "helper" },
      { role: "observer", actorId: "student" },
      { role: "nurse", actorId: "sr-scrub" },
    ],
  }), (e) => { assert.equal(e.code, "SIGNATURES_MISSING"); return true; });
});

/* ------------------------------------------------------------------ ADVERSARIAL: the items */

test("ADVERSARIAL: an unconfirmed checklist item blocks the phase", async () => {
  const { engine } = engineOf();
  const c = await upToMarked(engine);
  for (const omit of CHECKLIST.signIn) {
    const items = { ...allOf("signIn") };
    delete items[omit];
    await assert.rejects(() => engine.signIn(c, { items, signatures: THREE, lateralityAsserted: "left" }),
      (e) => { assert.equal(e.code, "CHECKLIST_INCOMPLETE"); assert.match(e.message, new RegExp(omit)); return true; },
      `omitting ${omit} must block sign in`);
  }
});

test("ADVERSARIAL: an item is not confirmed by anything other than an explicit true", async () => {
  const { engine } = engineOf();
  const c = await upToMarked(engine);
  for (const sneaky of ["yes", 1, "true", {}, null, false]) {
    const items = { ...allOf("signIn"), "consent-confirmed": sneaky };
    await assert.rejects(() => engine.signIn(c, { items, signatures: THREE, lateralityAsserted: "left" }),
      (e) => { assert.equal(e.code, "CHECKLIST_INCOMPLETE"); return true; },
      `a checklist item must not be satisfied by ${JSON.stringify(sneaky)}`);
  }
});

/* ------------------------------------------------------------------ ADVERSARIAL: the knife */

test("ADVERSARIAL: incision is locked without a Sign In", async () => {
  const { engine } = engineOf();
  const c = await upToMarked(engine);
  await assert.rejects(() => engine.incise(c, "mr-surgeon"), (e) => { assert.equal(e.code, "SIGN_IN_INCOMPLETE"); return true; });
  assert.equal(c.incisionAt, null);
});

test("ADVERSARIAL: incision is locked without a Time Out, even with a perfect Sign In", async () => {
  const { engine } = engineOf();
  const c = await upToMarked(engine);
  await engine.signIn(c, { items: allOf("signIn"), signatures: THREE, lateralityAsserted: "left" });
  await assert.rejects(() => engine.incise(c, "mr-surgeon"), (e) => {
    assert.equal(e.code, "TIME_OUT_INCOMPLETE");
    return true;
  }, "the list running late is precisely when a Time Out gets skipped, so this must be a lock and not a prompt");
  assert.equal(c.stage, STAGE.SIGNED_IN);
});

test("ADVERSARIAL: the Time Out cannot be jumped to before a Sign In", async () => {
  const { engine } = engineOf();
  const c = await upToMarked(engine);
  await assert.rejects(() => engine.timeOut(c, { items: allOf("timeOut"), signatures: THREE, lateralityAsserted: "left" }),
    (e) => { assert.equal(e.code, "OUT_OF_SEQUENCE"); return true; });
});

test("gate: with both phases complete, incision is permitted", async () => {
  const { engine } = engineOf();
  const c = await upToTimedOut(engine);
  await engine.incise(c, "mr-surgeon");
  assert.equal(c.stage, STAGE.INCISED);
  assert.ok(c.incisionAt);
});

/* ------------------------------------------------------------------ ADVERSARIAL: after the fact */

test("ADVERSARIAL: an operative record cannot paper over a bypassed checklist", async () => {
  const { engine } = engineOf();
  const c = await upToMarked(engine);
  await assert.rejects(() => engine.operativeRecord(c, "mr-surgeon", "Uneventful procedure."), (e) => {
    assert.equal(e.code, "MILESTONE_BYPASSED");
    assert.match(e.message, /sign in/);
    return true;
  }, "if the record could be written anyway, the gate would only delay the paperwork");
});

test("ADVERSARIAL: sign out cannot complete while counts are wrong", async () => {
  const { engine } = engineOf();
  const c = await upToTimedOut(engine);
  await engine.incise(c, "mr-surgeon");
  await assert.rejects(() => engine.signOut(c, {
    items: { ...allOf("signOut"), "counts-correct": false }, signatures: THREE,
  }), (e) => {
    assert.equal(e.code, "COUNTS_INCORRECT");
    return true;
  }, "a retained swab is a never event and the checklist must not close over it");
  assert.ok(c.ledger.some((l) => l.event === "sign-out-blocked"));
});

test("governance: cases that reached the knife without a complete checklist are reportable", async () => {
  const { engine } = engineOf();
  const clean = await upToTimedOut(engine);
  await engine.incise(clean, "mr-surgeon");

  // A case that reached incision with no Time Out could only exist if the gate were bypassed, so
  // this is constructed directly to prove the governance report would catch it.
  const forced = await upToMarked(engine);
  await engine.signIn(forced, { items: allOf("signIn"), signatures: THREE, lateralityAsserted: "left" });
  forced.stage = STAGE.INCISED;
  forced.incisionAt = "2026-09-04T08:10:00.000Z";

  const report = bypassed([clean, forced]);
  assert.equal(report.length, 1, "the compliant case is not reported");
  assert.deepEqual(report[0].missing, ["time out"]);
});

/* ------------------------------------------------------------------ the whole path */

test("case: a compliant list runs the whole chain and records every signature", async () => {
  const c0 = clock("2026-09-04T07:30:00.000Z");
  const bus = new ClinicalEventBus();
  const types = [];
  for (const t of ["surgical.booked", "surgical.marked", "surgical.signin", "surgical.timeout", "surgical.incision", "surgical.signout"]) {
    bus.on(t, (e) => types.push(e.type));
  }
  const { engine } = engineOf({ clock: c0, bus });
  const c = await upToTimedOut(engine);
  await engine.incise(c, "mr-surgeon");
  c0.advance(95);
  await engine.signOut(c, { items: allOf("signOut"), signatures: THREE });
  const record = await engine.operativeRecord(c, "mr-surgeon", "Left total knee replacement, uneventful.");

  assert.equal(c.stage, STAGE.SIGNED_OUT);
  assert.equal(record.caseId, c.id);
  assert.deepEqual(types, ["surgical.booked", "surgical.marked", "surgical.signin", "surgical.timeout", "surgical.incision", "surgical.signout"]);
  assert.equal(c.signIn.signatures.length, 3);
  assert.equal(new Set(c.timeOut.signatures.map((s) => s.actorId)).size, 3, "three distinct people are recorded on the Time Out");
  for (const e of ["booked", "consent-recorded", "site-marked", "signIn", "timeOut", "incision", "signOut", "operative-record"]) {
    assert.ok(c.ledger.some((l) => l.event === e), `the ledger records ${e}`);
  }
});

test("integration: every stage is persisted to the append-only store", async () => {
  const store = new ClinicalStore({ backend: new MemoryBackend() });
  await store.open();
  const { engine } = engineOf({ store });
  const c = await upToTimedOut(engine);
  await engine.incise(c, "mr-surgeon");
  const history = await store.history("SurgicalCase", c.id);
  assert.ok(history.length >= 5, `each stage is its own version, got ${history.length}`);
  assert.equal(history[0].stage, STAGE.BOOKED);
  assert.equal(history.at(-1).stage, STAGE.INCISED);
});

test("abandon: a cancelled case is recorded rather than left dangling", async () => {
  const { engine } = engineOf();
  const c = await upToMarked(engine);
  await engine.abandon(c, "mr-surgeon", "patient unwell on arrival in theatre");
  assert.equal(c.stage, STAGE.ABANDONED);
  await assert.rejects(() => engine.incise(c, "mr-surgeon"), (e) => { assert.equal(e.code, "ABANDONED"); return true; });
});

test("case: a procedure with no side still requires the full checklist", async () => {
  const { engine } = engineOf();
  const c = await engine.book(patient(), { procedure: "laparotomy", laterality: "not-applicable" }, "clerk");
  await engine.recordConsent(c, { procedure: "laparotomy", laterality: "not-applicable", signedByPatientOrProxy: true }, "dr-ward");
  await engine.markSite(c, { laterality: "not-applicable" }, "mr-surgeon");
  await engine.signIn(c, { items: allOf("signIn"), signatures: THREE });
  await assert.rejects(() => engine.incise(c, "mr-surgeon"), (e) => { assert.equal(e.code, "TIME_OUT_INCOMPLETE"); return true; },
    "no laterality does not mean no checklist");
});
