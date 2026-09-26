/* SEC-12 (audit A12): the PHI-free queue-position link (sent by SMS/WhatsApp at registration) and the
 * clinical timeline link signed the same ticket id under the same secret, so the queue link opened the
 * sealed clinical timeline after checkout; and nothing could revoke a timeline link.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-sec12-timeline-link.test.mjs
 */
import "./helpers/trust-cf-access-header.mjs";
import * as H from "./helpers/opd-router-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const QT = await import("../functions/_queue_timeline.js");
const Q = await import("../functions/_queue_engine.js");
const { mintTicketToken } = await import("../functions/_queue.js");

async function visit() {
  H.seed();
  const ticket = { id: "tk1", date: H.DAY, expiresAt: Date.now() + 12 * 3600e3, tokenVer: 1, mrnLast4: "1234", sessionId: "s1", hospitalId: "org-a" };
  H.docs.set("q_tickets/tk1", { fields: { ...ticket }, updateTime: "t1" });
  const session = { id: "s1", hospitalId: "org-a", doctorUid: "doc" };
  await QT.appendTimeline(H.ENV, session, ticket, "assessment", "HIV positive, started ART", "doc");
  const queueLink = await Q.linkFor(H.ENV, ticket);
  const fin = await QT.finalizeCheckout(H.ENV, session, ticket, "doc");
  return { ticket, session, queueLink, fin };
}

test("the queue-position link never opens the clinical timeline", async () => {
  const { queueLink, fin } = await visit();
  const viaQueue = await QT.getTimelineByToken(H.ENV, queueLink.token);
  assert.notEqual(viaQueue.ok, true, JSON.stringify(viaQueue).slice(0, 200));
  assert.ok(!JSON.stringify(viaQueue).includes("HIV"));
  const own = await QT.getTimelineByToken(H.ENV, fin.token);
  assert.equal(own.ok, true, "the timeline link itself works");
});

test("revoking the ticket, or stopping the link on its own, closes the timeline link", async () => {
  let v = await visit();
  await Q.revokeTicket(H.ENV, v.session, "tk1", "desk");
  assert.notEqual((await QT.getTimelineByToken(H.ENV, v.fin.token)).ok, true, "ticket revoke stops the timeline link");

  v = await visit();
  assert.equal((await QT.revokeTimelineLink(H.ENV, "tk1")).ok, true);
  assert.notEqual((await QT.getTimelineByToken(H.ENV, v.fin.token)).ok, true, "a stopped link stays stopped");
});

test("a link sent before this fix (bare ticket id) still opens only if it is the exact one checkout stored", async () => {
  const { fin } = await visit();
  const legacy = await mintTicketToken(H.ENV, "tk1", Date.now() + 86400e3, 1);
  const d = H.docs.get("q_timeline/tk1"); d.fields = { ...d.fields, token: legacy };
  assert.equal((await QT.getTimelineByToken(H.ENV, legacy)).ok, true);
  const otherBare = await mintTicketToken(H.ENV, "tk1", Date.now() + 2 * 86400e3, 1);
  assert.notEqual((await QT.getTimelineByToken(H.ENV, otherBare)).ok, true);
  assert.ok(fin.token);
});

test("POST /timeline/revoke-link: no session 401, a role that cannot treat 403, the doctor stops the link", async () => {
  H.seed();
  const doc = await H.staffToken("org-a", "doc-s12@example.test", "doctor");
  const desk = await H.staffToken("org-a", "desk-s12@example.test", "reception");
  const s = await H.api("/session?hospitalId=org-a&date=" + H.DAY, "GET", null, doc);
  assert.equal(s.__status, 200, JSON.stringify(s));
  const t = await H.api("/ticket", "POST", { sessionId: s.session.id, name: "Test Patient", mobile: "9999999999" }, doc);
  assert.equal(t.__status, 200, JSON.stringify(t));
  const ticket = await Q.getTicket(H.ENV, t.ticket.id);
  await QT.appendTimeline(H.ENV, s.session, ticket, "assessment", "HIV positive, started ART", "doc");
  const fin = await QT.finalizeCheckout(H.ENV, s.session, ticket, "doc");
  assert.equal((await QT.getTimelineByToken(H.ENV, fin.token)).ok, true);

  const body = { sessionId: s.session.id, ticketId: ticket.id };
  assert.equal((await H.api("/timeline/revoke-link", "POST", body, {})).__status, 401);
  assert.equal((await H.api("/timeline/revoke-link", "POST", body, desk)).__status, 403);
  assert.equal((await QT.getTimelineByToken(H.ENV, fin.token)).ok, true, "a refused request stopped nothing");
  const ok = await H.api("/timeline/revoke-link", "POST", body, doc);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.notEqual((await QT.getTimelineByToken(H.ENV, fin.token)).ok, true);
});
