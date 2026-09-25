/* A WHOLE OPD DAY, THROUGH THE REAL ROUTER, AS EVERY ROLE.
 *
 * The unit tests beside this one each prove a piece. This one is the piece nobody writes: reception
 * registers a walk-in, the doctor calls and sees them, one patient walks out and is recalled, and the
 * owner reads the day's figures - each step performed by the role that really performs it, with the
 * roles that must NOT be able to do it refused at the same step.
 *
 * It exists because the three OPD bugs reported from a live clinic this week were all in the seams
 * between roles and screens, not inside any one function: a login name that the console lowercased and
 * the sign-in path did not, a poll that wiped the form the owner was typing into, and a staff list that
 * could not say why a nurse was locked out.
 *
 * node --test --experimental-test-module-mocks test/opd-day-walkthrough.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { docs, ORG, api, seed, member, staffToken, uidFor, ENV, OWNER_A, OWNER_B, HR_A, HR_B, NURSE_A, VIEWER_A, CASHIER_A } from "./helpers/opd-router-harness.mjs";

const DOCTOR_A = "doctor-a@example.test", RECEPTION_A = "reception-a@example.test";
const ORG_A = "org-a";
const pulse = (who) => api(`/opd-pulse?orgId=${ORG_A}`, "GET", null, who);
const board = (who) => api(`/opd-board?orgId=${ORG_A}`, "GET", null, who);

/** A clinic with one consulting room that has a doctor in it, which is what a walk-in needs. */
async function clinicWithARoom() {
  seed();
  member(ORG_A, DOCTOR_A, "doctor");
  member(ORG_A, RECEPTION_A, "reception");
  // A room is never permanently one doctor's: it carries an assignment, and "primary" is who is in it now.
  const room = await ORG.createRoom(ENV, ORG_A, { name: "Room 1", assignment: { mode: "primary", primary: uidFor(DOCTOR_A), doctors: [uidFor(DOCTOR_A)] } }, "seed");
  return room;
}

test("the day: reception registers, the doctor sees the patient, and every role reads the same figures", async () => {
  await clinicWithARoom();
  const reception = await staffToken(ORG_A, RECEPTION_A, "reception");

  // Before anybody arrives, the OPD reads as empty - never as a zero-minute wait.
  const empty = await pulse(HR_A);
  assert.equal(empty.__status, 200, JSON.stringify(empty));
  assert.equal(empty.pulse.registered, 0);
  assert.equal(empty.pulse.doorToDoctor.medianMin, null, "no wait measured is not a wait of zero");
  assert.equal(empty.pulse.abandonedPct, null);

  // RECEPTION registers a walk-in. One staffed room, so it routes straight to that room's queue.
  const walkIn = await api("/pool", "POST", { orgId: ORG_A, name: "Walkin Testpatient", phone: "9000000001" }, reception);
  assert.equal(walkIn.__status, 200, JSON.stringify(walkIn));

  const b = await board(HR_A);
  assert.equal(b.__status, 200, JSON.stringify(b));
  const room = (b.rooms || [])[0];
  assert.ok(room && room.sessionId, "the room has a session once it has a doctor: " + JSON.stringify(b).slice(0, 300));
  const ticketId = ((room.tickets || [])[0] || {}).id || ((b.pool || [])[0] || {}).id;
  assert.ok(ticketId, "the walk-in is on the board: " + JSON.stringify(b).slice(0, 400));

  // The pulse now sees somebody in the hall, and nobody seen yet.
  const waiting = await pulse(HR_A);
  assert.equal(waiting.pulse.waiting, 1);
  assert.equal(waiting.pulse.completed, 0);
  assert.equal(waiting.pulse.abandonedPct, null, "nobody has finished, which is not nobody abandoned");

  // THE DOCTOR calls them in and finishes. Same session, the doctor's own.
  const sid = room.sessionId;
  for (const status of ["called", "in_consultation", "completed"]) {
    const r = await api("/status", "POST", { sessionId: sid, ticketId, status }, DOCTOR_A);
    assert.equal(r.__status, 200, status + ": " + JSON.stringify(r));
  }

  const done = await pulse(HR_A);
  assert.equal(done.pulse.completed, 1, "seen and sent home");
  assert.equal(done.pulse.waiting, 0, "the hall is empty again");
  assert.equal(done.pulse.abandonedPct, 0, "one finished, none walked out");
  assert.ok(done.pulse.doorToDoctor.medianMin != null, "a door-to-doctor time was measured");
});

test("every role that works the queue can read the figures, and no other hospital can", async () => {
  await clinicWithARoom();
  for (const who of [OWNER_A, HR_A, DOCTOR_A, NURSE_A, CASHIER_A, VIEWER_A]) {
    const r = await pulse(who);
    assert.equal(r.__status, 200, who + " works this OPD and may read its figures: " + JSON.stringify(r));
  }
  // A staff session is minted for ONE hospital; another hospital's admin and owner see nothing.
  assert.equal((await pulse(null)).__status, 401, "signed out");
  for (const who of [OWNER_B, HR_B]) {
    const r = await pulse(who);
    assert.ok(r.__status === 403 || r.__status === 404, who + " is not of this hospital: " + JSON.stringify(r));
  }
  // It carries no patient: this is meant for a screen the whole desk can see.
  const body = JSON.stringify((await pulse(HR_A)).pulse);
  assert.ok(!/name|mrn|phone/i.test(body), body.slice(0, 200));
});

test("a patient who walks out is a no-show, comes back only with a reason, and shows in the figures", async () => {
  await clinicWithARoom();
  const reception = await staffToken(ORG_A, RECEPTION_A, "reception");
  await api("/pool", "POST", { orgId: ORG_A, name: "Left Early", phone: "9000000002" }, reception);
  const b = await board(HR_A);
  const room = (b.rooms || [])[0], sid = room.sessionId;
  const ticketId = ((room.tickets || [])[0] || {}).id;
  assert.ok(ticketId, JSON.stringify(b).slice(0, 300));

  assert.equal((await api("/status", "POST", { sessionId: sid, ticketId, status: "no_show" }, DOCTOR_A)).__status, 200);
  let p = await pulse(HR_A);
  assert.equal(p.pulse.noShow, 1);
  assert.equal(p.pulse.abandonedPct, 100, "one finished the day, and it was by walking out");

  // A recall without a reason is refused: the reason is the point of the recall.
  const noReason = await api("/no-show/recall", "POST", { sessionId: sid, ticketId }, DOCTOR_A);
  assert.equal(noReason.__status, 400, JSON.stringify(noReason));
  assert.match(noReason.message, /Say why/);
  /* A viewer watches the queue and cannot move anybody in it. A NURSE can: OPD staff run the queue in
   * this product (functions/_queue_roles.js), which is the whole reason a nurse signs in at all. */
  const viewer = await staffToken(ORG_A, VIEWER_A, "viewer");
  const asViewer = await api("/no-show/recall", "POST", { sessionId: sid, ticketId, reason: "came back" }, viewer);
  assert.equal(asViewer.__status, 403, "a viewer may not recall: " + JSON.stringify(asViewer));

  const back = await api("/no-show/recall", "POST", { sessionId: sid, ticketId, reason: "came back from the lab" }, DOCTOR_A);
  assert.equal(back.__status, 200, JSON.stringify(back));
  p = await pulse(HR_A);
  assert.equal(p.pulse.noShow, 0, "they are in the queue again, not a no-show");
  assert.equal(p.pulse.recalls, 1, "and the desk's second go at them is counted");
});

test("staff admin: the owner is told WHY a nurse cannot sign in, and only the owner may look", async () => {
  await clinicWithARoom();
  // The list is staff.admin: a nurse cannot read her colleagues' credentials state.
  const nurse = await staffToken(ORG_A, NURSE_A, "nurse");
  assert.equal((await api(`/members?orgId=${ORG_A}`, "GET", null, nurse)).__status, 403);

  const before = await api(`/members?orgId=${ORG_A}`, "GET", null, HR_A);
  assert.equal(before.__status, 200, JSON.stringify(before));
  const row = (m) => (before.members || []).find((x) => x.identity === m);
  assert.ok(row(NURSE_A), "the nurse is listed");
  assert.equal(row(NURSE_A).lockedUntil, 0, "not locked out");
  assert.equal(row(DOCTOR_A).hasPin, false, "a member with no PIN yet is visible as such, not as 'wrong PIN'");

  // Five wrong PINs is the lockout, and the owner can now see it instead of guessing.
  for (let i = 0; i < 5; i++) await api("/auth/pin", "POST", { orgId: ORG_A, identity: NURSE_A, pin: "0000" });
  const locked = await api("/auth/pin", "POST", { orgId: ORG_A, identity: NURSE_A, pin: "0000" });
  assert.equal(locked.__status, 429, JSON.stringify(locked));
  assert.equal(locked.error, "locked");

  const after = await api(`/members?orgId=${ORG_A}`, "GET", null, HR_A);
  const nurseRow = (after.members || []).find((x) => x.identity === NURSE_A);
  assert.ok(nurseRow.lockedUntil > Date.now(), "the staff list says she is locked, and until when");
});

test("the login name is matched however the phone capitalised it, and the wrong PIN is still wrong", async () => {
  await clinicWithARoom();
  await ORG.setMembership(ENV, ORG_A, "nurse1", { role: "nurse" }, "seed");
  assert.equal((await ORG.setMemberPin(ENV, ORG_A, "nurse1", "482913", "seed")).ok, true);

  assert.equal((await api("/auth/pin", "POST", { orgId: ORG_A, identity: "nurse1", pin: "482913" })).__status, 200);
  const capital = await api("/auth/pin", "POST", { orgId: ORG_A, identity: "Nurse1", pin: "482913" });
  assert.equal(capital.__status, 200, "what a phone keyboard actually sends: " + JSON.stringify(capital));
  assert.equal(capital.identity, "nurse1", "signed in as the member that exists, not a new name");
  assert.equal((await api("/auth/pin", "POST", { orgId: ORG_A, identity: "Nurse1", pin: "000000" })).__status, 401, "a lookup fallback, not a weaker PIN");
});

test("a room with no doctor has no queue, and the figures say the OPD is empty rather than failing", async () => {
  seed();
  member(ORG_A, RECEPTION_A, "reception");
  await ORG.createRoom(ENV, ORG_A, { name: "Empty room" }, "seed");   // nobody consulting in it
  const p = await pulse(HR_A);
  assert.equal(p.__status, 200, JSON.stringify(p));
  assert.equal(p.pulse.registered, 0);
  assert.equal(p.unread, undefined, "an unstaffed room is not an unreadable one");
});
